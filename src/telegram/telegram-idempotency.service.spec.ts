import { Test, TestingModule } from '@nestjs/testing';
import { TelegramIdempotencyService } from './telegram-idempotency.service';
import { PrismaService } from '../prisma/prisma.service';

describe('TelegramIdempotencyService', () => {
  let service: TelegramIdempotencyService;
  let prismaMock: any;

  beforeEach(async () => {
    prismaMock = {
      telegramUpdateLock: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramIdempotencyService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<TelegramIdempotencyService>(
      TelegramIdempotencyService,
    );
  });

  it('1. First processing: should acquire lock and proceed for a new updateId', async () => {
    prismaMock.telegramUpdateLock.create.mockResolvedValue({
      updateId: BigInt(1001),
      status: 'PROCESSING',
      lockedAt: new Date(),
    });

    const result = await service.acquireLock(1001);
    expect(result.proceed).toBe(true);
    expect(prismaMock.telegramUpdateLock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        updateId: BigInt(1001),
        status: 'PROCESSING',
      }),
    });
  });

  it('2. Duplicate processing: should reject already COMPLETED update', async () => {
    const error: any = new Error('Unique constraint failed');
    error.code = 'P2002';
    prismaMock.telegramUpdateLock.create.mockRejectedValue(error);

    prismaMock.telegramUpdateLock.findUnique.mockResolvedValue({
      updateId: BigInt(1001),
      status: 'COMPLETED',
      lockedAt: new Date(Date.now() - 5000),
      finishedAt: new Date(),
    });

    const result = await service.acquireLock(1001);
    expect(result.proceed).toBe(false);
    if (!result.proceed) {
      expect(result.reason).toBe('ALREADY_COMPLETED');
    }
  });

  it('3. Concurrent processing: should reject if another worker is actively PROCESSING (fresh lock)', async () => {
    const error: any = new Error('Unique constraint failed');
    error.code = 'P2002';
    prismaMock.telegramUpdateLock.create.mockRejectedValue(error);

    prismaMock.telegramUpdateLock.findUnique.mockResolvedValue({
      updateId: BigInt(1002),
      status: 'PROCESSING',
      lockedAt: new Date(Date.now() - 10000), // 10s ago, well within 2-minute timeout
    });

    const result = await service.acquireLock(1002);
    expect(result.proceed).toBe(false);
    if (!result.proceed) {
      expect(result.reason).toBe('IN_PROCESSING');
    }
  });

  it('4. Stale lock recovery: should re-acquire lock if previous worker crashed and lock is stale (>2 min)', async () => {
    const error: any = new Error('Unique constraint failed');
    error.code = 'P2002';
    prismaMock.telegramUpdateLock.create.mockRejectedValue(error);

    prismaMock.telegramUpdateLock.findUnique.mockResolvedValue({
      updateId: BigInt(1003),
      status: 'PROCESSING',
      lockedAt: new Date(Date.now() - 3 * 60 * 1000), // 3 minutes ago (stale)
    });

    prismaMock.telegramUpdateLock.update.mockResolvedValue({
      updateId: BigInt(1003),
      status: 'PROCESSING',
    });

    const result = await service.acquireLock(1003);
    expect(result.proceed).toBe(true);
    expect(prismaMock.telegramUpdateLock.update).toHaveBeenCalledWith({
      where: { updateId: BigInt(1003) },
      data: expect.objectContaining({
        status: 'PROCESSING',
      }),
    });
  });

  it('5. Failed processing retry: should allow retry if previous attempt was marked FAILED', async () => {
    const error: any = new Error('Unique constraint failed');
    error.code = 'P2002';
    prismaMock.telegramUpdateLock.create.mockRejectedValue(error);

    prismaMock.telegramUpdateLock.findUnique.mockResolvedValue({
      updateId: BigInt(1004),
      status: 'FAILED',
      lockedAt: new Date(Date.now() - 15000),
    });

    prismaMock.telegramUpdateLock.update.mockResolvedValue({
      updateId: BigInt(1004),
      status: 'PROCESSING',
    });

    const result = await service.acquireLock(1004);
    expect(result.proceed).toBe(true);
    expect(prismaMock.telegramUpdateLock.update).toHaveBeenCalledWith({
      where: { updateId: BigInt(1004) },
      data: expect.objectContaining({
        status: 'PROCESSING',
      }),
    });
  });

  it('6. markCompleted: should update record to COMPLETED', async () => {
    prismaMock.telegramUpdateLock.update.mockResolvedValue({
      updateId: BigInt(1005),
      status: 'COMPLETED',
    });

    await service.markCompleted(1005);
    expect(prismaMock.telegramUpdateLock.update).toHaveBeenCalledWith({
      where: { updateId: BigInt(1005) },
      data: expect.objectContaining({
        status: 'COMPLETED',
      }),
    });
  });

  it('7. markFailed: should update record to FAILED', async () => {
    prismaMock.telegramUpdateLock.update.mockResolvedValue({
      updateId: BigInt(1006),
      status: 'FAILED',
    });

    await service.markFailed(1006);
    expect(prismaMock.telegramUpdateLock.update).toHaveBeenCalledWith({
      where: { updateId: BigInt(1006) },
      data: expect.objectContaining({
        status: 'FAILED',
      }),
    });
  });
});
