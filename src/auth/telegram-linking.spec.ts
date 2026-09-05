import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { TransactionService } from '../transactions/transaction.service';
import { JwtService } from '@nestjs/jwt';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('AuthService - Telegram Account Linking', () => {
  let authService: AuthService;
  let prismaService: any;
  let auditService: any;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    transaction: {
      updateMany: jest.fn(),
    },
    budget: {
      updateMany: jest.fn(),
    },
    recurringTransaction: {
      updateMany: jest.fn(),
    },
  };

  const mockAudit = {
    log: jest.fn(),
  };

  const mockJwt = {
    sign: jest.fn().mockReturnValue('mock-jwt'),
    verify: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
        { provide: JwtService, useValue: mockJwt },
        {
          provide: TransactionService,
          useValue: { getRecentTransactions: jest.fn(), syncTelegramTransactions: jest.fn() },
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
  });

  it('generates a valid Telegram linking session and deep link URL', async () => {
    process.env.TELEGRAM_BOT_USERNAME = 'ExpenseTrackerAI_Bot';
    const result = authService.generateTelegramLinkToken('user-123');

    expect(result.token).toBeDefined();
    expect(result.token.length).toBeGreaterThan(10);
    expect(result.deepLink).toContain('t.me/ExpenseTrackerAI_Bot?start=link_');

    const status = authService.checkLinkStatus(result.token);
    expect(status.isLinked).toBe(false);
    expect(status.status).toBe('PENDING');
  });

  it('returns status EXPIRED for an unknown or non-existent link token in checkLinkStatus', () => {
    const status = authService.checkLinkStatus('invalid-token-xyz');
    expect(status).toEqual({ status: 'EXPIRED', isLinked: false });
  });

  it('links telegram account successfully when no orphan user exists', async () => {
    const { token } = authService.generateTelegramLinkToken('user-123');

    // Target user
    mockPrisma.user.findUnique.mockImplementation(({ where }: any) => {
      if (where.id === 'user-123') {
        return Promise.resolve({ id: 'user-123', email: 'user@example.com', telegramId: null });
      }
      if (where.telegramId === 'tg-999') {
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });

    mockPrisma.user.update.mockResolvedValue({
      id: 'user-123',
      email: 'user@example.com',
      telegramId: 'tg-999',
      username: 'john_doe',
    });

    const linkResult = await authService.linkTelegramAccount(
      token,
      'tg-999',
      'john_doe',
      'John',
      'Doe',
    );

    expect(linkResult.success).toBe(true);
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-123' },
        data: expect.objectContaining({
          telegramId: 'tg-999',
          username: 'john_doe',
        }),
      }),
    );
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TELEGRAM_ACCOUNT_LINKED',
        userId: 'user-123',
      }),
    );

    // Session should now report linked: true
    const status = authService.checkLinkStatus(token);
    expect(status.isLinked).toBe(true);
    expect(status.username).toBe('john_doe');
  });

  it('safely reassigns orphan transactions and budgets if Telegram ID was used prior to linking', async () => {
    const { token } = authService.generateTelegramLinkToken('user-123');

    // Target user & Orphan telegram user
    mockPrisma.user.findUnique.mockImplementation(({ where }: any) => {
      if (where.id === 'user-123') {
        return Promise.resolve({ id: 'user-123', email: 'user@example.com', telegramId: null });
      }
      if (where.telegramId === 'tg-888') {
        return Promise.resolve({ id: 'orphan-456', email: null, telegramId: 'tg-888' });
      }
      return Promise.resolve(null);
    });

    mockPrisma.transaction.updateMany.mockResolvedValue({ count: 5 });
    mockPrisma.budget.updateMany.mockResolvedValue({ count: 2 });
    mockPrisma.recurringTransaction.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.user.delete.mockResolvedValue({ id: 'orphan-456' });
    mockPrisma.user.update.mockResolvedValue({
      id: 'user-123',
      email: 'user@example.com',
      telegramId: 'tg-888',
    });

    const linkResult = await authService.linkTelegramAccount(
      token,
      'tg-888',
      'orphan_user',
    );

    expect(linkResult.success).toBe(true);
    expect(mockPrisma.transaction.updateMany).toHaveBeenCalledWith({
      where: { userId: 'orphan-456' },
      data: { userId: 'user-123' },
    });
    expect(mockPrisma.budget.updateMany).toHaveBeenCalledWith({
      where: { userId: 'orphan-456' },
      data: { userId: 'user-123' },
    });
    expect(mockPrisma.user.delete).toHaveBeenCalledWith({
      where: { id: 'orphan-456' },
    });
  });

  it('rejects linking if the telegram ID is already tied to a different registered email user', async () => {
    const { token } = authService.generateTelegramLinkToken('user-123');

    mockPrisma.user.findUnique.mockImplementation(({ where }: any) => {
      if (where.id === 'user-123') {
        return Promise.resolve({ id: 'user-123', email: 'user@example.com', telegramId: null });
      }
      if (where.telegramId === 'tg-claimed') {
        return Promise.resolve({ id: 'other-user', email: 'other@example.com', telegramId: 'tg-claimed' });
      }
      return Promise.resolve(null);
    });

    const linkResult = await authService.linkTelegramAccount(
      token,
      'tg-claimed',
      'claimed_tg',
    );

    expect(linkResult.success).toBe(false);
    expect(linkResult.message).toContain('already linked to another registered email account');
  });
});
