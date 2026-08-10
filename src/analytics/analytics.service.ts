import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear } from 'date-fns';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  public async getSummaryReport(userId: string, period: 'today' | 'week' | 'month' | 'year') {
    const now = new Date();
    let startDate: Date;
    let endDate: Date;

    switch (period) {
      case 'today':
        startDate = startOfDay(now);
        endDate = endOfDay(now);
        break;
      case 'week':
        startDate = startOfWeek(now, { weekStartsOn: 1 });
        endDate = endOfWeek(now, { weekStartsOn: 1 });
        break;
      case 'month':
        startDate = startOfMonth(now);
        endDate = endOfMonth(now);
        break;
      case 'year':
        startDate = startOfYear(now);
        endDate = endOfYear(now);
        break;
    }

    const transactions = await this.prisma.transaction.findMany({
      where: {
        userId,
        isDeleted: false,
        transactionDate: { gte: startDate, lte: endDate },
      },
      include: { category: true },
    });

    let totalExpense = 0;
    let totalIncome = 0;
    const categoryBreakdown: Record<string, number> = {};

    for (const tx of transactions) {
      const amt = Number(tx.amount);
      if (tx.type === 'EXPENSE') {
        totalExpense += amt;
        const catName = tx.category?.name || 'Others';
        categoryBreakdown[catName] = (categoryBreakdown[catName] || 0) + amt;
      } else {
        totalIncome += amt;
      }
    }

    const netSavings = totalIncome - totalExpense;

    return {
      period,
      startDate,
      endDate,
      totalExpense,
      totalIncome,
      netSavings,
      transactionCount: transactions.length,
      categoryBreakdown,
    };
  }

  public async getWeeklyTrend(userId: string) {
    const now = new Date();
    const startDate = startOfMonth(now);
    const endDate = endOfMonth(now);

    const transactions = await this.prisma.transaction.findMany({
      where: { userId, isDeleted: false, transactionDate: { gte: startDate, lte: endDate } },
    });

    const weeks = [
      { week: 'Week 1', income: 0, expense: 0 },
      { week: 'Week 2', income: 0, expense: 0 },
      { week: 'Week 3', income: 0, expense: 0 },
      { week: 'Week 4', income: 0, expense: 0 },
    ];

    for (const tx of transactions) {
      const day = tx.transactionDate.getDate();
      const weekIdx = Math.min(Math.floor((day - 1) / 7), 3);
      const amt = Number(tx.amount);
      if (tx.type === 'EXPENSE') {
        weeks[weekIdx].expense += amt;
      } else {
        weeks[weekIdx].income += amt;
      }
    }

    return weeks;
  }

  public async generateInsights(userId: string, monthSummary: any) {
    const insights: Array<{ type: string; title: string; message: string }> = [];
    const catBreakdown = monthSummary.categoryBreakdown || {};
    const topCat = Object.entries(catBreakdown).sort((a: any, b: any) => b[1] - a[1])[0];

    if (topCat) {
      insights.push({
        type: 'DANGER',
        title: `${topCat[0]} High Outlay`,
        message: `Highest spend category this month is ${topCat[0]} totaling ₹${(topCat[1] as number).toLocaleString()}.`,
      });
    }

    if (monthSummary.totalExpense > monthSummary.totalIncome * 0.7 && monthSummary.totalIncome > 0) {
      insights.push({
        type: 'WARNING',
        title: 'Burn Rate Warning',
        message: `Current expense burn rate is ${Math.round((monthSummary.totalExpense / monthSummary.totalIncome) * 100)}% of monthly income.`,
      });
    } else {
      insights.push({
        type: 'SUCCESS',
        title: 'Healthy Savings Rate',
        message: `You saved ₹${monthSummary.netSavings.toLocaleString()} this period. Target retention intact.`,
      });
    }

    return insights;
  }
}
