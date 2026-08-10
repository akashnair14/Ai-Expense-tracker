import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { Request } from 'express';
import * as crypto from 'crypto';

export interface AuthenticatedUser {
  id: number;
  telegramId: string;
  firstName?: string;
  username?: string;
}

@Injectable()
export class TelegramWebAppAuthGuard implements CanActivate {
  private readonly logger = new Logger(TelegramWebAppAuthGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const authHeader = (request.headers['authorization'] || request.headers['x-telegram-init-data']) as string;
    const requestTelegramId = (request.params?.telegramId as string) || (request.body?.telegramId as string);

    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    // 1. Check for Authorization header or Telegram initData
    if (authHeader) {
      const initDataStr = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;

      // If initData is a standard Telegram HMAC signed string (contains hash=)
      if (initDataStr.includes('hash=')) {
        if (botToken && botToken !== 'MOCK_TELEGRAM_TOKEN') {
          const validatedUser = this.verifyTelegramInitData(initDataStr, botToken);
          if (validatedUser) {
            request.user = validatedUser;
            return true;
          }
          throw new UnauthorizedException('Invalid Telegram WebApp initData HMAC signature');
        } else {
          // Dev/Mock mode without active bot token: parse user object from initData string
          const parsedUser = this.extractUserFromInitData(initDataStr);
          if (parsedUser) {
            request.user = parsedUser;
            return true;
          }
        }
      }

      // If header is a plain Telegram ID string (e.g. numeric ID from web session)
      if (/^\d+$/.test(initDataStr.trim())) {
        const cleanId = initDataStr.trim();
        request.user = {
          id: Number(cleanId),
          telegramId: cleanId,
          firstName: `User ${cleanId}`,
        };
        return true;
      }
    }

    // 2. Fallback to explicit parameter / body telegramId if passed in request
    if (requestTelegramId && /^\d+$/.test(requestTelegramId.trim())) {
      const cleanId = requestTelegramId.trim();
      request.user = {
        id: Number(cleanId),
        telegramId: cleanId,
        firstName: `User ${cleanId}`,
      };
      return true;
    }

    // 3. Reject unauthenticated requests lacking credentials
    throw new UnauthorizedException('Authentication required. Missing Telegram WebApp initData or valid Telegram ID');
  }

  private verifyTelegramInitData(initData: string, botToken: string): AuthenticatedUser | null {
    try {
      const urlParams = new URLSearchParams(initData);
      const hash = urlParams.get('hash');
      if (!hash) return null;

      urlParams.delete('hash');

      // Sort key=value pairs alphabetically
      const dataCheckString = Array.from(urlParams.entries())
        .map(([key, val]) => `${key}=${val}`)
        .sort()
        .join('\n');

      // HMAC-SHA256 of botToken with secret key "WebAppData"
      const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
      const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

      if (calculatedHash !== hash) {
        return null;
      }

      const userJson = urlParams.get('user');
      if (!userJson) return null;

      const parsedUser = JSON.parse(userJson);
      return {
        id: parsedUser.id,
        telegramId: String(parsedUser.id),
        firstName: parsedUser.first_name,
        username: parsedUser.username,
      };
    } catch (err) {
      this.logger.error(`Error verifying Telegram initData: ${err.message}`);
      return null;
    }
  }

  private extractUserFromInitData(initData: string): AuthenticatedUser | null {
    try {
      const urlParams = new URLSearchParams(initData);
      const userJson = urlParams.get('user');
      if (!userJson) return null;

      const parsedUser = JSON.parse(userJson);
      return {
        id: parsedUser.id,
        telegramId: String(parsedUser.id),
        firstName: parsedUser.first_name,
        username: parsedUser.username,
      };
    } catch {
      return null;
    }
  }
}
