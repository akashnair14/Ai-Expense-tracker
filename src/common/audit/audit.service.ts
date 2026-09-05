import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface CreateAuditLogParams {
  userId?: string | null;
  action:
    | 'TRANSACTION_CREATED'
    | 'TRANSACTION_UPDATED'
    | 'TRANSACTION_DELETED'
    | 'CATEGORY_CREATED'
    | 'CATEGORY_UPDATED'
    | 'BUDGET_SET'
    | 'BUDGET_DELETED'
    | 'RECURRING_CREATED'
    | 'RECURRING_UPDATED'
    | 'RECURRING_DELETED'
    | 'RECURRING_EXECUTED'
    | 'AUTH_REGISTER'
    | 'AUTH_LOGIN'
    | 'AUTH_DEMO_LOGIN'
    | 'AUTH_TELEGRAM_LOGIN'
    | 'AUTH_TELEGRAM_MINIAPP_LOGIN'
    | 'AUTH_QR_LOGIN_APPROVED'
    | 'ONBOARDING_COMPLETED'
    | 'CURRENCY_PREFERENCE_UPDATED';
  entityType?:
    | 'TRANSACTION'
    | 'BUDGET'
    | 'RECURRING_TRANSACTION'
    | 'CATEGORY'
    | 'USER'
    | 'AUTH';
  entityId?: string | null;
  source?: 'WEB' | 'TELEGRAM' | 'SCHEDULER' | 'SYSTEM';
  details?: Record<string, any>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(params: CreateAuditLogParams): Promise<void> {
    try {
      const sanitizedDetails = this.sanitizeDetails(params.details || {});

      await this.prisma.auditLog.create({
        data: {
          userId: params.userId || null,
          action: params.action,
          entityType: params.entityType || null,
          entityId: params.entityId ? String(params.entityId) : null,
          source: params.source || 'SYSTEM',
          details: sanitizedDetails,
        },
      });
    } catch (err: any) {
      this.logger.error(
        `Failed to persist audit log [${params.action}] for user ${params.userId}: ${err.message}`,
        err.stack,
      );
    }
  }

  private sanitizeDetails(details: Record<string, any>): Record<string, any> {
    const sanitized = { ...details };
    const sensitiveKeys = [
      'password',
      'token',
      'secret',
      'pulse_session',
      'hash',
      'authToken',
      'jwt',
    ];

    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.includes(key.toLowerCase())) {
        sanitized[key] = '[REDACTED]';
      } else if (
        typeof sanitized[key] === 'object' &&
        sanitized[key] !== null
      ) {
        sanitized[key] = this.sanitizeDetails(sanitized[key]);
      }
    }

    return sanitized;
  }
}
