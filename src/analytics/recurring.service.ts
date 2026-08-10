import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RecurringService {
  private readonly logger = new Logger(RecurringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleRecurringCron() {
    this.logger.log('⏰ Running daily recurring payment auto-posting cron...');
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
        // Create actual transaction
        await this.prisma.transaction.create({
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

        // Compute next run date (advance by 1 month)
        const currentNext = new Date(rec.nextRun);
        const nextMonth = new Date(currentNext.getFullYear(), currentNext.getMonth() + 1, currentNext.getDate());

        await this.prisma.recurringTransaction.update({
          where: { id: rec.id },
          data: { nextRun: nextMonth },
        });

        // Emit asynchronous notification event (eliminates circular module dependency)
        this.eventEmitter.emit('recurring.auto_posted', {
          telegramId: rec.user.telegramId,
          description: rec.description || 'Recurring Payment',
          amount: Number(rec.amount),
          categoryName: rec.category?.name || 'General',
          currency: rec.user.currency || '₹',
          type: rec.type,
          nextRun: nextMonth.toISOString().split('T')[0],
        });

        this.logger.log(`Successfully processed recurring transaction ${rec.id} for user ${rec.userId}`);
      } catch (err) {
        this.logger.error(`Error processing recurring transaction ${rec.id}:`, err);
      }
    }
  }

  // Trigger manual processing (for testing & instant execution)
  async processDueNow() {
    return this.handleRecurringCron();
  }
}
