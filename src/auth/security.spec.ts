import {
  verifyTelegramWidgetData,
  TelegramAuthData,
} from './telegram-verifier.util';

describe('Telegram Verification Utility', () => {
  it('should reject invalid or missing hash payloads', () => {
    const invalidPayload: TelegramAuthData = {
      id: 123456789,
      auth_date: Math.floor(Date.now() / 1000),
      hash: '',
    };
    expect(verifyTelegramWidgetData(invalidPayload, 'mock_bot_token')).toBe(
      false,
    );
  });

  it('should reject old auth_date logins older than 24 hours', () => {
    const oldPayload: TelegramAuthData = {
      id: 123456789,
      auth_date: Math.floor(Date.now() / 1000) - 90000,
      hash: 'somehash',
    };
    expect(verifyTelegramWidgetData(oldPayload, 'mock_bot_token')).toBe(false);
  });
});
