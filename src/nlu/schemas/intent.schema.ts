import { z } from 'zod';

export const TransactionTypeSchema = z.enum(['EXPENSE', 'INCOME']);

export const TransactionItemSchema = z.object({
  type: TransactionTypeSchema.default('EXPENSE'),
  amount: z.number().positive(),
  originalAmount: z.number().positive().nullable().optional(),
  currency: z.string().default('INR'),
  merchant: z.string().nullable().optional(),
  category: z.string().default('Others'),
  description: z.string(),
  transactionDateISO: z.string().optional(),
  splitCount: z.number().int().min(1).default(1),
});

export const IntentTypeSchema = z.enum([
  'CREATE_TRANSACTION',
  'QUERY_EXPENSE_SUMMARY',
  'QUERY_INCOME_SUMMARY',
  'QUERY_CATEGORY_SPENDING',
  'QUERY_TOP_EXPENSES',
  'FINANCIAL_ANALYSIS',
  'BUDGET_QUERY',
  'SET_BUDGET',
  'CREATE_RECURRING',
  'DELETE_TRANSACTION',
  'FINANCIAL_ADVICE',
  'CONVERSATIONAL_CORRECTION',
  'GENERAL_QUESTION',
  'UNKNOWN',
]);

export const LLMToolCallSchema = z.object({
  tool: z.enum([
    'create_transaction',
    'get_expense_summary',
    'get_category_spending',
    'get_top_expenses',
    'get_budget_status',
    'set_budget',
    'ask_financial_intelligence',
    'delete_last_transaction',
  ]),
  parameters: z.record(z.string(), z.any()),
});

export const NLUIntentResponseSchema = z.object({
  intent: IntentTypeSchema,
  confidence: z.number().min(0).max(1).default(1),
  transactions: z.array(TransactionItemSchema).optional(),
  toolCalls: z.array(LLMToolCallSchema).optional(),
  replyText: z.string().optional(),
  targetCategory: z.string().optional(),
  targetPeriod: z.enum(['today', 'yesterday', 'week', 'month', 'year']).optional(),
  correctionField: z.enum(['amount', 'category', 'merchant', 'description']).optional(),
  correctionValue: z.string().optional(),
});

export type TransactionItem = z.infer<typeof TransactionItemSchema>;
export type IntentType = z.infer<typeof IntentTypeSchema>;
export type LLMToolCall = z.infer<typeof LLMToolCallSchema>;
export type NLUIntentResponse = z.infer<typeof NLUIntentResponseSchema>;
