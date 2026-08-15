import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsService } from '../../analytics/analytics.service';
import { TransactionService } from '../../transactions/transaction.service';
import { LLMToolCall } from '../schemas/intent.schema';

@Injectable()
export class ToolDispatcherService {
  private readonly logger = new Logger(ToolDispatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly analyticsService: AnalyticsService,
    private readonly transactionService: TransactionService,
  ) {}

  public async executeTool(userId: string, toolCall: LLMToolCall): Promise<any> {
    this.logger.log(`Executing tool "${toolCall.tool}" for user ${userId}`);

    switch (toolCall.tool) {
      case 'get_expense_summary': {
        const period = (toolCall.parameters?.period as 'today' | 'week' | 'month' | 'year') || 'month';
        return this.analyticsService.getSummaryReport(userId, period);
      }

      case 'get_category_spending': {
        const category = String(toolCall.parameters?.category || 'Food');
        const period = (toolCall.parameters?.period as 'today' | 'week' | 'month' | 'year') || 'month';
        const summary = await this.analyticsService.getSummaryReport(userId, period);
        const spent = summary.categoryBreakdown[category] || 0;
        return {
          category,
          period,
          spent,
          currency: 'INR',
        };
      }

      case 'get_top_expenses': {
        const limit = Number(toolCall.parameters?.limit) || 5;
        const transactions = await this.prisma.transaction.findMany({
          where: { userId, isDeleted: false, type: 'EXPENSE' },
          orderBy: { amount: 'desc' },
          take: limit,
          include: { category: true },
        });
        return transactions.map((t) => ({
          merchant: t.merchant || t.description,
          category: t.category?.name || 'General',
          amount: Number(t.amount),
          date: t.transactionDate.toISOString().split('T')[0],
        }));
      }

      case 'get_budget_status': {
        const now = new Date();
        const budgets = await this.prisma.budget.findMany({
          where: { userId, month: now.getMonth() + 1, year: now.getFullYear() },
          include: { category: true },
        });
        const summary = await this.analyticsService.getSummaryReport(userId, 'month');
        return budgets.map((b) => {
          const spent = summary.categoryBreakdown[b.category.name] || 0;
          const limit = Number(b.monthlyLimit);
          return {
            category: b.category.name,
            spent,
            limit,
            usedPercentage: limit > 0 ? Math.round((spent / limit) * 100) : 0,
            status: spent > limit ? 'EXCEEDED' : spent >= limit * 0.8 ? 'WARNING' : 'ON_TRACK',
          };
        });
      }

      case 'set_budget': {
        const category = String(toolCall.parameters?.category || 'General');
        const amount = Number(toolCall.parameters?.amount) || 5000;
        return this.transactionService.setBudgetLimit(userId, category, amount);
      }

      case 'create_recurring': {
        const name = String(toolCall.parameters?.name || toolCall.parameters?.description || 'Recurring');
        const amount = Number(toolCall.parameters?.amount) || 0;
        const type = (toolCall.parameters?.type || 'EXPENSE') as 'EXPENSE' | 'INCOME';
        const day = Number(toolCall.parameters?.day) || 1;

        const now = new Date();
        let nextRun = new Date(now.getFullYear(), now.getMonth(), day);
        if (nextRun <= now) {
          nextRun = new Date(now.getFullYear(), now.getMonth() + 1, day);
        }

        let category = await this.prisma.category.findFirst({
          where: { userId, name: { equals: name, mode: 'insensitive' } },
        });

        if (!category) {
          category = await this.prisma.category.create({
            data: { userId, name, type },
          });
        }

        const recurring = await this.prisma.recurringTransaction.create({
          data: {
            userId,
            categoryId: category.id,
            type,
            amount,
            description: name,
            cronExpression: `0 0 ${day} * *`,
            nextRun,
            isActive: true,
          },
        });

        return {
          recurring,
          name,
          amount,
          day,
          nextRun: nextRun.toISOString().split('T')[0],
        };
      }

      case 'delete_last_transaction': {
        return this.transactionService.deleteLastTransaction(userId);
      }

      default:
        this.logger.warn(`Unknown tool "${toolCall.tool}" requested.`);
        return null;
    }
  }
}
