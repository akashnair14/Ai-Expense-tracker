import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionService } from '../transactions/transaction.service';
import { verifyTelegramWidgetData, TelegramAuthData } from './telegram-verifier.util';

export interface JwtPayload {
  sub: string;
  telegramId: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionService: TransactionService,
    private readonly jwtService: JwtService,
  ) {}

  async validateAndLoginTelegramUser(authData: TelegramAuthData) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const isMock = process.env.NODE_ENV === 'test' || !botToken || botToken === 'MOCK_TELEGRAM_TOKEN';

    if (!isMock) {
      const isValid = verifyTelegramWidgetData(authData, botToken);
      if (!isValid) {
        throw new UnauthorizedException('Invalid Telegram login authentication signature');
      }
    } else {
      if (!authData || !authData.id) {
        throw new UnauthorizedException('Invalid Telegram authentication payload');
      }
    }

    const telegramIdStr = String(authData.id);

    // Seed default categories if first time user
    await this.transactionService.getOrCreateUser(telegramIdStr, authData.username, authData.first_name);

    // Update user profile metadata
    const user = await this.prisma.user.update({
      where: { telegramId: telegramIdStr },
      data: {
        username: authData.username || undefined,
        firstName: authData.first_name || undefined,
        lastName: authData.last_name || undefined,
        profilePhotoUrl: authData.photo_url || undefined,
        lastLoginAt: new Date(),
        isActive: true,
      },
    });

    const payload: JwtPayload = { sub: user.id, telegramId: user.telegramId };
    const token = this.jwtService.sign(payload);

    return {
      token,
      user: {
        id: user.id,
        telegramId: user.telegramId,
        firstName: user.firstName || 'User',
        lastName: user.lastName || '',
        username: user.username || '',
        profilePhotoUrl: user.profilePhotoUrl || '',
        currency: user.currency || '₹',
      },
    };
  }

  async validateUserById(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.isActive) {
      return null;
    }

    return user;
  }

  async validateUserByTelegramId(telegramId: string) {
    return this.prisma.user.findUnique({
      where: { telegramId },
    });
  }
}
