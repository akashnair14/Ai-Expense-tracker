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
});
