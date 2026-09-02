import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class TelegramWebhookGuard implements CanActivate {
  private readonly logger = new Logger(TelegramWebhookGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const secretHeader = request.headers['x-telegram-bot-api-secret-token'];
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

    // In production or when TELEGRAM_WEBHOOK_SECRET is set, strictly enforce matching token
    if (expectedSecret) {
      if (!secretHeader || secretHeader !== expectedSecret) {
        this.logger.warn(
          `Unauthorized Webhook Attempt. IP: ${request.ip}, Token Header: ${secretHeader || 'None'}`,
        );
        throw new ForbiddenException(
          'Invalid or missing Telegram Webhook Secret Token',
        );
      }
    } else {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error(
          'CRITICAL: TELEGRAM_WEBHOOK_SECRET is not configured in production. Rejecting unverified webhook.',
        );
        throw new ForbiddenException(
          'Telegram Webhook Secret is not configured on server',
        );
      }
      this.logger.warn(
        'TELEGRAM_WEBHOOK_SECRET is not configured in .env. Webhook security check skipped in dev mode.',
      );
    }

    return true;
  }
}
