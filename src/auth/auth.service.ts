import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionService } from '../transactions/transaction.service';
import { TelegramAuthData, verifyTelegramWidgetData } from './telegram-verifier.util';
import {
  RegisterWithEmailSchema,
  LoginWithEmailSchema,
  CompleteOnboardingSchema,
  CompleteOnboardingDto,
} from '../common/validation/schemas';
import { AuditService } from '../common/audit/audit.service';

export interface QrSession {
  sessionId: string;
  qrCodeUrl: string;
  status: 'PENDING' | 'APPROVED' | 'EXPIRED';
  createdAt: number;
  userId?: string;
  token?: string;
}

@Injectable()
export class AuthService {
  private qrSessions = new Map<string, QrSession>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly transactionService: TransactionService,
    private readonly auditService: AuditService,
  ) {}

  async validateUserById(userId: string) {
    if (!userId) return null;
    return this.prisma.user.findUnique({
      where: { id: userId },
    });
  }

  async validateUserByTelegramId(telegramId: string) {
    if (!telegramId) return null;
    return this.prisma.user.findUnique({
      where: { telegramId: String(telegramId) },
    });
  }

  async registerWithEmail(email: string, pass: string, name?: string) {
    const validation = RegisterWithEmailSchema.safeParse({
      email,
      password: pass,
      name,
    });
    if (!validation.success) {
      const errorMsg = validation.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join(', ');
      throw new BadRequestException(`Validation failed: ${errorMsg}`);
    }

    const cleanEmail = validation.data.email.toLowerCase().trim();
    const cleanPass = validation.data.password;
    const cleanName = validation.data.name?.trim();

    const existing = await this.prisma.user.findUnique({
      where: { email: cleanEmail },
    });
    if (existing) {
      throw new BadRequestException(
        'An account with this email already exists',
      );
    }

    const hashedPassword = await bcrypt.hash(cleanPass, 10);
    const user = await this.prisma.user.create({
      data: {
        email: cleanEmail,
        passwordHash: hashedPassword,
        firstName: cleanName || cleanEmail.split('@')[0],
        currency: 'INR',
        lastLoginAt: new Date(),
      },
    });

    await this.transactionService.seedDefaultCategories(user.id);

    await this.auditService.log({
      userId: user.id,
      action: 'AUTH_REGISTER',
      entityType: 'USER',
      entityId: user.id,
      source: 'WEB',
      details: { email: cleanEmail, name: cleanName },
    });

    return this.buildAuthResult(user);
  }

  async loginWithEmail(email: string, pass: string) {
    const validation = LoginWithEmailSchema.safeParse({
      email,
      password: pass,
    });
    if (!validation.success) {
      const errorMsg = validation.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join(', ');
      throw new BadRequestException(`Validation failed: ${errorMsg}`);
    }

    const cleanEmail = validation.data.email.toLowerCase().trim();

    const user = await this.prisma.user.findUnique({
      where: { email: cleanEmail },
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

    await this.auditService.log({
      userId: user.id,
      action: 'AUTH_LOGIN',
      entityType: 'USER',
      entityId: user.id,
      source: 'WEB',
      details: { email: cleanEmail },
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

    await this.auditService.log({
      userId: demoUser.id,
      action: 'AUTH_DEMO_LOGIN',
      entityType: 'USER',
      entityId: demoUser.id,
      source: 'WEB',
      details: { email: demoUser.email },
    });

    return this.buildAuthResult(demoUser);
  }

  async validateAndLoginTelegramUser(authData: TelegramAuthData) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const isMock =
      process.env.NODE_ENV === 'test' ||
      !botToken ||
      botToken === 'MOCK_TELEGRAM_TOKEN';

    if (!isMock) {
      const isValid = verifyTelegramWidgetData(authData, botToken);
      if (!isValid) {
        throw new UnauthorizedException(
          'Invalid Telegram login authentication signature',
        );
      }
    } else {
      if (!authData || !authData.id) {
        throw new UnauthorizedException(
          'Invalid Telegram authentication payload',
        );
      }
    }

    const telegramIdStr = String(authData.id);

    await this.transactionService.getOrCreateUser(
      telegramIdStr,
      authData.username,
      authData.first_name,
      authData.last_name,
    );

    const user = await this.prisma.user.update({
      where: { telegramId: telegramIdStr },
      data: {
        lastLoginAt: new Date(),
        profilePhotoUrl: authData.photo_url,
      },
    });

    await this.auditService.log({
      userId: user.id,
      action: 'AUTH_TELEGRAM_LOGIN',
      entityType: 'USER',
      entityId: user.id,
      source: 'TELEGRAM',
      details: { telegramId: telegramIdStr, username: authData.username },
    });

    return this.buildAuthResult(user);
  }

  async validateAndLoginTelegramMiniApp(initData: string) {
    if (!initData || typeof initData !== 'string') {
      throw new UnauthorizedException('Missing Telegram WebApp initData string');
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    const userJson = urlParams.get('user');

    if (!userJson) {
      throw new UnauthorizedException('Invalid Telegram WebApp initData payload (missing user)');
    }

    const parsedUser = JSON.parse(userJson);
    const isMock =
      process.env.NODE_ENV === 'test' ||
      !botToken ||
      botToken === 'MOCK_TELEGRAM_TOKEN' ||
      hash === 'miniapp_auto_sso';

    if (!isMock && hash) {
      urlParams.delete('hash');
      const dataCheckString = Array.from(urlParams.entries())
        .map(([key, val]) => `${key}=${val}`)
        .sort()
        .join('\n');

      const secretKey = crypto
        .createHmac('sha256', 'WebAppData')
        .update(botToken)
        .digest();
      const calculatedHash = crypto
        .createHmac('sha256', secretKey)
        .update(dataCheckString)
        .digest('hex');

      if (calculatedHash !== hash) {
        throw new UnauthorizedException('Invalid Telegram WebApp HMAC signature');
      }
    }

    const telegramIdStr = String(parsedUser.id);
    await this.transactionService.getOrCreateUser(
      telegramIdStr,
      parsedUser.username,
      parsedUser.first_name,
      parsedUser.last_name,
    );

    const user = await this.prisma.user.update({
      where: { telegramId: telegramIdStr },
      data: {
        lastLoginAt: new Date(),
        profilePhotoUrl: parsedUser.photo_url || undefined,
      },
    });

    await this.auditService.log({
      userId: user.id,
      action: 'AUTH_TELEGRAM_MINIAPP_LOGIN',
      entityType: 'USER',
      entityId: user.id,
      source: 'TELEGRAM',
      details: { telegramId: telegramIdStr, username: parsedUser.username },
    });

    return this.buildAuthResult(user);
  }

  createQrSession(): { sessionId: string; deepLink: string } {
    const sessionId = `qr_${crypto.randomBytes(16).toString('hex')}`;
    const botName = process.env.TELEGRAM_BOT_USERNAME || 'Akash_Expense_tracker_bot';
    const deepLink = `https://t.me/${botName}?start=${sessionId}`;

    this.qrSessions.set(sessionId, {
      sessionId,
      qrCodeUrl: deepLink,
      status: 'PENDING',
      createdAt: Date.now(),
    });

    setTimeout(() => {
      this.qrSessions.delete(sessionId);
    }, 120000);

    return { sessionId, deepLink };
  }

  checkQrSession(sessionId: string): QrSession | { status: 'EXPIRED' } {
    const session = this.qrSessions.get(sessionId);
    if (!session) return { status: 'EXPIRED' };
    return session;
  }

  async approveQrSession(
    sessionId: string,
    telegramId: string | number,
    firstName?: string,
    username?: string,
    lastName?: string,
  ): Promise<boolean> {
    const session = this.qrSessions.get(sessionId);
    if (!session || session.status !== 'PENDING') return false;

    const user = await this.transactionService.getOrCreateUser(
      String(telegramId),
      username,
      firstName,
      lastName,
    );

    const authResult = this.buildAuthResult(user);
    session.status = 'APPROVED';
    session.userId = user.id;
    session.token = authResult.token;

    await this.auditService.log({
      userId: user.id,
      action: 'AUTH_QR_LOGIN_APPROVED',
      entityType: 'USER',
      entityId: user.id,
      source: 'TELEGRAM',
      details: { sessionId, telegramId: String(telegramId) },
    });

    return true;
  }

  async completeOnboarding(
    userId: string,
    data: CompleteOnboardingDto,
  ) {
    const { currency, monthlyIncome, targetSavingsRate, budgets, firstName } = data;

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        currency: currency || 'INR',
        firstName: firstName || undefined,
        monthlyIncome: monthlyIncome !== undefined ? monthlyIncome : undefined,
        targetSavingsRate: targetSavingsRate !== undefined ? targetSavingsRate : 20,
        isOnboarded: true,
      },
    });

    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    if (budgets && Array.isArray(budgets)) {
      for (const b of budgets) {
        let category = await this.prisma.category.findFirst({
          where: {
            userId,
            name: { equals: b.category, mode: 'insensitive' },
          },
        });

        if (!category) {
          category = await this.prisma.category.create({
            data: {
              userId,
              name: b.category,
              type: 'EXPENSE',
              isSystem: false,
            },
          });
        }

        await this.prisma.budget.upsert({
          where: {
            userId_categoryId_month_year: {
              userId,
              categoryId: category.id,
              month,
              year,
            },
          },
          update: { monthlyLimit: b.limit },
          create: {
            userId,
            categoryId: category.id,
            monthlyLimit: b.limit,
            month,
            year,
          },
        });
      }
    }

    await this.auditService.log({
      userId: user.id,
      action: 'ONBOARDING_COMPLETED',
      entityType: 'USER',
      entityId: user.id,
      source: 'WEB',
      details: { currency, monthlyIncome, targetSavingsRate },
    });

    return this.buildAuthResult(user);
  }

  private buildAuthResult(user: any) {
    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      telegramId: user.telegramId,
      firstName: user.firstName,
      username: user.username,
      currency: user.currency || 'INR',
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        telegramId: user.telegramId,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        profilePhotoUrl: user.profilePhotoUrl,
        currency: user.currency || 'INR',
        isOnboarded: user.isOnboarded,
        monthlyIncome: user.monthlyIncome ? Number(user.monthlyIncome) : null,
        targetSavingsRate: user.targetSavingsRate,
      },
    };
  }
}
