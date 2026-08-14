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

  public async calculatePulseScore(userId: string) {
    const monthSummary = await this.getSummaryReport(userId, 'month');
    const now = new Date();
    const budgets = await this.prisma.budget.findMany({
      where: { userId, month: now.getMonth() + 1, year: now.getFullYear() },
    });

    let score = 70; // Baseline
    const reasons: string[] = [];

    // Factor 1: Savings Rate (Max +20 / -20)
    if (monthSummary.totalIncome > 0) {
      const savingsRate = (monthSummary.netSavings / monthSummary.totalIncome) * 100;
      if (savingsRate >= 30) {
        score += 15;
        reasons.push(`High savings rate of ${Math.round(savingsRate)}% (+15 pts)`);
      } else if (savingsRate >= 15) {
        score += 8;
        reasons.push(`Moderate savings rate of ${Math.round(savingsRate)}% (+8 pts)`);
      } else if (savingsRate < 0) {
        score -= 20;
        reasons.push(`Negative cash flow (Deficit: ₹${Math.abs(monthSummary.netSavings).toLocaleString()}) (-20 pts)`);
      } else {
        score -= 5;
        reasons.push(`Low savings rate below 15% (-5 pts)`);
      }
    }

    // Factor 2: Budget Adherence (Max +15 / -15)
    if (budgets.length > 0) {
      let exceededCount = 0;
      let totalBudgetLimit = 0;
      for (const b of budgets) {
        totalBudgetLimit += Number(b.monthlyLimit);
      }

      if (monthSummary.totalExpense > totalBudgetLimit && totalBudgetLimit > 0) {
        score -= 15;
        reasons.push(`Overall monthly spending exceeded total budget limits (-15 pts)`);
      } else {
        score += 10;
        reasons.push(`Spending within monthly category limits (+10 pts)`);
      }
    }

    // Normalized between 0 and 100
    const finalScore = Math.min(100, Math.max(0, score));
    const grade = finalScore >= 80 ? 'Excellent' : finalScore >= 65 ? 'Good' : finalScore >= 50 ? 'Fair' : 'At Risk';

    return {
      pulseScore: finalScore,
      grade,
      reasons,
      evaluatedAt: new Date().toISOString(),
    };
  }

  public async calculateDailyDiscretionaryLimit(userId: string) {
    const monthSummary = await this.getSummaryReport(userId, 'month');
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysRemaining = Math.max(1, daysInMonth - now.getDate() + 1);

    // Sum active recurring expenses (fixed commitments)
    const recurringList = await this.prisma.recurringTransaction.findMany({
      where: { userId, isActive: true, type: 'EXPENSE' },
    });

    let fixedMonthly = 0;
    for (const r of recurringList) {
      fixedMonthly += Number(r.amount);
    }

    const projectedIncome = Math.max(monthSummary.totalIncome, 40000); // Default benchmark if income not logged yet
    const targetSavings = projectedIncome * 0.2; // 20% target savings
    const remainingDiscretionaryPool = Math.max(0, projectedIncome - fixedMonthly - targetSavings - monthSummary.totalExpense);

    const recommendedDaily = Math.round(remainingDiscretionaryPool / daysRemaining);

    return {
      recommendedDailyLimit: recommendedDaily,
      daysRemaining,
      projectedIncome,
      fixedCommitments: fixedMonthly,
      spentSoFar: monthSummary.totalExpense,
      currency: 'INR',
    };
  }

  public async detectDuplicate(userId: string, amount: number, merchant?: string): Promise<boolean> {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const existing = await this.prisma.transaction.findFirst({
      where: {
        userId,
        isDeleted: false,
        amount,
        merchant: merchant || undefined,
        createdAt: { gte: thirtyMinutesAgo },
      },
    });

    return !!existing;
  }

  public async generateInsights(userId: string, monthSummary: any) {
    const insights: Array<{ type: string; title: string; message: string }> = [];
    const catBreakdown = monthSummary.categoryBreakdown || {};
    const topCat = Object.entries(catBreakdown).sort((a: any, b: any) => (b[1] as number) - (a[1] as number))[0];

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
