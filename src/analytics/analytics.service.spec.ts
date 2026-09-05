import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AnalyticsService (Pulse Score & Daily Limits)', () => {
  let service: AnalyticsService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        monthlyIncome: 65000,
        targetSavingsRate: 20,
        currency: 'INR',
      }),
    },
    transaction: {
      findMany: jest.fn().mockResolvedValue([
        { type: 'INCOME', amount: 65000, transactionDate: new Date() },
        {
          type: 'EXPENSE',
          amount: 20000,
          transactionDate: new Date(),
          category: { name: 'Rent' },
        },
        {
          type: 'EXPENSE',
          amount: 5000,
          transactionDate: new Date(),
          category: { name: 'Food' },
        },
      ]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    budget: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { monthlyLimit: 30000, category: { name: 'Rent' } },
        ]),
    },
    recurringTransaction: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ amount: 15000, type: 'EXPENSE' }]),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  it('should calculate healthy Pulse Score above 75 for high savings rate', async () => {
    const result = await service.calculatePulseScore('user_test_1');
    expect(result.pulseScore).toBeGreaterThanOrEqual(75);
    expect(['Good', 'Excellent']).toContain(result.grade);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('should calculate recommended daily discretionary limit', async () => {
    const result =
      await service.calculateDailyDiscretionaryLimit('user_test_1');
    expect(result.recommendedDailyLimit).toBeGreaterThan(0);
    expect(result.daysRemaining).toBeGreaterThan(0);
    expect(result.currency).toBe('INR');
  });

  it('should return recommendedDailyLimit: 0 and needsIncomeConfig: true when user has no income', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      monthlyIncome: 0,
      targetSavingsRate: 20,
      currency: 'USD',
    });
    mockPrisma.transaction.findMany.mockResolvedValueOnce([
      { type: 'EXPENSE', amount: 50, transactionDate: new Date(), category: { name: 'Food' } },
    ]);

    const result = await service.calculateDailyDiscretionaryLimit('user_test_2');
    expect(result.recommendedDailyLimit).toBe(0);
    expect(result.needsIncomeConfig).toBe(true);
    expect(result.currency).toBe('USD');
  });

  it('should format pulse score and deficit reasons with USD currency symbol', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      currency: 'USD',
    });
    mockPrisma.transaction.findMany.mockResolvedValueOnce([
      { type: 'INCOME', amount: 100, transactionDate: new Date() },
      { type: 'EXPENSE', amount: 300, transactionDate: new Date(), category: { name: 'Tech' } },
    ]);

    const result = await service.calculatePulseScore('user_usd');
    expect(result.reasons.some(r => r.includes('$'))).toBe(true);
  });

  describe('Financial RAG Engine', () => {
    it('should perform MoM comparative analysis without errors', async () => {
      const result = await service.performFinancialRagAnalysis(
        'user_test_1',
        'Compare to last month',
      );
      expect(result.reply).toContain('Month-over-Month Comparative Audit');
      expect(result.data).toBeDefined();
    });

    it('should audit subscriptions and recurring commitments', async () => {
      const result = await service.performFinancialRagAnalysis(
        'user_test_1',
        'Audit my subscriptions and recurring bills',
      );
      expect(result.reply).toContain('Subscription & Recurring Commitments Audit');
      expect(result.data.totalMonthlySub).toBeDefined();
    });

    it('should simulate affordability for a purchase', async () => {
      const result = await service.performFinancialRagAnalysis(
        'user_test_1',
        'Can I afford 5000 for a new gadget?',
      );
      expect(result.reply).toContain('Affordability & Purchase Impact Simulation');
      expect(result.data).toBeDefined();
    });

    it('should detect spending leakage and friction points', async () => {
      const result = await service.performFinancialRagAnalysis(
        'user_test_1',
        'Where is my spending leaking and what is wasting money?',
      );
      expect(result.reply).toContain('Spending Leakage & Anomaly Audit');
      expect(result.data).toBeDefined();
    });

    it('should forecast month-end trajectory and velocity', async () => {
      const result = await service.performFinancialRagAnalysis(
        'user_test_1',
        'What is my month-end spend forecast and trajectory?',
      );
      expect(result.reply).toContain('Month-End Trajectory & Velocity Forecast');
      expect(result.data).toBeDefined();
    });
  });
});

