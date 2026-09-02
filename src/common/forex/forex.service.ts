import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export interface CurrencyConversionResult {
  originalAmount: number;
  fromCurrency: string;
  targetCurrency: string;
  convertedAmount: number;
  exchangeRate: number;
}

@Injectable()
export class ForexService {
  private readonly logger = new Logger(ForexService.name);

  // Fallback exchange rates against USD
  private ratesAgainstUSD: Record<string, number> = {
    USD: 1.0,
    INR: 87.5,
    EUR: 0.92,
    GBP: 0.79,
    AED: 3.67,
    CAD: 1.39,
    AUD: 1.54,
    SGD: 1.34,
    JPY: 153.2,
    THB: 34.6,
    SAR: 3.75,
    MYR: 4.45,
    CHF: 0.88,
  };

  private lastFetchTimestamp = 0;
  private readonly CACHE_TTL_MS = 12 * 60 * 60 * 1000;

  async onModuleInit() {
    await this.refreshRates();
  }

  async refreshRates(): Promise<void> {
    const now = Date.now();
    if (now - this.lastFetchTimestamp < this.CACHE_TTL_MS) {
      return;
    }

    try {
      const res = await axios.get('https://open.er-api.com/v6/latest/USD', {
        timeout: 4000,
      });
      if (res.data && res.data.rates) {
        this.ratesAgainstUSD = {
          ...this.ratesAgainstUSD,
          ...res.data.rates,
        };
        this.lastFetchTimestamp = now;
        this.logger.log('Forex exchange rates refreshed successfully.');
      }
    } catch (err: any) {
      this.logger.warn(
        `Forex API fetch failed (${err.message}). Using resilient fallback exchange rates.`,
      );
    }
  }

  public getRate(fromCurrency: string, toCurrency: string): number {
    const from = (fromCurrency || 'INR').toUpperCase();
    const to = (toCurrency || 'INR').toUpperCase();

    if (from === to) return 1.0;

    const fromRateUSD = this.ratesAgainstUSD[from] || 1.0;
    const toRateUSD = this.ratesAgainstUSD[to] || 1.0;

    const rate = toRateUSD / fromRateUSD;
    return Number(rate.toFixed(4));
  }

  public async convert(
    amount: number,
    fromCurrency: string,
    targetCurrency: string,
  ): Promise<CurrencyConversionResult> {
    await this.refreshRates();

    const from = (fromCurrency || 'INR').toUpperCase();
    const target = (targetCurrency || 'INR').toUpperCase();

    if (from === target) {
      return {
        originalAmount: amount,
        fromCurrency: from,
        targetCurrency: target,
        convertedAmount: amount,
        exchangeRate: 1.0,
      };
    }

    const rate = this.getRate(from, target);
    const convertedAmount = Number((amount * rate).toFixed(2));

    return {
      originalAmount: amount,
      fromCurrency: from,
      targetCurrency: target,
      convertedAmount,
      exchangeRate: rate,
    };
  }

  public formatDualCurrency(
    originalAmount: number,
    fromCurrency: string,
    convertedAmount: number,
    targetCurrency: string,
  ): string {
    const from = (fromCurrency || 'INR').toUpperCase();
    const target = (targetCurrency || 'INR').toUpperCase();
    if (from === target) {
      return `${target} ${originalAmount.toLocaleString()}`;
    }
    return `${from} ${originalAmount.toLocaleString()} (≈ ${target} ${convertedAmount.toLocaleString()})`;
  }
}
