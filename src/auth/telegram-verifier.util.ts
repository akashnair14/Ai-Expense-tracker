import * as crypto from 'crypto';

export class TelegramAuthData {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export function verifyTelegramWidgetData(data: TelegramAuthData, botToken: string): boolean {
  try {
    if (!data || !data.hash || !data.id || !data.auth_date) {
      return false;
    }

    // 1. Verify auth_date freshness (reject logins older than 24 hours)
    const now = Math.floor(Date.now() / 1000);
    if (now - Number(data.auth_date) > 86400) {
      return false;
    }

    // 2. Secret key is SHA256 of the bot token
    const secretKey = crypto.createHash('sha256').update(botToken).digest();

    // 3. Build data check string
    const checkKeys: Array<keyof TelegramAuthData> = ['id', 'first_name', 'last_name', 'username', 'photo_url', 'auth_date'];
    const dataCheckArr: string[] = [];

    for (const key of checkKeys) {
      if (data[key] !== undefined && data[key] !== null) {
        dataCheckArr.push(`${key}=${data[key]}`);
      }
    }

    dataCheckArr.sort();
    const dataCheckString = dataCheckArr.join('\n');

    // 4. Compute HMAC-SHA256
    const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (computedHash.length !== data.hash.length) {
      return false;
    }

    return crypto.timingSafeEqual(Buffer.from(computedHash, 'utf-8'), Buffer.from(data.hash, 'utf-8'));
  } catch (err) {
    return false;
  }
}
