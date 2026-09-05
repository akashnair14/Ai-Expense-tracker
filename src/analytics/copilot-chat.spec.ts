import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionService } from '../transactions/transaction.service';
import { NluService } from '../nlu/nlu.service';
import { AuditService } from '../common/audit/audit.service';

describe('AnalyticsController - Copilot Natural Language Understanding', () => {
  let controller: AnalyticsController;

  const mockUser = {
    id: 'user-test-1',
    currency: 'INR',
    monthlyIncome: 50000,
  };

  const mockPrisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(mockUser),
    },
    transaction: {
      findMany: jest.fn().mockImplementation((args: any) => {
        if (args?.where?.OR && JSON.stringify(args.where.OR).includes('petrol')) {
          return Promise.resolve([
            {
              id: 'tx-1',
              amount: 1400,
              merchant: 'Shell Petrol Station',
              description: 'Fuel refuel',
              category: { name: 'Fuel' },
              transactionDate: new Date(),
            },
          ]);
        }
        return Promise.resolve([]);
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({ id: 'tx-new', amount: 150 }),
      findFirst: jest.fn().mockResolvedValue({
        id: 'tx-latest-123',
        amount: 350,
        merchant: 'Telegram Lunch',
        description: 'Lunch expense',
        updatedAt: new Date('2026-09-05T12:00:00Z'),
      }),
      count: jest.fn().mockResolvedValue(15),
    },
    budget: {
      findFirst: jest.fn().mockResolvedValue({
        monthlyLimit: 3000,
        category: { name: 'Fuel' },
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    recurringTransaction: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  const mockAnalyticsService = {
    calculatePulseScore: jest.fn().mockResolvedValue({ score: 85 }),
    calculateDailyDiscretionaryLimit: jest.fn().mockResolvedValue({
      recommendedDailyLimit: 1200,
      daysRemaining: 20,
      needsIncomeConfig: false,
    }),
    getSummaryReport: jest.fn().mockResolvedValue({
      totalExpense: 1400,
      totalIncome: 50000,
      netSavings: 48600,
      transactionCount: 1,
      categoryBreakdown: { Fuel: 1400 },
    }),
    performFinancialRagAnalysis: jest.fn().mockResolvedValue({
      reply: 'RAG Audit Completed',
      data: {},
    }),
  };

  const mockTransactionService = {
    createManualTransaction: jest.fn().mockResolvedValue({
      id: 'tx-101',
      amount: 150,
      type: 'EXPENSE',
      merchant: 'Coffee',
      category: { name: 'Food & Dining' },
    }),
  };

  const mockNluService = {
    processUserInput: jest.fn().mockResolvedValue({
      intent: 'UNKNOWN',
    }),
  };

  const mockAuditService = {
    logAction: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [
        { provide: AnalyticsService, useValue: mockAnalyticsService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TransactionService, useValue: mockTransactionService },
        { provide: NluService, useValue: mockNluService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: 'JwtService', useValue: {} },
        { provide: 'AuthService', useValue: {} },
        {
          provide: require('@nestjs/jwt').JwtService,
          useValue: { verify: jest.fn() },
        },
        {
          provide: require('../auth/auth.service').AuthService,
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<AnalyticsController>(AnalyticsController);
  });

  it('should understand "how much is my petrol spent?" and return exact ledger outlay', async () => {
    const req = { user: mockUser } as any;
    const res = await controller.handleChat('how much is my petrol spent?', req);

    expect(res).toBeDefined();
    expect(res.reply).toContain('spent');
    expect(res.reply).toContain('1,400');
    expect(res.reply).toContain('petrol');
  });

  it('should understand "how much did I spend on food?" when spent is 0', async () => {
    const req = { user: mockUser } as any;
    const res = await controller.handleChat('how much did I spend on food?', req);

    expect(res).toBeDefined();
    expect(res.reply).toContain("haven't spent anything");
    expect(res.reply).toContain('food');
  });

  it('should understand "petrol spent" shorthand query', async () => {
    const req = { user: mockUser } as any;
    const res = await controller.handleChat('petrol spent', req);

    expect(res).toBeDefined();
    expect(res.reply).toContain('1,400');
  });

  it('should handle toolResult when returned by NLU service', async () => {
    mockNluService.processUserInput.mockResolvedValueOnce({
      intent: 'QUERY_CATEGORY_SPENDING',
      toolResult: { category: 'Transport', spent: 850, currency: 'INR', period: 'month' },
    });

    const req = { user: mockUser } as any;
    const res = await controller.handleChat('query cab allocations and rides', req);

    expect(res).toBeDefined();
    expect(res.reply).toContain('Transport');
    expect(res.reply).toContain('850');
  });

  it('should return sync status and set no-cache headers in checkSyncStatus', async () => {
    const req = { user: mockUser } as any;
    const res = { setHeader: jest.fn() } as any;
    const syncStatus = await controller.checkSyncStatus(req, res);

    expect(syncStatus).toBeDefined();
    expect(syncStatus.latestTxId).toBe('tx-latest-123');
    expect(syncStatus.merchant).toBe('Telegram Lunch');
    expect(syncStatus.amount).toBe(350);
    expect(syncStatus.count).toBe(15);
    expect(syncStatus.timestamp).toBeGreaterThan(0);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate',
    );
  });

  it('should route RAG queries like "audit my subscriptions" to performFinancialRagAnalysis', async () => {
    const req = { user: mockUser } as any;
    const res = await controller.handleChat('audit my subscriptions and memberships', req);

    expect(res).toBeDefined();
    expect(res.reply).toBe('RAG Audit Completed');
    expect(mockAnalyticsService.performFinancialRagAnalysis).toHaveBeenCalled();
  });

  it('should route open-ended conversational queries to performFinancialRagAnalysis instead of dropping into guidance card', async () => {
    mockNluService.processUserInput.mockResolvedValueOnce({
      intent: 'UNKNOWN',
    });
    mockAnalyticsService.performFinancialRagAnalysis.mockResolvedValueOnce({
      reply: 'Personalized Financial Analysis & Advice',
      data: { score: 90 },
    });

    const req = { user: mockUser } as any;
    const res = await controller.handleChat('how can I optimize my financial health?', req);

    expect(res).toBeDefined();
    expect(res.reply).toBe('Personalized Financial Analysis & Advice');
    expect(mockAnalyticsService.performFinancialRagAnalysis).toHaveBeenCalled();
  });
});
