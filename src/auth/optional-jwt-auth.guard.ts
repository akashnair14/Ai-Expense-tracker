import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AuthService } from './auth.service';

@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(OptionalJwtAuthGuard.name);

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
        this.logger.debug(`Optional JWT verification failed: ${err.message}`);
      }
    }

    // Allow unauthenticated guest through (request.user remains undefined)
    return true;
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
}
