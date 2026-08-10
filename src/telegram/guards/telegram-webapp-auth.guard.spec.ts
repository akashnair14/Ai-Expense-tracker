import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { TelegramWebAppAuthGuard } from './telegram-webapp-auth.guard';

describe('TelegramWebAppAuthGuard', () => {
  let guard: TelegramWebAppAuthGuard;

  beforeEach(() => {
    guard = new TelegramWebAppAuthGuard();
  });

  function createMockContext(headers: Record<string, string>, params: Record<string, string> = {}, body: any = {}): ExecutionContext {
    const req = {
      headers,
      params,
      body,
      user: undefined,
    };
    return {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    } as any;
  }

  it('should pass in development mode fallback when headers are missing', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.TELEGRAM_BOT_TOKEN;

    const ctx = createMockContext({}, { telegramId: '123456789' });
    const canActivate = guard.canActivate(ctx);

    expect(canActivate).toBe(true);
  });

  it('should throw UnauthorizedException when auth header is missing in non-dev mode', () => {
    process.env.NODE_ENV = 'production';
    process.env.TELEGRAM_BOT_TOKEN = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';

    const ctx = createMockContext({});
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
