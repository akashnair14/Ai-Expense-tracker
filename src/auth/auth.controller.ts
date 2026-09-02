import {
  Controller,
  Post,
  Get,
  Body,
  Res,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TelegramAuthData } from './telegram-verifier.util';
import {
  RegisterWithEmailSchema,
  LoginWithEmailSchema,
  CompleteOnboardingSchema,
} from '../common/validation/schemas';

@Controller('api')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('auth/qr/generate')
  generateQr() {
    return this.authService.createQrSession();
  }

  @Get('auth/qr/status')
  checkQr(@Req() req: any, @Res({ passthrough: true }) res: any) {
    const sessionId = (req.query?.sessionId as string) || '';
    if (!sessionId || typeof sessionId !== 'string') {
      throw new BadRequestException('Session ID is required');
    }
    const session = this.authService.checkQrSession(sessionId);

    if (
      session &&
      'status' in session &&
      session.status === 'APPROVED' &&
      (session as any).token
    ) {
      (res as Response).cookie('pulse_session', (session as any).token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
    }

    return session;
  }

  @Post('auth/register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() body: any, @Res({ passthrough: true }) res: any) {
    const validation = RegisterWithEmailSchema.safeParse(body);
    if (!validation.success) {
      const errorMsg = validation.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join(', ');
      throw new BadRequestException(`Validation failed: ${errorMsg}`);
    }

    const { token, user } = await this.authService.registerWithEmail(
      validation.data.email,
      validation.data.password,
      validation.data.name,
    );

    (res as Response).cookie('pulse_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    return { authenticated: true, token, user };
  }

  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  async loginWithEmail(
    @Body() body: any,
    @Res({ passthrough: true }) res: any,
  ) {
    const validation = LoginWithEmailSchema.safeParse(body);
    if (!validation.success) {
      const errorMsg = validation.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join(', ');
      throw new BadRequestException(`Validation failed: ${errorMsg}`);
    }

    const { token, user } = await this.authService.loginWithEmail(
      validation.data.email,
      validation.data.password,
    );

    (res as Response).cookie('pulse_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    return { authenticated: true, token, user };
  }

  @Post('auth/demo')
  @HttpCode(HttpStatus.OK)
  async demoLogin(@Res({ passthrough: true }) res: any) {
    const { token, user } = await this.authService.demoLogin();

    (res as Response).cookie('pulse_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    return { authenticated: true, token, user };
  }

  @Post('auth/telegram')
  @HttpCode(HttpStatus.OK)
  async loginWithTelegram(
    @Body() body: any,
    @Res({ passthrough: true }) res: any,
  ) {
    let authResult: any;

    if (body?.initData && typeof body.initData === 'string') {
      authResult = await this.authService.validateAndLoginTelegramMiniApp(body.initData);
    } else {
      authResult = await this.authService.validateAndLoginTelegramUser(body as TelegramAuthData);
    }

    (res as Response).cookie('pulse_session', authResult.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    return {
      authenticated: true,
      token: authResult.token,
      user: authResult.user,
    };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getProfile(@Req() req: any) {
    const u = (req as Request & { user: any }).user;
    return {
      authenticated: true,
      user: {
        id: u.id,
        email: u.email || '',
        telegramId: u.telegramId || '',
        firstName: u.firstName || 'User',
        lastName: u.lastName || '',
        username: u.username || '',
        profilePhotoUrl: u.profilePhotoUrl || '',
        currency: u.currency || 'INR',
        isOnboarded: u.isOnboarded ?? false,
        monthlyIncome: u.monthlyIncome ? Number(u.monthlyIncome) : null,
        targetSavingsRate: u.targetSavingsRate ?? 20,
      },
    };
  }

  @Post('user/onboarding')
  @UseGuards(JwtAuthGuard)
  async completeOnboarding(@Req() req: any, @Body() body: any) {
    const userId = (req as Request & { user: any }).user.id;
    const validation = CompleteOnboardingSchema.safeParse(body);
    if (!validation.success) {
      const errorMsg = validation.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join(', ');
      throw new BadRequestException(`Validation failed: ${errorMsg}`);
    }

    return this.authService.completeOnboarding(userId, validation.data);
  }

  @Post('auth/logout')
  logout(@Res({ passthrough: true }) res: any) {
    (res as Response).clearCookie('pulse_session', { path: '/' });
    return { success: true, message: 'Logged out successfully' };
  }
}
