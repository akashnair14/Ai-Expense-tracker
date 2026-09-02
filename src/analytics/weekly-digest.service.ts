import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsService } from './analytics.service';

@Injectable()
export class WeeklyDigestService {
  private readonly logger = new Logger(WeeklyDigestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly analyticsService: AnalyticsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // Run every Sunday at 8:00 PM (20:00)
  @Cron('0 20 * * 0')
  async sendWeeklyMoneyReport() {
    this.logger.log(
      '📊 Compiling and delivering Weekly Money Digest to users...',
    );

    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        telegramId: { not: null },
      },
    });

    for (const user of users) {
      if (!user.telegramId) continue;

      try {
        const weekSummary = await this.analyticsService.getSummaryReport(
          user.id,
          'week',
        );
        const pulseScore = await this.analyticsService.calculatePulseScore(
          user.id,
        );
        const topExpenses = Object.entries(weekSummary.categoryBreakdown)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3);

        let msg = `📊 **WEEKLY MONEY REPORT**\n\n`;
        msg += `💰 **Income:** ${user.currency} ${weekSummary.totalIncome.toLocaleString()}\n`;
        msg += `💸 **Expenses:** ${user.currency} ${weekSummary.totalExpense.toLocaleString()}\n`;
        msg += `📈 **Net Savings:** ${user.currency} ${weekSummary.netSavings.toLocaleString()}\n\n`;

        msg += `💓 **Pulse Score:** ${pulseScore.pulseScore}/100 (${pulseScore.grade})\n\n`;

        if (topExpenses.length > 0) {
          msg += `🔥 **Top Spending This Week:**\n`;
          for (const [cat, amt] of topExpenses) {
            msg += `• ${cat}: ${user.currency} ${amt.toLocaleString()}\n`;
          }
        }

        msg += `\n💡 Have a great week ahead! Type /dashboard to view interactive graphs.`;

        this.eventEmitter.emit('weekly.digest.ready', {
          telegramId: user.telegramId,
          message: msg,
        });
      } catch (err: any) {
        this.logger.error(
          `Failed to send weekly digest to ${user.telegramId}: ${err.message}`,
        );
      }
    }
  }

  // Trigger manually for tests & admin dispatch
  async dispatchManual() {
    return this.sendWeeklyMoneyReport();
  }
}
