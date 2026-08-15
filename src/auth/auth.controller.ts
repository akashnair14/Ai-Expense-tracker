import { Controller, Post, Get, Body, Res, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TelegramAuthData } from './telegram-verifier.util';

@Controller('api')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('auth/qr/generate')
  generateQr() {
    return this.authService.createQrSession();
  }

  @Get('auth/qr/status')
  checkQr(@Req() req: any, @Res({ passthrough: true }) res: any) {
    const sessionId = req.query.sessionId as string;
    const session = this.authService.checkQrSession(sessionId);

    if (session && 'status' in session && session.status === 'APPROVED' && (session as any).token) {
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
  async register(@Body() body: { email: string; password: string; name?: string }, @Res({ passthrough: true }) res: any) {
    const { token, user } = await this.authService.registerWithEmail(body.email, body.password, body.name);

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
  async loginWithEmail(@Body() body: { email: string; password: string }, @Res({ passthrough: true }) res: any) {
    const { token, user } = await this.authService.loginWithEmail(body.email, body.password);

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
  async loginWithTelegram(@Body() body: TelegramAuthData, @Res({ passthrough: true }) res: any) {
    const { token, user } = await this.authService.validateAndLoginTelegramUser(body);

    // Set secure HttpOnly session cookie
    (res as Response).cookie('pulse_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    return {
      authenticated: true,
      token,
      user,
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
        currency: u.currency || '₹',
        isOnboarded: u.isOnboarded ?? false,
        monthlyIncome: u.monthlyIncome ? Number(u.monthlyIncome) : null,
        targetSavingsRate: u.targetSavingsRate ?? 20,
      },
    };
  }

  @Post('user/onboarding')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async saveOnboarding(
    @Req() req: any,
    @Body() body: {
      firstName?: string;
      currency?: string;
      monthlyIncome?: number;
      targetSavingsRate?: number;
      budgets?: Array<{ category: string; limit: number }>;
    },
  ) {
    const user = (req as Request & { user: any }).user;
    return this.authService.completeOnboarding(user.id, body);
  }

  @Post('auth/logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) res: any) {
    (res as Response).clearCookie('pulse_session', { path: '/' });
    return { authenticated: false, message: 'Logged out successfully' };
  }
}
