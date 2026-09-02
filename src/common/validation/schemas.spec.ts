import {
  FinancialAmountSchema,
  NonNegativeFinancialAmountSchema,
  CreateManualTransactionSchema,
  SetBudgetSchema,
  CreateRecurringSchema,
  RegisterWithEmailSchema,
  LoginWithEmailSchema,
  CompleteOnboardingSchema,
  PaginationQuerySchema,
} from './schemas';

describe('Validation Schemas & Financial Input Hardening', () => {
  describe('FinancialAmountSchema', () => {
    it('should accept valid positive numbers and numeric strings', () => {
      expect(FinancialAmountSchema.parse(500)).toBe(500);
      expect(FinancialAmountSchema.parse(12.5)).toBe(12.5);
      expect(FinancialAmountSchema.parse('450.50')).toBe(450.5);
      expect(FinancialAmountSchema.parse(' 1000 ')).toBe(1000);
    });

    it('should reject NaN, Infinity, -Infinity, and invalid numeric representations', () => {
      expect(FinancialAmountSchema.safeParse(NaN).success).toBe(false);
      expect(FinancialAmountSchema.safeParse(Infinity).success).toBe(false);
      expect(FinancialAmountSchema.safeParse(-Infinity).success).toBe(false);
      expect(FinancialAmountSchema.safeParse('NaN').success).toBe(false);
      expect(FinancialAmountSchema.safeParse('Infinity').success).toBe(false);
      expect(FinancialAmountSchema.safeParse('abc').success).toBe(false);
      expect(FinancialAmountSchema.safeParse('').success).toBe(false);
      expect(FinancialAmountSchema.safeParse('   ').success).toBe(false);
      expect(FinancialAmountSchema.safeParse(null).success).toBe(false);
      expect(FinancialAmountSchema.safeParse(undefined).success).toBe(false);
    });

    it('should reject negative values and zero for positive amount schema', () => {
      expect(FinancialAmountSchema.safeParse(0).success).toBe(false);
      expect(FinancialAmountSchema.safeParse(-100).success).toBe(false);
      expect(FinancialAmountSchema.safeParse('-50.25').success).toBe(false);
    });

    it('should reject extreme overflow numbers', () => {
      expect(FinancialAmountSchema.safeParse(1e12).success).toBe(false);
    });
  });

  describe('NonNegativeFinancialAmountSchema', () => {
    it('should accept zero and positive numbers', () => {
      expect(NonNegativeFinancialAmountSchema.parse(0)).toBe(0);
      expect(NonNegativeFinancialAmountSchema.parse('0')).toBe(0);
      expect(NonNegativeFinancialAmountSchema.parse(50000)).toBe(50000);
    });

    it('should reject negative values, NaN, and Infinity', () => {
      expect(NonNegativeFinancialAmountSchema.safeParse(-1).success).toBe(
        false,
      );
      expect(NonNegativeFinancialAmountSchema.safeParse(NaN).success).toBe(
        false,
      );
      expect(NonNegativeFinancialAmountSchema.safeParse(Infinity).success).toBe(
        false,
      );
    });
  });

  describe('CreateManualTransactionSchema', () => {
    it('should validate complete valid transaction payload', () => {
      const valid = {
        type: 'EXPENSE',
        amount: 450,
        merchant: 'Starbucks',
        categoryName: 'Food & Dining',
      };
      const parsed = CreateManualTransactionSchema.parse(valid);
      expect(parsed.amount).toBe(450);
      expect(parsed.type).toBe('EXPENSE');
      expect(parsed.merchant).toBe('Starbucks');
    });

    it('should coerce numeric strings for amount', () => {
      const valid = {
        amount: '1250.75',
        categoryName: 'Shopping',
      };
      const parsed = CreateManualTransactionSchema.parse(valid);
      expect(parsed.amount).toBe(1250.75);
    });

    it('should reject malformed transaction payloads', () => {
      expect(
        CreateManualTransactionSchema.safeParse({ amount: -500 }).success,
      ).toBe(false);
      expect(
        CreateManualTransactionSchema.safeParse({ amount: 'invalid' }).success,
      ).toBe(false);
      expect(
        CreateManualTransactionSchema.safeParse({
          amount: 100,
          type: 'INVALID_TYPE',
        }).success,
      ).toBe(false);
      expect(
        CreateManualTransactionSchema.safeParse({
          amount: 100,
          categoryName: '',
        }).success,
      ).toBe(false);
    });
  });

  describe('SetBudgetSchema', () => {
    it('should validate valid budget payload', () => {
      const valid = {
        categoryName: 'Food & Dining',
        monthlyLimit: 8000,
      };
      const parsed = SetBudgetSchema.parse(valid);
      expect(parsed.categoryName).toBe('Food & Dining');
      expect(parsed.monthlyLimit).toBe(8000);
    });

    it('should reject invalid budget limits', () => {
      expect(
        SetBudgetSchema.safeParse({ categoryName: 'Food', monthlyLimit: 0 })
          .success,
      ).toBe(false);
      expect(
        SetBudgetSchema.safeParse({ categoryName: 'Food', monthlyLimit: -5000 })
          .success,
      ).toBe(false);
      expect(
        SetBudgetSchema.safeParse({ categoryName: 'Food', monthlyLimit: NaN })
          .success,
      ).toBe(false);
      expect(
        SetBudgetSchema.safeParse({ categoryName: '', monthlyLimit: 5000 })
          .success,
      ).toBe(false);
    });
  });

  describe('CreateRecurringSchema', () => {
    it('should validate recurring payload and default/coerce dayOfMonth', () => {
      const valid = {
        name: 'House Rent',
        amount: 15000,
        type: 'EXPENSE',
        dayOfMonth: '1',
      };
      const parsed = CreateRecurringSchema.parse(valid);
      expect(parsed.name).toBe('House Rent');
      expect(parsed.amount).toBe(15000);
      expect(parsed.dayOfMonth).toBe(1);
    });

    it('should reject invalid recurring payload (invalid day, non-positive amount)', () => {
      expect(
        CreateRecurringSchema.safeParse({
          name: 'SIP',
          amount: 5000,
          dayOfMonth: 35,
        }).success,
      ).toBe(false);
      expect(
        CreateRecurringSchema.safeParse({
          name: 'SIP',
          amount: 5000,
          dayOfMonth: 0,
        }).success,
      ).toBe(false);
      expect(
        CreateRecurringSchema.safeParse({ name: '', amount: 5000 }).success,
      ).toBe(false);
      expect(
        CreateRecurringSchema.safeParse({ name: 'SIP', amount: -500 }).success,
      ).toBe(false);
    });
  });

  describe('RegisterWithEmailSchema & LoginWithEmailSchema', () => {
    it('should validate proper email and password', () => {
      const valid = {
        email: 'user@pulseai.internal',
        password: 'password123',
        name: 'John',
      };
      expect(RegisterWithEmailSchema.safeParse(valid).success).toBe(true);
      expect(
        LoginWithEmailSchema.safeParse({
          email: 'user@pulseai.internal',
          password: 'password123',
        }).success,
      ).toBe(true);
    });

    it('should reject invalid email formats and short passwords', () => {
      expect(
        RegisterWithEmailSchema.safeParse({
          email: 'not-an-email',
          password: 'password123',
        }).success,
      ).toBe(false);
      expect(
        RegisterWithEmailSchema.safeParse({
          email: 'user@pulseai.internal',
          password: '123',
        }).success,
      ).toBe(false);
    });
  });

  describe('CompleteOnboardingSchema', () => {
    it('should validate onboarding settings and budget arrays', () => {
      const valid = {
        firstName: 'Akash',
        currency: 'INR',
        monthlyIncome: 75000,
        targetSavingsRate: 25,
        budgets: [
          { category: 'Food & Dining', limit: 8000 },
          { category: 'Transport', limit: 4000 },
        ],
      };
      const parsed = CompleteOnboardingSchema.parse(valid);
      expect(parsed.monthlyIncome).toBe(75000);
      expect(parsed.budgets?.length).toBe(2);
    });

    it('should reject invalid savings rate or invalid budget item', () => {
      expect(
        CompleteOnboardingSchema.safeParse({ targetSavingsRate: 150 }).success,
      ).toBe(false);
      expect(
        CompleteOnboardingSchema.safeParse({ targetSavingsRate: -5 }).success,
      ).toBe(false);
      expect(
        CompleteOnboardingSchema.safeParse({
          budgets: [{ category: 'Food', limit: -100 }],
        }).success,
      ).toBe(false);
    });
  });

  describe('PaginationQuerySchema', () => {
    it('should default page and limit cleanly from query string inputs', () => {
      const parsed = PaginationQuerySchema.parse({ page: '2', limit: '50' });
      expect(parsed.page).toBe(2);
      expect(parsed.limit).toBe(50);
    });

    it('should reject negative page numbers or excessive limits', () => {
      expect(PaginationQuerySchema.safeParse({ page: '0' }).success).toBe(
        false,
      );
      expect(PaginationQuerySchema.safeParse({ limit: '500' }).success).toBe(
        false,
      );
    });
  });
});
