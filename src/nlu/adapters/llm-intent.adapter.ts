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
        const groqModels = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'groq/compound'];
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
                max_tokens: 600,
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
            this.logger.warn(`Groq model ${model} unavailable (${modelErr?.response?.status || modelErr.message}). Trying next candidate...`);
            continue;
          }
        }
      } catch (err: any) {
        this.logger.warn(`Primary Groq LLM failed (${err?.message || err}). Escalating to Gemini fallback...`);
      }
    }

    // Tier 2: Fallback to Google Gemini
    const geminiKey = process.env.GEMINI_API_KEY || (primaryProvider === 'gemini' ? primaryKey : null);
    if (geminiKey) {
      try {
        const geminiModels = ['gemini-2.0-flash', 'gemini-1.5-flash'];
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
            this.logger.warn(`Gemini model ${model} unavailable (${mErr?.response?.status || mErr.message}). Trying next candidate...`);
            continue;
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

    // Tier 4: Fast Deterministic Local Rule-based intent classifier fallback
    return LlmIntentAdapter.deterministicFallback(input);
  }

  public static deterministicFallback(input: string): NLUIntentResponse | null {
    const lower = input.toLowerCase().trim();

    // 1. Top expenses query
    if (lower.includes('top') || lower.includes('largest') || lower.includes('biggest') || lower.includes('highest')) {
      return {
        intent: 'QUERY_TOP_EXPENSES',
        confidence: 0.95,
        toolCalls: [{ tool: 'get_top_expenses', parameters: { limit: 5 } }],
        targetPeriod: 'month',
      };
    }

    // 2. Budget query
    if (lower.includes('budget') || lower.includes('limit')) {
      return {
        intent: 'BUDGET_QUERY',
        confidence: 0.9,
        toolCalls: [{ tool: 'get_budget_status', parameters: {} }],
        targetPeriod: 'month',
      };
    }

    // 3. Category spending query (e.g. "how much i sent on petrol?", "food spending", "how much on uber")
    const categoryDomains: Record<string, string[]> = {
      'Fuel': ['petrol', 'fuel', 'diesel', 'gas', 'cng', 'shell', 'hpcl', 'bpcl', 'iocl'],
      'Transport': ['uber', 'ola', 'rapido', 'cab', 'taxi', 'auto', 'metro', 'bus', 'train', 'commute', 'flight', 'travel'],
      'Food & Dining': ['food', 'dining', 'restaurant', 'swiggy', 'zomato', 'lunch', 'dinner', 'breakfast', 'cafe', 'coffee'],
      'Groceries': ['grocery', 'groceries', 'blinkit', 'zepto', 'instamart', 'bigbasket', 'supermarket', 'mart', 'milk'],
      'Shopping': ['shopping', 'amazon', 'flipkart', 'myntra', 'clothes', 'shoes', 'electronics', 'mall', 'zara'],
      'Bills & Utilities': ['bill', 'bills', 'electricity', 'water', 'wifi', 'internet', 'broadband', 'recharge', 'mobile'],
      'Rent': ['rent'],
      'EMI': ['emi', 'loan'],
      'SIP / Investments': ['sip', 'mutual fund', 'investment', 'invest', 'stocks', 'zerodha', 'groww'],
      'Entertainment': ['movie', 'movies', 'cinema', 'netflix', 'spotify', 'entertainment'],
      'Healthcare': ['health', 'healthcare', 'pharmacy', 'medicine', 'medicines', 'doctor'],
      'Miscellaneous': ['misc', 'miscellaneous', 'sundry', 'others', 'other'],
    };

    for (const [catName, keywords] of Object.entries(categoryDomains)) {
      if (keywords.some(k => lower.includes(k))) {
        let period: 'today' | 'week' | 'month' | 'year' = 'month';
        if (lower.includes('today')) period = 'today';
        else if (lower.includes('week')) period = 'week';
        else if (lower.includes('year')) period = 'year';

        return {
          intent: 'QUERY_CATEGORY_SPENDING',
          confidence: 0.9,
          targetCategory: catName,
          targetPeriod: period,
          toolCalls: [
            {
              tool: 'get_category_spending',
              parameters: { category: catName, period },
            },
          ],
        };
      }
    }

    // 4. Overall expense summary
    if (lower.includes('how much') || lower.includes('total spend') || lower.includes('total expense') || lower.includes('summary')) {
      let period: 'today' | 'week' | 'month' | 'year' = 'month';
      if (lower.includes('today')) period = 'today';
      else if (lower.includes('week')) period = 'week';
      else if (lower.includes('year')) period = 'year';

      return {
        intent: 'QUERY_EXPENSE_SUMMARY',
        confidence: 0.85,
        targetPeriod: period,
        toolCalls: [
          {
            tool: 'get_expense_summary',
            parameters: { period },
          },
        ],
      };
    }

    return null;
  }

  public static async generateConversationalReply(
    input: string,
    contextInfo?: string,
  ): Promise<string | null> {
    const primaryProvider = (process.env.LLM_PROVIDER || 'groq').toLowerCase();
    const primaryKey = process.env.LLM_API_KEY || process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY || (primaryProvider === 'groq' ? primaryKey : null);
    const geminiKey = process.env.GEMINI_API_KEY || (primaryProvider === 'gemini' ? primaryKey : null);

    const systemPrompt = `You are Kinetiq Financial Copilot, an elite, friendly personal finance assistant.
The user is asking a conversational question, seeking financial guidance, or chatting about their money.
${contextInfo ? `User Financial Context:\n${contextInfo}\n` : ''}
Provide a clear, practical, concise, and helpful answer in 2 to 4 sentences. If relevant, suggest asking about specific spending (e.g. "How much on food?") or checking safe daily spend.`;

    if (groqKey) {
      const models = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'];
      for (const model of models) {
        try {
          const res = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
              model,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: input },
              ],
              temperature: 0.3,
              max_tokens: 350,
            },
            { headers: { Authorization: `Bearer ${groqKey}` }, timeout: 5000 },
          );
          const reply = res.data.choices[0]?.message?.content;
          if (reply && reply.trim().length > 0) return reply.trim();
        } catch {
          continue;
        }
      }
    }

    if (geminiKey) {
      const models = ['gemini-2.0-flash', 'gemini-1.5-flash'];
      for (const model of models) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
          const res = await axios.post(
            url,
            {
              contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\nUser Question: "${input}"` }] }],
              generationConfig: { temperature: 0.3, maxOutputTokens: 350 },
            },
            { headers: { 'Content-Type': 'application/json' }, timeout: 6000 },
          );
          const reply = res.data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (reply && reply.trim().length > 0) return reply.trim();
        } catch {
          continue;
        }
      }
    }

    return null;
  }

  public static async generateRagAnswer(
    query: string,
    financialContext: string,
  ): Promise<string | null> {
    const primaryProvider = (process.env.LLM_PROVIDER || 'groq').toLowerCase();
    const primaryKey =
      process.env.LLM_API_KEY ||
      process.env.GROQ_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.OPENAI_API_KEY;
    const groqKey =
      process.env.GROQ_API_KEY || (primaryProvider === 'groq' ? primaryKey : null);
    const geminiKey =
      process.env.GEMINI_API_KEY || (primaryProvider === 'gemini' ? primaryKey : null);

    const systemPrompt = `You are Kinetiq Financial Copilot, an elite personal finance assistant.
Your goal is to answer the user's question using their real financial context snapshot.

Financial Context:
${financialContext}

Guidelines:
1. Directly and conversationally answer the user's specific question using their actual numbers and currency.
2. If asking about a specific item, category, or purchase (e.g. "fast food", "petrol", "can I afford..."), reference the relevant amounts and transactions provided.
3. Be concise, actionable, and encouraging (around 2 to 4 bullet points or concise paragraphs).
4. Never make up numbers not present in the context.
5. Format key numbers, merchants, and metrics in **bold**.`;

    if (groqKey) {
      const groqModels = [
        'openai/gpt-oss-120b',
        'qwen/qwen3.8-27b',
        'openai/gpt-oss-20b',
        'groq/compound',
      ];
      for (const model of groqModels) {
        try {
          const res = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
              model,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: query },
              ],
              temperature: 0.2,
              max_tokens: 500,
            },
            {
              headers: {
                Authorization: `Bearer ${groqKey}`,
                'Content-Type': 'application/json',
              },
              timeout: 6000,
            },
          );
          const reply = res.data.choices[0]?.message?.content;
          if (reply && reply.trim().length > 0) return reply.trim();
        } catch {
          continue;
        }
      }
    }

    if (geminiKey) {
      const geminiModels = ['gemini-2.0-flash', 'gemini-1.5-flash'];
      for (const model of geminiModels) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
          const res = await axios.post(
            url,
            {
              contents: [
                {
                  role: 'user',
                  parts: [{ text: `${systemPrompt}\n\nUser Question: "${query}"` }],
                },
              ],
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 500,
              },
            },
            { headers: { 'Content-Type': 'application/json' }, timeout: 6000 },
          );
          const reply = res.data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (reply && reply.trim().length > 0) return reply.trim();
        } catch {
          continue;
        }
      }
    }

    return null;
  }
}
