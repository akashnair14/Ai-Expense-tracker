import axios from 'axios';
import { Logger } from '@nestjs/common';
import { NLUIntentResponse, NLUIntentResponseSchema } from '../schemas/intent.schema';
import { ChatMessage } from '../services/conversation-context.service';

export class LlmIntentAdapter {
  private static readonly logger = new Logger(LlmIntentAdapter.name);

  public static async classifyAndDispatch(input: string, context: ChatMessage[] = []): Promise<NLUIntentResponse | null> {
    const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY;
    const provider = (process.env.LLM_PROVIDER || 'groq').toLowerCase();

    if (!apiKey) {
      return null;
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const systemPrompt = `You are PulseAI, an expert financial assistant and NLU intent router.
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
8. CONVERSATIONAL_CORRECTION: User corrects a previous transaction (e.g. "Actually make that groceries", "Change it to 450", "It was yesterday").
9. FINANCIAL_ADVICE: General question about affordability or saving (e.g. "Can I afford a 20k phone?", "How can I save more?").
10. GENERAL_QUESTION: Any other general query.

CRITICAL: Return ONLY valid JSON matching this schema:
{
  "intent": "CREATE_TRANSACTION" | "QUERY_EXPENSE_SUMMARY" | "QUERY_CATEGORY_SPENDING" | "QUERY_TOP_EXPENSES" | "FINANCIAL_ANALYSIS" | "BUDGET_QUERY" | "SET_BUDGET" | "CONVERSATIONAL_CORRECTION" | "FINANCIAL_ADVICE" | "GENERAL_QUESTION",
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
      "tool": "create_transaction" | "get_expense_summary" | "get_category_spending" | "get_top_expenses" | "get_budget_status" | "set_budget" | "ask_financial_intelligence" | "delete_last_transaction",
      "parameters": {}
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

    try {
      if (provider === 'gemini') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
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

        const content = response.data.candidates[0]?.content?.parts[0]?.text;
        if (!content) return null;

        const rawJson = JSON.parse(content);
        return NLUIntentResponseSchema.parse(rawJson);
      }

      if (provider === 'groq' || provider === 'openai' || provider === 'openrouter') {
        const baseUrl =
          provider === 'groq'
            ? 'https://api.groq.com/openai/v1/chat/completions'
            : provider === 'openrouter'
            ? 'https://openrouter.ai/api/v1/chat/completions'
            : 'https://api.openai.com/v1/chat/completions';

        const model = provider === 'groq' ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';

        const messages = [
          { role: 'system', content: systemPrompt },
          ...contextMessages,
          { role: 'user', content: input },
        ];

        const response = await axios.post(
          baseUrl,
          {
            model,
            messages,
            response_format: { type: 'json_object' },
            temperature: 0.1,
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 6000,
          },
        );

        const content = response.data.choices[0]?.message?.content;
        if (!content) return null;

        const rawJson = JSON.parse(content);
        return NLUIntentResponseSchema.parse(rawJson);
      }
    } catch (err: any) {
      this.logger.warn(`LLM Intent Router error (${provider}): ${err?.response?.data?.error?.message || err?.message || err}`);
    }

    return null;
  }
}
