import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WeeklyDigestService } from './weekly-digest.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsService } from './analytics.service';

describe('WeeklyDigestService (Cron Digest)', () => {
  let service: WeeklyDigestService;

  const mockPrisma = {
    user: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 'user_1', telegramId: '12345678', currency: '₹' },
        ]),
    },
  };

  const mockAnalytics = {
    getSummaryReport: jest.fn().mockResolvedValue({
      totalIncome: 70000,
      totalExpense: 12000,
      netSavings: 58000,
      categoryBreakdown: { 'Food & Dining': 4500, Shopping: 3500 },
    }),
    calculatePulseScore: jest.fn().mockResolvedValue({
      pulseScore: 88,
      grade: 'Excellent',
    }),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WeeklyDigestService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AnalyticsService, useValue: mockAnalytics },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<WeeklyDigestService>(WeeklyDigestService);
  });

  it('should compile and broadcast weekly report to active telegram users', async () => {
    await service.sendWeeklyMoneyReport();
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'weekly.digest.ready',
      expect.objectContaining({
        telegramId: '12345678',
        message: expect.stringContaining('WEEKLY MONEY REPORT'),
      }),
    );
  });
});
