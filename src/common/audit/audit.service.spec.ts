import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AuditService', () => {
  let service: AuditService;
  let prismaMock: any;

  beforeEach(async () => {
    prismaMock = {
      auditLog: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  it('1. should record an audit log with complete metadata', async () => {
    prismaMock.auditLog.create.mockResolvedValue({
      id: 'audit-1',
      userId: 'user-1',
      action: 'TRANSACTION_CREATED',
      entityType: 'TRANSACTION',
      entityId: 'tx-100',
      source: 'WEB',
      details: { amount: 500, category: 'Food' },
    });

    await service.log({
      userId: 'user-1',
      action: 'TRANSACTION_CREATED',
      entityType: 'TRANSACTION',
      entityId: 'tx-100',
      source: 'WEB',
      details: { amount: 500, category: 'Food' },
    });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        action: 'TRANSACTION_CREATED',
        entityType: 'TRANSACTION',
        entityId: 'tx-100',
        source: 'WEB',
        details: { amount: 500, category: 'Food' },
      },
    });
  });

  it('2. should redact sensitive fields (passwords, tokens, jwt, hashes) from details', async () => {
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-2' });

    await service.log({
      userId: 'user-2',
      action: 'AUTH_REGISTER',
      entityType: 'USER',
      entityId: 'user-2',
      source: 'WEB',
      details: {
        email: 'test@example.com',
        password: 'SuperSecretPassword123!',
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        nested: {
          secret: 'api-secret-key',
          jwt: 'jwt.token.here',
        },
      },
    });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-2',
        action: 'AUTH_REGISTER',
        entityType: 'USER',
        entityId: 'user-2',
        source: 'WEB',
        details: {
          email: 'test@example.com',
          password: '[REDACTED]',
          token: '[REDACTED]',
          nested: {
            secret: '[REDACTED]',
            jwt: '[REDACTED]',
          },
        },
      },
    });
  });

  it('3. should handle database exceptions gracefully without crashing caller flow', async () => {
    prismaMock.auditLog.create.mockRejectedValue(
      new Error('DB Connection Dropped'),
    );

    await expect(
      service.log({
        userId: 'user-3',
        action: 'TRANSACTION_DELETED',
        entityType: 'TRANSACTION',
        entityId: 'tx-999',
      }),
    ).resolves.not.toThrow();
  });
});
