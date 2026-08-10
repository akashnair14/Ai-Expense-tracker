import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TransactionService } from './transaction.service';
import { PrismaService } from '../prisma/prisma.service';

describe('TransactionService', () => {
  let service: TransactionService;
  let prismaMock: any;
  let eventEmitterMock: any;

  beforeEach(async () => {
    prismaMock = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      category: {
        findFirst: jest.fn(),
        create: jest.fn(),
        createMany: jest.fn(),
      },
      transaction: {
        create: jest.fn(),
        aggregate: jest.fn(),
        findMany: jest.fn(),
      },
      budget: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    };

    eventEmitterMock = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: EventEmitter2, useValue: eventEmitterMock },
      ],
    }).compile();

    service = module.get<TransactionService>(TransactionService);
  });

  it('should return existing user if found', async () => {
    const mockUser = { id: 'u-1', telegramId: '12345', firstName: 'Alice' };
    prismaMock.user.findUnique.mockResolvedValue(mockUser);

    const user = await service.getOrCreateUser('12345');
    expect(user).toEqual(mockUser);
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { telegramId: '12345' } });
  });

  it('should create new user and seed default categories if user not found', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const createdUser = { id: 'u-new', telegramId: '99999', firstName: 'Bob' };
    prismaMock.user.create.mockResolvedValue(createdUser);
    prismaMock.category.createMany.mockResolvedValue({ count: 19 });

    const user = await service.getOrCreateUser('99999', 'bob_user', 'Bob');
    expect(user).toEqual(createdUser);
    expect(prismaMock.category.createMany).toHaveBeenCalled();
  });

  it('should evaluate budget alerts and emit event when over budget', async () => {
    const mockUser = { id: 'u-1', telegramId: '12345', currency: 'INR' };
    const mockCat = { id: 'c-1', name: 'Food' };
    prismaMock.user.findUnique.mockResolvedValue(mockUser);
    prismaMock.category.findFirst.mockResolvedValue(mockCat);
    prismaMock.transaction.create.mockResolvedValue({ id: 'tx-1', amount: 5000 });
    prismaMock.budget.findUnique.mockResolvedValue({
      monthlyLimit: 4000,
      category: mockCat,
    });
    prismaMock.transaction.aggregate.mockResolvedValue({
      _sum: { amount: 5000 },
    });

    await service.createManualTransaction('12345', {
      type: 'EXPENSE',
      merchant: 'Swiggy',
      amount: 5000,
      categoryName: 'Food',
    });

    expect(eventEmitterMock.emit).toHaveBeenCalledWith(
      'budget.alert',
      expect.objectContaining({
        telegramId: '12345',
        categoryName: 'Food',
        isExceeded: true,
      }),
    );
  });
});
