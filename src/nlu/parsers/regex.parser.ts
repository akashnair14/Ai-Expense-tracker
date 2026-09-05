import { subDays, subWeeks } from 'date-fns';
import { CategoryDictionaryMapper } from '../mappers/category-dictionary.mapper';
import { ParsedTransaction } from '../interfaces/nlu-parser.interface';

export class RegexParser {
  private static CURRENCY_MAP: Record<string, string> = {
    '₹': 'INR',
    'rs.': 'INR',
    rs: 'INR',
    rupees: 'INR',
    rupee: 'INR',
    inr: 'INR',
    $: 'USD',
    usd: 'USD',
    dollars: 'USD',
    dollar: 'USD',
    bucks: 'USD',
    '€': 'EUR',
    eur: 'EUR',
    euros: 'EUR',
    euro: 'EUR',
    '£': 'GBP',
    gbp: 'GBP',
    pounds: 'GBP',
    pound: 'GBP',
  };

  private static STOP_WORDS = new Set([
    'rupees',
    'rupee',
    'rs',
    'rs.',
    'inr',
    'usd',
    'dollars',
    'dollar',
    'bucks',
    'eur',
    'euros',
    'euro',
    'gbp',
    'pounds',
    'pound',
    'paid',
    'pay',
    'paying',
    'spent',
    'spend',
    'spending',
    'received',
    'got',
    'debited',
    'credited',
    'payout',
    'bought',
    'buy',
    'purchased',
    'purchase',
    'cost',
    'costs',
    'amount',
    'sent',
    'transferred',
    'withdrawn',
    'for',
    'at',
    'on',
    'to',
    'from',
    'in',
    'by',
    'via',
    'using',
    'with',
    'and',
    'the',
    'a',
    'an',
    'of',
    'upi',
    'ref',
    'pvt',
    'ltd',
    'private',
    'limited',
    'bank',
  ]);

  private static capitalize(str: string): string {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  // Multiplier parser helper (e.g. 2.5k -> 2500, 1.5 lakhs -> 150000, 1 cr -> 10000000)
  public static parseMultiplierAmount(
    numStr: string,
    unitStr?: string,
  ): number {
    const base = parseFloat(numStr.replace(/,/g, '').replace('+', ''));
    if (isNaN(base)) return 0;

    const unit = (unitStr || '').toLowerCase().trim();
    if (unit === 'k' || unit === 'kilo' || unit === 'grand') {
      return base * 1000;
    }
    if (
      unit === 'lakh' ||
      unit === 'lakhs' ||
      unit === 'lac' ||
      unit === 'lacs' ||
      unit === 'l'
    ) {
      return base * 100000;
    }
    if (unit === 'cr' || unit === 'crore' || unit === 'crores') {
      return base * 10000000;
    }
    if (unit === 'm' || unit === 'million' || unit === 'millions') {
      return base * 1000000;
    }
    return base;
  }

  // Parse Bank / UPI SMS formatted alerts
  public static parseBankSms(input: string): ParsedTransaction | null {
    const text = input.trim();

    // Strict Bank SMS detection: must have bank/account/txn markers AND debit/credit verbs
    const hasSmsMarkers =
      /\b(?:a\/c|acct|ending|card|upi ref|bank|debited by|credited with|vpa|inr\.?|rs\.?)\b/i.test(
        text,
      );
    const hasTxnVerbs =
      /\b(?:debited|credited|transferred|withdrawn|deposited|payment of)\b/i.test(
        text,
      );

    if (!hasSmsMarkers || !hasTxnVerbs) return null;

    let type: 'EXPENSE' | 'INCOME' = 'EXPENSE';
    if (/\b(?:credited|deposited|refunded|received|income)\b/i.test(text)) {
      type = 'INCOME';
    }

    // Extract amount: e.g. "debited by Rs.450.00", "Rs 1,250.00 debited", "INR 3,400 credited", "Rs. 65000"
    const amountMatch =
      text.match(
        /(?:debited|credited|spent|sent|payment of)\s+(?:by|with|for|of)?\s*(?:(?:rs\.?|inr|₹|\$)\s*)?([\d,]+(?:\.\d+)?)/i,
      ) ||
      text.match(
        /(?:(?:rs\.?|inr|₹|\$)\s*([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*(?:rs\.?|inr|rupees))/i,
      );

    if (!amountMatch) return null;
    const rawNum = amountMatch[1] || amountMatch[2];
    const amount = parseFloat(rawNum.replace(/,/g, ''));
    if (isNaN(amount) || amount <= 0) return null;

    // Extract Payee / Merchant / Purpose: look for "to <Payee>", "at <Merchant>", "towards <Purpose>", "info: <Payee>"
    let merchant: string | undefined = undefined;
    const payeeMatch = text.match(
      /\b(?:to|at|towards|info:?|vpa:?)\s+([A-Za-z0-9'&.-]+(?:\s+[A-Za-z0-9'&.-]+)?)/i,
    );
    if (
      payeeMatch &&
      !this.STOP_WORDS.has(payeeMatch[1].toLowerCase()) &&
      !/^(a\/c|card|upi|ref|bank|ending)/i.test(payeeMatch[1])
    ) {
      let rawMerchant = payeeMatch[1].replace(/^(vpa|upi|ref)\s*/i, '').trim();
      // Clean trailing UPI or Ref tokens e.g. "ZOMATO UPI" -> "ZOMATO"
      rawMerchant = rawMerchant
        .replace(/\s+(?:upi|ref|ltd|pvt|bank|private|limited)$/i, '')
        .trim();
      if (rawMerchant.length > 1) {
        merchant = rawMerchant;
      }
    }

    const dict = CategoryDictionaryMapper.categorize(text);
    const description = merchant
      ? `Payment to ${this.capitalize(merchant)}`
      : type === 'INCOME'
        ? 'Bank Credit / Income'
        : 'Bank Debit / Expense';

    return {
      type,
      amount,
      currency: 'INR',
      merchant: merchant ? this.capitalize(merchant) : undefined,
      category:
        dict.category !== 'Others'
          ? dict.category
          : type === 'INCOME'
            ? 'Salary'
            : 'Bills',
      description,
      transactionDate: new Date(),
      splitCount: 1,
      rawText: input,
      parsedBy: 'REGEX',
      confidence: 0.95,
    };
  }

  // Parse multi-item batch lists (e.g. "Lunch 200, tea 40, cab 180" or multiline)
  public static parseBatch(input: string): ParsedTransaction[] | null {
    const text = input.trim();
    if (!text) return null;

    // If input is a Bank SMS or contains recurring signals, don't split as batch
    if (/\b(?:debited|credited|a\/c|upi ref|every month)\b/i.test(text)) {
      return null;
    }

    // Split on newlines or commas (or " and ")
    const delimiters = /[\n,]|(?:\s+and\s+)/i;
    const items = text
      .split(delimiters)
      .map((s) => s.trim())
      .filter((s) => s.length > 2);

    if (items.length <= 1) {
      return null;
    }

    const parsedList: ParsedTransaction[] = [];
    for (const item of items) {
      const parsed = this.parseSingle(item);
      if (parsed && parsed.amount > 0) {
        if (parsed.category === 'Others') {
          const dictCat = CategoryDictionaryMapper.categorize(item);
          parsed.category = dictCat.category;
        }
        parsedList.push(parsed);
      }
    }

    return parsedList.length >= 2 ? parsedList : null;
  }

  public static parse(input: string): ParsedTransaction | null {
    // Check Bank SMS first
    const sms = this.parseBankSms(input);
    if (sms) return sms;

    return this.parseSingle(input);
  }

  private static parseSingle(input: string): ParsedTransaction | null {
    const text = input.trim();
    if (!text) return null;

    const lowerText = text.toLowerCase();

    // Reject recurring schedule triggers
    if (
      lowerText.includes('every month') ||
      lowerText.includes('each month') ||
      lowerText.includes('per month') ||
      /on\s+\d{1,2}(?:st|nd|rd|th)?\s+of\s+every\s+month/i.test(lowerText) ||
      /every\s+\d{1,2}(?:st|nd|rd|th)/i.test(lowerText) ||
      /\d{1,2}(?:st|nd|rd|th)\s+of\s+every\s+month/i.test(lowerText)
    ) {
      return null;
    }

    let type: 'EXPENSE' | 'INCOME' = 'EXPENSE';
    let amount = 0;
    let originalAmount = 0;
    let currency = 'INR';
    let splitCount = 1;
    let transactionDate = new Date();
    let merchant: string | undefined = undefined;

    // 1. Detect Income keywords (excluding tax payments)
    const isIncomeTax =
      lowerText.includes('income tax') || lowerText.includes('tax paid');
    if (
      !isIncomeTax &&
      (lowerText.includes('salary') ||
        lowerText.includes('income') ||
        lowerText.includes('earned') ||
        lowerText.includes('earning') ||
        lowerText.includes('earnings') ||
        lowerText.includes('received') ||
        lowerText.includes('freelance') ||
        lowerText.includes('cashback') ||
        lowerText.includes('credited') ||
        lowerText.includes('deposited') ||
        lowerText.includes('payout') ||
        lowerText.includes('dividend') ||
        lowerText.includes('profit') ||
        lowerText.includes('refund') ||
        lowerText.includes('sold') ||
        lowerText.includes('stipend') ||
        lowerText.includes('bonus') ||
        lowerText.includes('allowance') ||
        lowerText.includes('got paid') ||
        text.includes('+'))
    ) {
      type = 'INCOME';
    }

    // 2. Detect Currency
    for (const [symbol, code] of Object.entries(this.CURRENCY_MAP)) {
      const pattern =
        symbol.startsWith('₹') ||
        symbol.startsWith('$') ||
        symbol.startsWith('€') ||
        symbol.startsWith('£')
          ? new RegExp(`\\${symbol}`)
          : new RegExp(`\\b${symbol}\\b`, 'i');
      if (pattern.test(text)) {
        currency = code;
        break;
      }
    }

    // 3. Detect Split Payment (e.g. "split with 4", "split by 2")
    const splitMatch = lowerText.match(/split\s+(?:with|by|between)?\s*(\d+)/i);
    if (splitMatch) {
      splitCount = parseInt(splitMatch[1], 10);
    }

    // 4. Extract Amount with Multiplier Support (e.g. "15k", "2.5k", "1.5 lakhs", "2 cr", "500")
    const textForAmount = text.replace(/\b\d{1,2}(?:st|nd|rd|th)\b/gi, '');

    // Pattern A: Number with multiplier unit (e.g. "15k", "2.5k", "1.5 lakh", "2 cr", "10 grand")
    const multiplierMatch = textForAmount.match(
      /(?:[₹$€£]\s*|rs\.?\s*|inr\s*|\$\s*)?([+-]?\d+(?:,\d+)*(?:\.\d+)?)\s*(k|kilo|grand|lakhs?|lacs?|cr(?:ores?)?|m|millions?)\b/i,
    );

    // Pattern B: Plain number
    const standardAmountMatch = textForAmount.match(
      /(?:[₹$€£]\s*|rs\.?\s*|inr\s*|\$\s*)?([+-]?\d+(?:,\d+)*(?:\.\d+)?)/i,
    );

    if (multiplierMatch) {
      const numStr = multiplierMatch[1];
      const unitStr = multiplierMatch[2];
      originalAmount = this.parseMultiplierAmount(numStr, unitStr);
      amount = splitCount > 1 ? originalAmount / splitCount : originalAmount;
    } else if (standardAmountMatch) {
      const parsedNum = parseFloat(
        standardAmountMatch[1].replace(/,/g, '').replace('+', ''),
      );
      if (!isNaN(parsedNum) && parsedNum > 0) {
        originalAmount = parsedNum;
        amount = splitCount > 1 ? originalAmount / splitCount : originalAmount;
      }
    }

    if (amount <= 0) {
      return null;
    }

    // 5. Detect Date keywords
    if (lowerText.includes('yesterday')) {
      transactionDate = subDays(new Date(), 1);
    } else if (lowerText.includes('last monday')) {
      transactionDate = subWeeks(new Date(), 1);
    }

    // 6. Merchant Extraction via Prepositions & Keywords
    const atMatch = text.match(
      /\bat\s+([A-Za-z0-9'&.-]+(?:\s+[A-Za-z0-9'&.-]+)?)/i,
    );
    const toMatch = text.match(
      /\bto\s+([A-Za-z0-9'&.-]+(?:\s+[A-Za-z0-9'&.-]+)?)/i,
    );
    const fromMatch = text.match(
      /\bfrom\s+([A-Za-z0-9'&.-]+(?:\s+[A-Za-z0-9'&.-]+)?)/i,
    );

    if (atMatch && !this.STOP_WORDS.has(atMatch[1].toLowerCase())) {
      merchant = atMatch[1].trim();
    } else if (
      toMatch &&
      !this.STOP_WORDS.has(toMatch[1].toLowerCase()) &&
      !toMatch[1].toLowerCase().includes('office') &&
      !toMatch[1].toLowerCase().includes('home') &&
      !toMatch[1].toLowerCase().includes('airport')
    ) {
      merchant = toMatch[1].trim();
    } else if (fromMatch && !this.STOP_WORDS.has(fromMatch[1].toLowerCase())) {
      merchant = fromMatch[1].trim();
    }

    // 7. Clean Description
    let clean = text
      .replace(
        /(?:[₹$€£]\s*|rs\.?\s*|inr\s*|\$\s*)?[+-]?\d+(?:,\d+)*(?:\.\d+)?\s*(k|kilo|grand|lakhs?|lacs?|cr(?:ores?)?|m|millions?)?/gi,
        '',
      )
      .replace(/split\s+(?:with|by|between)?\s*\d+/gi, '')
      .replace(/\b(yesterday|today|last monday|last week|tonight)\b/gi, '')
      .replace(
        /\b(rupees|rupee|rs|rs\.|inr|usd|dollars?|bucks|eur|euros?|gbp|pounds?)\b/gi,
        '',
      )
      .replace(
        /\b(paid|paying|spent|spend|spending|received|credited|debited|got|bought|purchased|cost|costs|earned|earning|earnings)\b/gi,
        '',
      )
      .trim();

    clean = clean.replace(
      /^(for|at|on|to|from|in|by|via|using|with|and|the|a|an|of)\s+/i,
      '',
    );
    clean = clean.replace(
      /\s+(for|at|on|to|from|in|by|via|using|with|and|the|a|an|of)$/i,
      '',
    );
    clean = clean.replace(/\s+/g, ' ').trim();

    const words = clean
      .split(/\s+/)
      .filter((w) => !this.STOP_WORDS.has(w.toLowerCase()));
    if (!merchant && words.length > 0) {
      const candidate = words[0];
      const knownBrands = new Set([
        'zomato',
        'swiggy',
        'uber',
        'ola',
        'blinkit',
        'zepto',
        'instamart',
        'amazon',
        'flipkart',
        'starbucks',
        'mcdonalds',
        'kfc',
        'dominos',
        'netflix',
        'spotify',
        'airtel',
        'jio',
        'zerodha',
        'groww',
      ]);
      if (knownBrands.has(candidate.toLowerCase())) {
        merchant = this.capitalize(candidate);
      }
    }

    const description =
      clean.length > 0
        ? this.capitalize(clean)
        : type === 'INCOME'
          ? 'Income'
          : 'General Expense';

    if (merchant && this.STOP_WORDS.has(merchant.toLowerCase())) {
      merchant = undefined;
    }

    const dict = CategoryDictionaryMapper.categorize(text);
    const category =
      dict.category !== 'Others'
        ? dict.category
        : type === 'INCOME'
          ? 'Salary'
          : 'Others';

    return {
      type,
      amount,
      originalAmount: splitCount > 1 ? originalAmount : undefined,
      currency,
      merchant: merchant ? this.capitalize(merchant) : undefined,
      category,
      description,
      transactionDate,
      splitCount,
      rawText: input,
      parsedBy: 'REGEX' as const,
      confidence: 0.9,
    };
  }
}
