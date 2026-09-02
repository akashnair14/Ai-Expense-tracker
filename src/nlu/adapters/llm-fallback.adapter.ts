import axios from 'axios';
import { Logger } from '@nestjs/common';
import { ParsedTransaction } from '../interfaces/nlu-parser.interface';

export class LlmFallbackAdapter {
  public static async parseWithLLM(
    input: string,
  ): Promise<ParsedTransaction | null> {
    const apiKey =
      process.env.LLM_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.GROQ_API_KEY;
    const provider = (process.env.LLM_PROVIDER || 'groq').toLowerCase(); // groq | gemini | openai | openrouter

    if (!apiKey) {
      return null;
    }

    const systemPrompt = `You are a financial transaction NLU parser. Parse natural language into structured JSON.
Current date: ${new Date().toISOString().split('T')[0]}.
Return ONLY valid JSON matching this schema:
{
  "type": "EXPENSE" | "INCOME",
  "amount": number,
  "originalAmount": number | null,
  "currency": "INR" | "USD" | "EUR" | "GBP" etc.,
  "merchant": string | null,
  "category": "Food" | "Groceries" | "Shopping" | "Transport" | "Fuel" | "Bills" | "Rent" | "EMI" | "Entertainment" | "Travel" | "Healthcare" | "Education" | "Investment" | "Insurance" | "Salary" | "Freelance" | "Business" | "Gift" | "Others",
  "description": string,
  "transactionDateISO": string (YYYY-MM-DD),
  "splitCount": number
}`;

    try {
      if (provider === 'gemini') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        const response = await axios.post(
          url,
          {
            contents: [
              {
                parts: [
                  {
                    text: `${systemPrompt}\n\nParse this input message: "${input}"`,
                  },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.1,
            },
          },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 7000,
          },
        );

        const content = response.data.candidates[0]?.content?.parts[0]?.text;
        if (!content) return null;

        const parsed = JSON.parse(content);
        return {
          type: parsed.type || 'EXPENSE',
          amount: Number(parsed.amount) || 0,
          originalAmount: parsed.originalAmount
            ? Number(parsed.originalAmount)
            : undefined,
          currency: parsed.currency || 'INR',
          merchant: parsed.merchant || undefined,
          category: parsed.category || 'Others',
          description: parsed.description || input,
          transactionDate: parsed.transactionDateISO
            ? new Date(parsed.transactionDateISO)
            : new Date(),
          splitCount: Number(parsed.splitCount) || 1,
          rawText: input,
          parsedBy: 'LLM',
          confidence: 0.95,
        };
      }

      if (
        provider === 'groq' ||
        provider === 'openai' ||
        provider === 'openrouter'
      ) {
        const baseUrl =
          provider === 'groq'
            ? 'https://api.groq.com/openai/v1/chat/completions'
            : provider === 'openrouter'
              ? 'https://openrouter.ai/api/v1/chat/completions'
              : 'https://api.openai.com/v1/chat/completions';

        const model =
          provider === 'groq' ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';

        const response = await axios.post(
          baseUrl,
          {
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: input },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.1,
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 5000,
          },
        );

        const content = response.data.choices[0]?.message?.content;
        if (!content) return null;

        const parsed = JSON.parse(content);
        return {
          type: parsed.type || 'EXPENSE',
          amount: Number(parsed.amount) || 0,
          originalAmount: parsed.originalAmount
            ? Number(parsed.originalAmount)
            : undefined,
          currency: parsed.currency || 'INR',
          merchant: parsed.merchant || undefined,
          category: parsed.category || 'Others',
          description: parsed.description || input,
          transactionDate: parsed.transactionDateISO
            ? new Date(parsed.transactionDateISO)
            : new Date(),
          splitCount: Number(parsed.splitCount) || 1,
          rawText: input,
          parsedBy: 'LLM',
          confidence: 0.95,
        };
      }
    } catch (err: any) {
      const logger = new Logger('LlmFallbackAdapter');
      logger.warn(
        `LLM Fallback parsing error (${provider}): ${err?.response?.data?.error?.message || err?.message || err}`,
      );
    }

    return null;
  }
}
