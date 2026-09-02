import axios from 'axios';
import { Logger } from '@nestjs/common';

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

  public static async scanReceiptImage(
    base64Image: string,
    mimeType = 'image/jpeg',
  ): Promise<ScannedReceiptResult | null> {
    const geminiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
    if (!geminiKey) {
      this.logger.warn(
        'No Gemini API Key configured for Receipt Vision.',
      );
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

    const visionModels = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-1.5-flash'];

    for (const model of visionModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
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
          { headers: { 'Content-Type': 'application/json' }, timeout: 15000 },
        );

        const content = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!content) continue;

        const parsed = JSON.parse(content);
        if (!parsed.amount || Number(parsed.amount) <= 0) continue;

        return {
          merchant: parsed.merchant || 'Receipt Merchant',
          amount: Number(parsed.amount),
          currency: parsed.currency || 'INR',
          category: parsed.category || 'Shopping',
          transactionDate: parsed.transactionDateISO
            ? new Date(parsed.transactionDateISO)
            : new Date(),
          description:
            parsed.description ||
            `Scanned receipt from ${parsed.merchant || 'merchant'}`,
          items: parsed.items || [],
        };
      } catch (err: any) {
        if (err?.response?.status === 404) continue;
        this.logger.warn(`Receipt Vision with ${model} failed (${err?.message || err}). Trying next model...`);
      }
    }

    return null;
  }
}
