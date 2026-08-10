import { Controller, Post, Get, Body, Res, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TelegramAuthData } from './telegram-verifier.util';

@Controller('api')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
        telegramId: u.telegramId,
        firstName: u.firstName || 'User',
        lastName: u.lastName || '',
        username: u.username || '',
        profilePhotoUrl: u.profilePhotoUrl || '',
        currency: u.currency || '₹',
      },
    };
  }

  @Post('auth/logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) res: any) {
    (res as Response).clearCookie('pulse_session', { path: '/' });
    return { authenticated: false, message: 'Logged out successfully' };
  }
}
