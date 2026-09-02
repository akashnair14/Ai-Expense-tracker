import { ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { TelegramWebAppAuthGuard } from '../telegram/guards/telegram-webapp-auth.guard';
import { TelegramWebhookGuard } from '../telegram/guards/telegram-webhook.guard';

describe('Production Authentication Security Hardening', () => {
  let webappGuard: TelegramWebAppAuthGuard;
  let webhookGuard: TelegramWebhookGuard;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    webappGuard = new TelegramWebAppAuthGuard();
    webhookGuard = new TelegramWebhookGuard();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  function createMockContext(headers: Record<string, string>, params: Record<string, string> = {}, body: any = {}): ExecutionContext {
    const req = {
      headers,
      params,
      body,
      user: undefined,
      ip: '127.0.0.1',
    };
    return {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    } as any;
  }

  it('strictly rejects plain numeric Telegram ID bypass in production', () => {
    process.env.NODE_ENV = 'production';
    const ctx = createMockContext({ authorization: '123456789' });
    expect(() => webappGuard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('strictly rejects parameter telegramId bypass in production', () => {
    process.env.NODE_ENV = 'production';
    const ctx = createMockContext({}, { telegramId: '123456789' });
    expect(() => webappGuard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('strictly rejects webhook traffic in production if secret is not configured', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const ctx = createMockContext({});
    expect(() => webhookGuard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
