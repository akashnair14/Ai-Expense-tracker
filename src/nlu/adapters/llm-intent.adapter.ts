import axios from 'axios';
import { Logger } from '@nestjs/common';
import {
  NLUIntentResponse,
  NLUIntentResponseSchema,
} from '../schemas/intent.schema';
import { ChatMessage } from '../services/conversation-context.service';

export class LlmIntentAdapter {
  private static readonly logger = new Logger(LlmIntentAdapter.name);

  public static async classifyAndDispatch(
    input: string,
    context: ChatMessage[] = [],
  ): Promise<NLUIntentResponse | null> {
    const todayStr = new Date().toISOString().split('T')[0];
    const systemPrompt = `You are Kinetiq Money, an expert financial assistant and NLU intent router.
Current Date: ${todayStr}.

Your task is to analyze user input, determine their intent, extract transactions, and/or choose the appropriate tool call.

Recognized Categories:
"Food & Dining", "Groceries", "Shopping", "Transport", "Travel & Fuel", "Bills & Utilities", "Rent", "EMI", "Entertainment", "Healthcare", "Education", "Investment", "Insurance", "Salary", "Freelance", "Business", "Gift", "Others"

Intents:
1. CREATE_TRANSACTION: User logged one or more expenses/income (e.g. "Dinner 400", "Spent 1200 on groceries", "Received salary 60000", "Dinner with 3 friends 1800 split by 4").
2. QUERY_EXPENSE_SUMMARY: User wants to know total spent (e.g. "How much did I spend this month?", "Show my total expenses for today").
3. QUERY_CATEGORY_SPENDING: User asks about a specific category (e.g. "How much did I spend on food this month?", "Uber spending this week").
4. QUERY_TOP_EXPENSES: User asks about highest expenses (e.g. "What are my biggest expenses?", "Where did most of my money go?").
5. FINANCIAL_ANALYSIS: User asks for an overview or comparison (e.g. "Where did my money go this month?", "Why did my savings drop?").
6. BUDGET_QUERY: User asks about budget status (e.g. "How is my budget looking?", "What's left in food budget?").
7. SET_BUDGET: User wants to set a budget limit (e.g. "Set food budget to 8000", "Limit shopping to 5000").
8. CREATE_RECURRING: User wants to set a recurring salary, rent, subscription, or EMI (e.g. "Salary 39279 on 4th of every month", "Rent 15000 every 1st", "Netflix 649 monthly").
9. CONVERSATIONAL_CORRECTION: User corrects a previous transaction (e.g. "Actually make that groceries", "Change it to 450", "It was yesterday").
10. FINANCIAL_ADVICE: General question about affordability or saving (e.g. "Can I afford a 20k phone?", "How can I save more?").
11. GENERAL_QUESTION: Any other general query.

CRITICAL: Return ONLY valid JSON matching this schema:
{
  "intent": "CREATE_TRANSACTION" | "QUERY_EXPENSE_SUMMARY" | "QUERY_CATEGORY_SPENDING" | "QUERY_TOP_EXPENSES" | "FINANCIAL_ANALYSIS" | "BUDGET_QUERY" | "SET_BUDGET" | "CREATE_RECURRING" | "CONVERSATIONAL_CORRECTION" | "FINANCIAL_ADVICE" | "GENERAL_QUESTION",
  "confidence": number (0.0 to 1.0),
  "transactions": [
    {
      "type": "EXPENSE" | "INCOME",
      "amount": number,
      "originalAmount": number | null,
      "currency": "INR",
      "merchant": string | null,
      "category": string,
      "description": string,
      "transactionDateISO": "YYYY-MM-DD",
      "splitCount": number
    }
  ],
  "toolCalls": [
    {
      "tool": "create_transaction" | "get_expense_summary" | "get_category_spending" | "get_top_expenses" | "get_budget_status" | "set_budget" | "create_recurring" | "ask_financial_intelligence" | "delete_last_transaction",
      "parameters": {
        "name": "string (for create_recurring)",
        "amount": "number",
        "type": "INCOME or EXPENSE",
        "day": "number (day of month, 1-31)"
      }
    }
  ],
  "targetCategory": string | null,
  "targetPeriod": "today" | "yesterday" | "week" | "month" | "year" | null,
  "correctionField": "amount" | "category" | "merchant" | "description" | null,
  "correctionValue": string | null,
  "replyText": string | null
}`;

    const contextMessages = context.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Tier 1: Try Primary Configured Provider
    const primaryProvider = (process.env.LLM_PROVIDER || 'groq').toLowerCase();
    const primaryKey = process.env.LLM_API_KEY || process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;

    // 1. Try Groq if key available
    const groqKey = process.env.GROQ_API_KEY || (primaryProvider === 'groq' ? primaryKey : null);
    if (groqKey) {
      try {
        const groqModels = ['qwen/qwen3.8-27b', 'groq/compound', 'openai/gpt-oss-120b', 'llama-3.3-70b-versatile'];
        for (const model of groqModels) {
          try {
            const res = await axios.post(
              'https://api.groq.com/openai/v1/chat/completions',
              {
                model,
                messages: [
                  { role: 'system', content: systemPrompt },
                  ...contextMessages,
                  { role: 'user', content: input },
                ],
                response_format: { type: 'json_object' },
                temperature: 0.1,
              },
              {
                headers: {
                  Authorization: `Bearer ${groqKey}`,
                  'Content-Type': 'application/json',
                },
                timeout: 5000,
              },
            );

            const content = res.data.choices[0]?.message?.content;
            if (content) {
              const rawJson = JSON.parse(content);
              return NLUIntentResponseSchema.parse(rawJson);
            }
          } catch (modelErr: any) {
            if (modelErr?.response?.status === 404) continue; // Try next model name
            throw modelErr;
          }
        }
      } catch (err: any) {
        this.logger.warn(`Primary Groq LLM failed (${err?.message || err}). Escalating to Gemini fallback...`);
      }
    }

    // Tier 2: Fallback to Google Gemini (gemini-3.5-flash-lite / gemini-2.5-flash)
    const geminiKey = process.env.GEMINI_API_KEY || (primaryProvider === 'gemini' ? primaryKey : null);
    if (geminiKey) {
      try {
        const geminiModels = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-2.5-flash'];
        for (const model of geminiModels) {
          try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
            const contents = [
              ...contextMessages.map((m) => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }],
              })),
              {
                role: 'user',
                parts: [{ text: `${systemPrompt}\n\nUser Message: "${input}"` }],
              },
            ];

            const response = await axios.post(
              url,
              {
                contents,
                generationConfig: {
                  responseMimeType: 'application/json',
                  temperature: 0.1,
                },
              },
              { headers: { 'Content-Type': 'application/json' }, timeout: 7000 },
            );

            const content = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (content) {
              const rawJson = JSON.parse(content);
              return NLUIntentResponseSchema.parse(rawJson);
            }
          } catch (mErr: any) {
            if (mErr?.response?.status === 404) continue;
            throw mErr;
          }
        }
      } catch (err: any) {
        this.logger.warn(`Gemini LLM fallback failed (${err?.message || err}).`);
      }
    }

    // Tier 3: Fallback to OpenAI (if OPENAI_API_KEY configured)
    const openaiKey = process.env.OPENAI_API_KEY || (primaryProvider === 'openai' ? primaryKey : null);
    if (openaiKey) {
      try {
        const res = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: systemPrompt },
              ...contextMessages,
              { role: 'user', content: input },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.1,
          },
          {
            headers: {
              Authorization: `Bearer ${openaiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 6000,
          },
        );

        const content = res.data.choices[0]?.message?.content;
        if (content) {
          const rawJson = JSON.parse(content);
          return NLUIntentResponseSchema.parse(rawJson);
        }
      } catch (err: any) {
        this.logger.warn(`OpenAI fallback failed (${err?.message || err}).`);
      }
    }

    return null;
  }
}
