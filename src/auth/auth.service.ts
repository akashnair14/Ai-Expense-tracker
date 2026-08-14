import { Injectable, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionService } from '../transactions/transaction.service';
import { verifyTelegramWidgetData, TelegramAuthData } from './telegram-verifier.util';
import * as bcrypt from 'bcrypt';

export interface JwtPayload {
  sub: string;
  telegramId?: string | null;
  email?: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionService: TransactionService,
    private readonly jwtService: JwtService,
  ) {}

  async registerWithEmail(email: string, pass: string, name?: string) {
    if (!email || !pass) {
      throw new BadRequestException('Email and password are required');
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (existing) {
      throw new BadRequestException('An account with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(pass, 10);
    const user = await this.prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        passwordHash: hashedPassword,
        firstName: name || email.split('@')[0],
        currency: 'INR',
        lastLoginAt: new Date(),
      },
    });

    await this.transactionService.seedDefaultCategories(user.id);

    return this.buildAuthResult(user);
  }

  async loginWithEmail(email: string, pass: string) {
    if (!email || !pass) {
      throw new BadRequestException('Email and password are required');
    }

    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isMatch = await bcrypt.compare(pass, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.buildAuthResult(user);
  }

  async demoLogin() {
    let demoUser = await this.prisma.user.findUnique({
      where: { email: 'demo@pulseai.internal' },
    });

    if (!demoUser) {
      const hashedPassword = await bcrypt.hash('demo123456', 10);
      demoUser = await this.prisma.user.create({
        data: {
          email: 'demo@pulseai.internal',
          passwordHash: hashedPassword,
          firstName: 'Demo User',
          currency: 'INR',
          lastLoginAt: new Date(),
        },
      });
      await this.transactionService.seedDefaultCategories(demoUser.id);
    }

    return this.buildAuthResult(demoUser);
  }

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

    return this.buildAuthResult(user);
  }

  // In-memory store for real-time QR / Push login sessions
  private qrSessions = new Map<string, { status: 'PENDING' | 'APPROVED' | 'EXPIRED'; token?: string; user?: any; createdAt: number }>();

  createQrSession() {
    const sessionId = 'qr_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    this.qrSessions.set(sessionId, { status: 'PENDING', createdAt: Date.now() });

    // Clean up expired sessions after 5 minutes
    setTimeout(() => {
      this.qrSessions.delete(sessionId);
    }, 5 * 60 * 1000);

    const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'Akash_Expense_tracker_bot';
    const deepLink = `https://t.me/${botUsername}?start=${sessionId}`;

    return { sessionId, deepLink };
  }

  checkQrSession(sessionId: string) {
    const session = this.qrSessions.get(sessionId);
    if (!session) {
      return { status: 'EXPIRED' };
    }
    if (Date.now() - session.createdAt > 2 * 60 * 1000) {
      session.status = 'EXPIRED';
    }
    return session;
  }

  async approveQrSession(sessionId: string, telegramId: string | number, firstName?: string, username?: string, lastName?: string) {
    const session = this.qrSessions.get(sessionId);
    if (!session) {
      return false;
    }

    const user = await this.transactionService.getOrCreateUser(String(telegramId), username, firstName, lastName);
    const authResult = this.buildAuthResult(user);

    session.status = 'APPROVED';
    session.token = authResult.token;
    session.user = authResult.user;

    return true;
  }

  private buildAuthResult(user: any) {
    const payload: JwtPayload = { sub: user.id, telegramId: user.telegramId, email: user.email };
    const token = this.jwtService.sign(payload);

    return {
      token,
      user: {
        id: user.id,
        email: user.email || '',
        telegramId: user.telegramId || '',
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
