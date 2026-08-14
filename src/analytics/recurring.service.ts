import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { addMonths } from 'date-fns';

@Injectable()
export class RecurringService {
  private readonly logger = new Logger(RecurringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleRecurringCron() {
    this.logger.log('⏰ Running idempotent recurring payment scheduler...');
    const now = new Date();

    const dueRecurring = await this.prisma.recurringTransaction.findMany({
      where: {
        isActive: true,
        nextRun: { lte: now },
      },
      include: {
        user: true,
        category: true,
      },
    });

    this.logger.log(`Found ${dueRecurring.length} due recurring transactions.`);

    for (const rec of dueRecurring) {
      try {
        const scheduledDate = new Date(rec.nextRun);
        // Normalize scheduled date to midnight for idempotency key
        const normalizedScheduledDate = new Date(Date.UTC(scheduledDate.getUTCFullYear(), scheduledDate.getUTCMonth(), scheduledDate.getUTCDate()));

        // Use Prisma interactive transaction for atomic execution and idempotency record
        await this.prisma.$transaction(async (tx) => {
          // Check if already executed for this scheduled date
          const existingExec = await tx.recurringExecution.findUnique({
            where: {
              recurringTransactionId_scheduledDate: {
                recurringTransactionId: rec.id,
                scheduledDate: normalizedScheduledDate,
              },
            },
          });

          if (existingExec) {
            this.logger.warn(`Recurring schedule ${rec.id} already executed for date ${normalizedScheduledDate.toISOString()}. Skipping duplicate.`);
            return;
          }

          // 1. Create Transaction record
          await tx.transaction.create({
            data: {
              userId: rec.userId,
              categoryId: rec.categoryId,
              type: rec.type,
              amount: rec.amount,
              merchant: rec.description || 'Recurring Payment',
              description: `Auto-posted recurring schedule: ${rec.description}`,
              rawText: `Auto-posted recurring: ${rec.description} ${rec.amount}`,
              parsedBy: 'ML',
            },
          });

          // 2. Compute next run date safely using date-fns addMonths (prevents month-end drift)
          const nextMonthDate = addMonths(scheduledDate, 1);

          // 3. Update nextRun timestamp on RecurringTransaction
          await tx.recurringTransaction.update({
            where: { id: rec.id },
            data: { nextRun: nextMonthDate },
          });

          // 4. Record execution history
          await tx.recurringExecution.create({
            data: {
              recurringTransactionId: rec.id,
              scheduledDate: normalizedScheduledDate,
              amount: rec.amount,
              status: 'SUCCESS',
            },
          });

          // 5. Emit asynchronous notification event
          this.eventEmitter.emit('recurring.auto_posted', {
            telegramId: rec.user.telegramId,
            description: rec.description || 'Recurring Payment',
            amount: Number(rec.amount),
            categoryName: rec.category?.name || 'General',
            currency: rec.user.currency || '₹',
            type: rec.type,
            nextRun: nextMonthDate.toISOString().split('T')[0],
          });
        });

        this.logger.log(`Successfully processed recurring transaction ${rec.id} for user ${rec.userId}`);
      } catch (err: any) {
        this.logger.error(`Error processing recurring transaction ${rec.id}: ${err.message}`, err.stack);
      }
    }
  }

  // Trigger manual processing (for testing & instant execution)
  async processDueNow() {
    return this.handleRecurringCron();
  }
}

