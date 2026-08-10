import { subDays, subWeeks, startOfDay } from 'date-fns';

export class RegexParser {
  private static CURRENCY_MAP: Record<string, string> = {
    '₹': 'INR',
    'rs': 'INR',
    'rs.': 'INR',
    'inr': 'INR',
    '$': 'USD',
    'usd': 'USD',
    '€': 'EUR',
    'eur': 'EUR',
    '£': 'GBP',
    'gbp': 'GBP',
  };

  public static parse(input: string) {
    const text = input.trim();
    if (!text) return null;

    let type: 'EXPENSE' | 'INCOME' = 'EXPENSE';
    let amount = 0;
    let originalAmount = 0;
    let currency = 'INR';
    let splitCount = 1;
    let transactionDate = new Date();
    let merchant: string | undefined = undefined;
    let description = text;

    // 1. Detect Income keywords
    const lowerText = text.toLowerCase();
    if (
      lowerText.includes('salary') ||
      lowerText.includes('received') ||
      lowerText.includes('freelance') ||
      lowerText.includes('cashback') ||
      text.includes('+')
    ) {
      type = 'INCOME';
    }

    // 2. Detect Currency
    for (const [symbol, code] of Object.entries(this.CURRENCY_MAP)) {
      if (lowerText.includes(symbol)) {
        currency = code;
        break;
      }
    }

    // 3. Detect Split Payment (e.g. "split with 4", "split by 2")
    const splitMatch = lowerText.match(/split\s+(?:with|by)?\s*(\d+)/i);
    if (splitMatch) {
      splitCount = parseInt(splitMatch[1], 10);
    }

    // 4. Extract Amount
    // Strip ordinal date expressions like "25th", "1st", "2nd" before amount parsing
    const textForAmount = text.replace(/\b\d{1,2}(?:st|nd|rd|th)\b/gi, '');
    const amountMatch = textForAmount.match(/(?:[₹$€£]\s*)?([+-]?\d+(?:,\d+)*(?:\.\d+)?)/);
    if (amountMatch) {
      const parsedNum = parseFloat(amountMatch[1].replace(/,/g, '').replace('+', ''));
      if (!isNaN(parsedNum) && parsedNum > 0) {
        originalAmount = parsedNum;
        amount = splitCount > 1 ? originalAmount / splitCount : originalAmount;
      }
    }

    if (amount <= 0) {
      return null; // Could not extract a valid amount via Regex
    }

    // 5. Detect Date keywords
    if (lowerText.includes('yesterday')) {
      transactionDate = subDays(new Date(), 1);
    } else if (lowerText.includes('last monday')) {
      transactionDate = subWeeks(new Date(), 1); // Simplification, customizable
    }

    // 6. Infer Merchant / Description
    // Clean text by removing amounts, split terms, dates
    let cleanText = text
      .replace(/(?:[₹$€£]\s*)?([+-]?\d+(?:,\d+)*(?:\.\d+)?)/g, '')
      .replace(/split\s+(?:with|by)?\s*\d+/gi, '')
      .replace(/yesterday|today|last monday/gi, '')
      .replace(/paid|received|for/gi, '')
      .trim();

    if (cleanText.length > 0) {
      description = cleanText;
      const firstWord = cleanText.split(/\s+/)[0];
      if (firstWord && firstWord.length > 2) {
        merchant = firstWord;
      }
    }

    return {
      type,
      amount,
      originalAmount: splitCount > 1 ? originalAmount : undefined,
      currency,
      merchant,
      category: 'Others', // Will be enriched by Dictionary Mapper
      description,
      transactionDate,
      splitCount,
      rawText: input,
      parsedBy: 'REGEX' as const,
      confidence: 0.8,
    };
  }
}
