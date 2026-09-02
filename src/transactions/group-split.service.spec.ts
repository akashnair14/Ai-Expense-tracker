import { Test, TestingModule } from '@nestjs/testing';
import { GroupSplitService } from './group-split.service';
import { PrismaService } from '../prisma/prisma.service';

describe('GroupSplitService', () => {
  let service: GroupSplitService;

  const mockPrisma = {
    groupExpense: {
      create: jest.fn().mockImplementation((args) => ({
        id: 'exp-1',
        ...args.data,
        splits: args.data.splits.create,
      })),
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'exp-1',
          chatId: '-100123',
          totalAmount: 1200,
          paidBy: { firstName: 'Alice', username: 'alice' },
          splits: [
            { userName: 'Alice', amountOwed: 400, isPaid: true },
            { userName: '@bob', amountOwed: 400, isPaid: false },
            { userName: '@charlie', amountOwed: 400, isPaid: false },
          ],
        },
      ]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    groupSplit: {
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupSplitService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<GroupSplitService>(GroupSplitService);
  });

  it('should calculate group balances correctly', async () => {
    const res = await service.getGroupBalances('-100123');
    expect(res.unsettledExpensesCount).toBe(1);
    const aliceBalance = res.balances.find((b) => b.userName === 'Alice');
    const bobBalance = res.balances.find((b) => b.userName === '@bob');
    expect(aliceBalance?.netBalance).toBe(800);
    expect(bobBalance?.netBalance).toBe(-400);
  });
});
