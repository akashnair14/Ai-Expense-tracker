import { z } from 'zod';

/**
 * Robust financial amount schema:
 * - Coerces numbers / numeric strings
 * - Strictly rejects NaN, Infinity, -Infinity
 * - Enforces finite positive numbers (or non-negative where required)
 * - Maximum boundary to prevent numeric overflow in DB (e.g. 100 Billion)
 */
export const FinancialAmountSchema = z.preprocess(
  (val) => {
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed === '') return NaN;
      return Number(trimmed);
    }
    return val;
  },
  z
    .number()
    .refine(
      (n) =>
        Number.isFinite(n) && !Number.isNaN(n) && n > 0 && n <= 100_000_000_000,
      {
        message: 'Amount must be a valid, finite positive number',
      },
    ),
);

export const NonNegativeFinancialAmountSchema = z.preprocess(
  (val) => {
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed === '') return NaN;
      return Number(trimmed);
    }
    return val;
  },
  z
    .number()
    .refine(
      (n) =>
        Number.isFinite(n) &&
        !Number.isNaN(n) &&
        n >= 0 &&
        n <= 100_000_000_000,
      {
        message: 'Amount must be a valid, finite non-negative number',
      },
    ),
);

export const TransactionTypeSchema = z.enum(['EXPENSE', 'INCOME']);

export const TransactionCategorySchema = z
  .string()
  .trim()
  .min(1, 'Category name cannot be empty')
  .max(50, 'Category name must not exceed 50 characters');

export const TransactionMerchantSchema = z
  .string()
  .trim()
  .max(100, 'Merchant name must not exceed 100 characters')
  .optional()
  .nullable();

export const TransactionDescriptionSchema = z
  .string()
  .trim()
  .max(255, 'Description must not exceed 255 characters')
  .optional()
  .nullable();

export const CurrencySchema = z.string().trim().min(1).max(10).default('INR');

export const TransactionDateSchema = z.preprocess(
  (val) => {
    if (!val) return new Date();
    if (typeof val === 'string' || typeof val === 'number') {
      const d = new Date(val);
      return isNaN(d.getTime()) ? undefined : d;
    }
    if (val instanceof Date) {
      return isNaN(val.getTime()) ? undefined : val;
    }
    return undefined;
  },
  z.date({ message: 'Invalid transaction date' }),
);

export const SplitCountSchema = z.preprocess((val) => {
  if (typeof val === 'string') return parseInt(val.trim(), 10);
  return val;
}, z.number().int().min(1).max(100).default(1));

// Manual Transaction Creation Payload Schema
export const CreateManualTransactionSchema = z.object({
  type: TransactionTypeSchema.default('EXPENSE'),
  amount: FinancialAmountSchema,
  originalAmount: FinancialAmountSchema.optional().nullable(),
  merchant: TransactionMerchantSchema,
  categoryName: TransactionCategorySchema.optional(),
  description: TransactionDescriptionSchema,
  transactionDate: TransactionDateSchema.optional(),
  currency: CurrencySchema.optional(),
  splitCount: SplitCountSchema.optional(),
});

export type CreateManualTransactionDto = z.infer<
  typeof CreateManualTransactionSchema
>;

// Set Budget Payload Schema
export const SetBudgetSchema = z.object({
  categoryName: TransactionCategorySchema,
  monthlyLimit: FinancialAmountSchema,
  month: z.number().int().min(1).max(12).optional(),
  year: z.number().int().min(2000).max(2100).optional(),
});

export type SetBudgetDto = z.infer<typeof SetBudgetSchema>;

// Create Recurring Payload Schema
export const CreateRecurringSchema = z.object({
  type: TransactionTypeSchema.default('EXPENSE'),
  name: z.string().trim().min(1, 'Name is required').max(100),
  amount: FinancialAmountSchema,
  categoryName: TransactionCategorySchema.optional(),
  dayOfMonth: z.preprocess((val) => {
    if (typeof val === 'string') return parseInt(val.trim(), 10);
    return val;
  }, z.number().int().min(1).max(31).default(1)),
});

export type CreateRecurringDto = z.infer<typeof CreateRecurringSchema>;

// Email Registration Schema
export const RegisterWithEmailSchema = z.object({
  email: z.string().trim().email('Invalid email address').max(255),
  password: z
    .string()
    .min(6, 'Password must be at least 6 characters')
    .max(128),
  name: z.string().trim().max(100).optional(),
});

export type RegisterWithEmailDto = z.infer<typeof RegisterWithEmailSchema>;

// Email Login Schema
export const LoginWithEmailSchema = z.object({
  email: z.string().trim().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export type LoginWithEmailDto = z.infer<typeof LoginWithEmailSchema>;

// User Onboarding Schema
export const CompleteOnboardingSchema = z.object({
  firstName: z.string().trim().max(100).optional(),
  currency: z.string().trim().min(1).max(10).optional(),
  monthlyIncome: NonNegativeFinancialAmountSchema.optional().nullable(),
  targetSavingsRate: z.number().int().min(0).max(100).optional(),
  budgets: z
    .array(
      z.object({
        category: TransactionCategorySchema,
        limit: FinancialAmountSchema,
      }),
    )
    .optional(),
});

export type CompleteOnboardingDto = z.infer<typeof CompleteOnboardingSchema>;

// Pagination & Query Parameters Schema
export const PaginationQuerySchema = z.object({
  page: z.preprocess((val) => {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      const parsed = parseInt(val.trim(), 10);
      return isNaN(parsed) ? 1 : parsed;
    }
    return 1;
  }, z.number().int().min(1).default(1)),
  limit: z.preprocess((val) => {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      const parsed = parseInt(val.trim(), 10);
      return isNaN(parsed) ? 20 : parsed;
    }
    return 20;
  }, z.number().int().min(1).max(100).default(20)),
  period: z.enum(['today', 'week', 'month', 'year']).optional(),
  categoryId: z.string().uuid().optional(),
  startDate: TransactionDateSchema.optional(),
  endDate: TransactionDateSchema.optional(),
});

export type PaginationQueryDto = z.infer<typeof PaginationQuerySchema>;

// Telegram Callback Payload Validation Helpers
export const TelegramCallbackPayloadSchema = z.object({
  type: z.enum([
    'cmd',
    'bgt_set',
    'bgt_adj',
    'bgt_del',
    'rec_del',
    'rec_tpl',
    'set_tx_cat',
    'change_cat',
    'delete',
  ]),
  txId: z.string().optional(),
  categoryName: z.string().optional(),
  amount: FinancialAmountSchema.optional(),
  delta: z
    .number()
    .refine((n) => Number.isFinite(n) && !Number.isNaN(n))
    .optional(),
});
