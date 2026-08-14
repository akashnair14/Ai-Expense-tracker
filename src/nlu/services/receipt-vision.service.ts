import axios from 'axios';
import { Logger } from '@nestjs/common';
import { ParsedTransaction } from '../interfaces/nlu-parser.interface';

export interface ScannedReceiptResult {
  merchant?: string;
  amount: number;
  currency: string;
  category: string;
  transactionDate: Date;
  description: string;
  items?: Array<{ name: string; price: number }>;
}

export class ReceiptVisionService {
  private static readonly logger = new Logger(ReceiptVisionService.name);

  public static async scanReceiptImage(base64Image: string, mimeType = 'image/jpeg'): Promise<ScannedReceiptResult | null> {
    const apiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY;
    if (!apiKey) {
      this.logger.warn('No LLM / Gemini API Key configured for Receipt Vision.');
      return null;
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const prompt = `You are a receipt/invoice OCR extractor.
Current Date: ${todayStr}.
Analyze this receipt image and extract structured financial data.
Return ONLY valid JSON matching this schema:
{
  "merchant": string | null,
  "amount": number (total amount paid),
  "currency": "INR" | "USD" | "EUR" etc.,
  "category": "Food & Dining" | "Groceries" | "Shopping" | "Travel & Fuel" | "Bills & Utilities" | "Healthcare" | "Entertainment" | "Others",
  "transactionDateISO": "YYYY-MM-DD",
  "description": string,
  "items": [
    { "name": string, "price": number }
  ]
}`;

    try {
      // 1. Google Gemini 1.5 Flash Vision (Native multimodal support)
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
      const response = await axios.post(
        url,
        {
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType,
                    data: base64Image,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1,
          },
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 12000 },
      );

      const content = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!content) return null;

      const parsed = JSON.parse(content);
      if (!parsed.amount || Number(parsed.amount) <= 0) return null;

      return {
        merchant: parsed.merchant || 'Receipt Merchant',
        amount: Number(parsed.amount),
        currency: parsed.currency || 'INR',
        category: parsed.category || 'Shopping',
        transactionDate: parsed.transactionDateISO ? new Date(parsed.transactionDateISO) : new Date(),
        description: parsed.description || `Scanned receipt from ${parsed.merchant || 'merchant'}`,
        items: parsed.items || [],
      };
    } catch (err: any) {
      this.logger.error(`Receipt Vision OCR extraction failed: ${err?.response?.data?.error?.message || err?.message || err}`);
      return null;
    }
  }
}
