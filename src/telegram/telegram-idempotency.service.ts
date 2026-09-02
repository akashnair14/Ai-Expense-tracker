import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type IdempotencyDecision =
  | { proceed: true }
  | { proceed: false; reason: 'ALREADY_COMPLETED' | 'IN_PROCESSING' };

@Injectable()
export class TelegramIdempotencyService {
  private readonly logger = new Logger(TelegramIdempotencyService.name);
  // Stale lock timeout: if processing started > 2 minutes ago and is still in PROCESSING, consider it crashed/stale and allow retry
  private readonly STALE_TIMEOUT_MS = 2 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Attempts to acquire an atomic database lock for a Telegram update ID.
   * Protects against concurrent processing, webhook retries, and duplicate delivery.
   */
  async acquireLock(
    updateId: number | bigint | string,
  ): Promise<IdempotencyDecision> {
    if (updateId === undefined || updateId === null) {
      return { proceed: true };
    }

    const bigintId = BigInt(updateId);

    try {
      // 1. Attempt optimistic insert for the update ID
      await this.prisma.telegramUpdateLock.create({
        data: {
          updateId: bigintId,
          status: 'PROCESSING',
          lockedAt: new Date(),
        },
      });

      return { proceed: true };
    } catch (err: any) {
      // Unique constraint violation (code P2002 in Prisma) means record already exists
      if (err.code === 'P2002') {
        const existing = await this.prisma.telegramUpdateLock.findUnique({
          where: { updateId: bigintId },
        });

        if (!existing) {
          return { proceed: true };
        }

        if (existing.status === 'COMPLETED') {
          this.logger.warn(
            `Duplicate Telegram update ${updateId} ignored (already completed).`,
          );
          return { proceed: false, reason: 'ALREADY_COMPLETED' };
        }

        if (existing.status === 'PROCESSING') {
          const now = Date.now();
          const lockAge = now - existing.lockedAt.getTime();

          // If lock is still fresh, another concurrent request is currently actively processing it
          if (lockAge < this.STALE_TIMEOUT_MS) {
            this.logger.warn(
              `Telegram update ${updateId} is currently being processed concurrently. Skipping duplicate execution.`,
            );
            return { proceed: false, reason: 'IN_PROCESSING' };
          }

          // Lock is stale (e.g. server crashed during processing). Re-acquire it.
          this.logger.warn(
            `Stale processing lock detected for Telegram update ${updateId} (${lockAge}ms old). Re-acquiring lock.`,
          );
          await this.prisma.telegramUpdateLock.update({
            where: { updateId: bigintId },
            data: {
              status: 'PROCESSING',
              lockedAt: new Date(),
              finishedAt: null,
            },
          });
          return { proceed: true };
        }

        if (existing.status === 'FAILED') {
          // Previous attempt failed, allow retry
          this.logger.log(
            `Retrying previously failed Telegram update ${updateId}.`,
          );
          await this.prisma.telegramUpdateLock.update({
            where: { updateId: bigintId },
            data: {
              status: 'PROCESSING',
              lockedAt: new Date(),
              finishedAt: null,
            },
          });
          return { proceed: true };
        }
      }

      this.logger.error(
        `Error acquiring Telegram update lock for ${updateId}: ${err.message}`,
        err.stack,
      );
      // Fail-open or throw depending on safety: for safety under DB errors, proceed
      return { proceed: true };
    }
  }

  /**
   * Marks a Telegram update as successfully processed.
   */
  async markCompleted(updateId: number | bigint | string): Promise<void> {
    if (updateId === undefined || updateId === null) return;
    const bigintId = BigInt(updateId);

    try {
      await this.prisma.telegramUpdateLock.update({
        where: { updateId: bigintId },
        data: {
          status: 'COMPLETED',
          finishedAt: new Date(),
        },
      });
    } catch (err: any) {
      this.logger.warn(
        `Could not mark Telegram update ${updateId} as completed: ${err.message}`,
      );
    }
  }

  /**
   * Marks a Telegram update as failed, allowing Telegram or the client to retry.
   */
  async markFailed(updateId: number | bigint | string): Promise<void> {
    if (updateId === undefined || updateId === null) return;
    const bigintId = BigInt(updateId);

    try {
      await this.prisma.telegramUpdateLock.update({
        where: { updateId: bigintId },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
        },
      });
    } catch (err: any) {
      this.logger.warn(
        `Could not mark Telegram update ${updateId} as failed: ${err.message}`,
      );
    }
  }
}
