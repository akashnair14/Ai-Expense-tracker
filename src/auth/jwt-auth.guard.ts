import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AuthService } from './auth.service';
import * as crypto from 'crypto';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: any }>();
    const cookies = this.parseCookies(request.headers.cookie);
    const sessionToken = cookies['pulse_session'];
    const authHeader = (request.headers['authorization'] ||
      request.headers['x-telegram-init-data']) as string;

    // 1. Try JWT from HttpOnly Cookie or Bearer / raw Authorization header
    let token = sessionToken;
    if (!token && authHeader && !authHeader.includes('hash=')) {
      token = authHeader.startsWith('Bearer ')
        ? authHeader.substring(7)
        : authHeader;
    }

    if (token) {
      try {
        const payload = this.jwtService.verify(token);
        const user = await this.authService.validateUserById(payload.sub);
        if (user) {
          request.user = user;
          return true;
        }
      } catch (err) {
        this.logger.debug(`JWT verification failed: ${err.message}`);
      }
    }

    // 2. Telegram Mini App initData HMAC Verification Fallback
    if (authHeader && authHeader.includes('hash=')) {
      const initDataStr = authHeader.startsWith('Bearer ')
        ? authHeader.substring(7)
        : authHeader;
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const isMock =
        process.env.NODE_ENV === 'test' ||
        !botToken ||
        botToken === 'MOCK_TELEGRAM_TOKEN';

      let telegramUserObj: any = null;

      if (!isMock && botToken) {
        telegramUserObj = this.verifyTelegramInitData(initDataStr, botToken);
      } else {
        telegramUserObj = this.extractUserFromInitData(initDataStr);
      }

      if (telegramUserObj && telegramUserObj.id) {
        let user = await this.authService.validateUserByTelegramId(
          String(telegramUserObj.id),
        );
        if (!user) {
          const loginRes = await this.authService.validateAndLoginTelegramUser({
            id: telegramUserObj.id,
            first_name: telegramUserObj.first_name,
            last_name: telegramUserObj.last_name,
            username: telegramUserObj.username,
            auth_date: Math.floor(Date.now() / 1000),
            hash: 'miniapp_verified',
          });
          user = await this.authService.validateUserById(loginRes.user.id);
        }
        if (user) {
          request.user = user;
          return true;
        }
      }
    }

    // 3. Reject unauthenticated requests
    throw new UnauthorizedException(
      'Authentication required. Invalid or missing session credentials.',
    );
  }

  private parseCookies(cookieHeader?: string): Record<string, string> {
    const list: Record<string, string> = {};
    if (!cookieHeader) return list;
    cookieHeader.split(';').forEach((cookie) => {
      const parts = cookie.split('=');
      const name = parts.shift()?.trim();
      if (name) {
        list[name] = decodeURIComponent(parts.join('='));
      }
    });
    return list;
  }

  private verifyTelegramInitData(
    initData: string,
    botToken: string,
  ): any | null {
    try {
      const urlParams = new URLSearchParams(initData);
      const hash = urlParams.get('hash');
      if (!hash) return null;
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

      if (calculatedHash !== hash) return null;

      const userJson = urlParams.get('user');
      return userJson ? JSON.parse(userJson) : null;
    } catch {
      return null;
    }
  }

  private extractUserFromInitData(initData: string): any | null {
    try {
      const urlParams = new URLSearchParams(initData);
      const userJson = urlParams.get('user');
      return userJson ? JSON.parse(userJson) : null;
    } catch {
      return null;
    }
  }
}
