import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  subMonths,
} from 'date-fns';
import { FinancialAmountSchema } from '../common/validation/schemas';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  public async getSummaryReport(
    userId: string,
    period: 'today' | 'week' | 'month' | 'year',
  ) {
    if (!userId || typeof userId !== 'string') {
      throw new BadRequestException('User identifier is required');
    }

    const validPeriods = ['today', 'week', 'month', 'year'];
    const cleanPeriod = validPeriods.includes(period) ? period : 'month';

    const now = new Date();
    let startDate: Date;
    let endDate: Date;

    switch (cleanPeriod) {
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
      where: {
        userId,
        isDeleted: false,
        transactionDate: { gte: startDate, lte: endDate },
      },
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

  private getCurrencySymbol(currency?: string): string {
    const code = (currency || 'INR').toUpperCase();
    switch (code) {
      case 'USD':
      case '$':
        return '$';
      case 'EUR':
      case '€':
        return '€';
      case 'GBP':
      case '£':
        return '£';
      case 'AED':
        return 'AED ';
      case 'INR':
      case '₹':
      default:
        return '₹';
    }
  }

  public async calculatePulseScore(userId: string) {
    const monthSummary = await this.getSummaryReport(userId, 'month');
    const now = new Date();
    const [budgets, userProfile] = await Promise.all([
      this.prisma.budget.findMany({
        where: { userId, month: now.getMonth() + 1, year: now.getFullYear() },
        include: { category: true },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { currency: true },
      }),
    ]);

    const currSym = this.getCurrencySymbol(userProfile?.currency);
    let score = 70; // Baseline
    const reasons: string[] = [];

    // Factor 1: Savings Rate (Max +20 / -20)
    if (monthSummary.totalIncome > 0) {
      const savingsRate =
        (monthSummary.netSavings / monthSummary.totalIncome) * 100;
      if (savingsRate >= 30) {
        score += 15;
        reasons.push(
          `High savings rate of ${Math.round(savingsRate)}% (+15 pts)`,
        );
      } else if (savingsRate >= 15) {
        score += 8;
        reasons.push(
          `Moderate savings rate of ${Math.round(savingsRate)}% (+8 pts)`,
        );
      } else if (savingsRate < 0) {
        score -= 20;
        reasons.push(
          `Negative cash flow (Deficit: ${currSym}${Math.abs(monthSummary.netSavings).toLocaleString()}) (-20 pts)`,
        );
      } else {
        score -= 5;
        reasons.push(`Low savings rate below 15% (-5 pts)`);
      }
    }

    // Factor 2: Budget Adherence (Strictly evaluates budgeted categories)
    if (budgets.length > 0) {
      let exceededCount = 0;
      for (const b of budgets) {
        const catName = b.category?.name || '';
        const limit = Number(b.monthlyLimit);
        const spentInCat = monthSummary.categoryBreakdown[catName] || 0;
        if (limit > 0 && spentInCat > limit) {
          exceededCount++;
        }
      }

      if (exceededCount > 0) {
        const penalty = Math.min(15, exceededCount * 5);
        score -= penalty;
        reasons.push(
          `${exceededCount} category budget limit${exceededCount > 1 ? 's' : ''} exceeded (-${penalty} pts)`,
        );
      } else {
        score += 10;
        reasons.push(`All category expenditures remain within configured budget limits (+10 pts)`);
      }
    }

    // Normalized between 0 and 100
    const finalScore = Math.min(100, Math.max(0, score));
    const grade =
      finalScore >= 80
        ? 'Excellent'
        : finalScore >= 65
          ? 'Good'
          : finalScore >= 50
            ? 'Fair'
            : 'At Risk';

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
    const daysInMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
    ).getDate();
    const daysRemaining = Math.max(1, daysInMonth - now.getDate() + 1);

    // Sum active recurring expenses (fixed commitments)
    const recurringList = await this.prisma.recurringTransaction.findMany({
      where: { userId, isActive: true, type: 'EXPENSE' },
    });

    let fixedMonthly = 0;
    for (const r of recurringList) {
      fixedMonthly += Number(r.amount);
    }

    // Query user profile for configured baseline income & target savings rate
    const userProfile = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { monthlyIncome: true, targetSavingsRate: true, currency: true },
    });

    const userBaseIncome = userProfile?.monthlyIncome ? Number(userProfile.monthlyIncome) : 0;
    const hasConfiguredIncome = userBaseIncome > 0 || monthSummary.totalIncome > 0;
    const projectedIncome = Math.max(monthSummary.totalIncome, userBaseIncome);
    const savingsRate = (userProfile?.targetSavingsRate ?? 20) / 100;
    const targetSavings = projectedIncome * savingsRate;

    // Discretionary pool calculation without fabricating dummy values
    let recommendedDaily = 0;
    if (hasConfiguredIncome) {
      const remainingDiscretionaryPool = Math.max(
        0,
        projectedIncome - fixedMonthly - targetSavings - monthSummary.totalExpense,
      );
      recommendedDaily = Math.round(remainingDiscretionaryPool / daysRemaining);
    }

    return {
      recommendedDailyLimit: recommendedDaily,
      daysRemaining,
      projectedIncome,
      fixedCommitments: fixedMonthly,
      spentSoFar: monthSummary.totalExpense,
      currency: userProfile?.currency || 'INR',
      needsIncomeConfig: !hasConfiguredIncome,
    };
  }

  public async detectDuplicate(
    userId: string,
    amount: number,
    merchant?: string,
  ): Promise<boolean> {
    if (!userId) return false;
    const validatedAmount = FinancialAmountSchema.safeParse(amount);
    if (!validatedAmount.success) return false;

    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const existing = await this.prisma.transaction.findFirst({
      where: {
        userId,
        isDeleted: false,
        amount: validatedAmount.data,
        merchant: merchant || undefined,
        createdAt: { gte: thirtyMinutesAgo },
      },
    });

    return !!existing;
  }

  public async generateInsights(userId: string, monthSummary: any) {
    const userProfile = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { currency: true },
    });
    const currSym = this.getCurrencySymbol(userProfile?.currency);

    const insights: Array<{ type: string; title: string; message: string }> = [];
    const catBreakdown = monthSummary.categoryBreakdown || {};
    const topCat = Object.entries(catBreakdown).sort(
      (a: any, b: any) => (b[1] as number) - (a[1] as number),
    )[0];

    if (topCat && (topCat[1] as number) > 0) {
      insights.push({
        type: 'DANGER',
        title: `${topCat[0]} High Outlay`,
        message: `Highest spend category this month is ${topCat[0]} totaling ${currSym}${(topCat[1] as number).toLocaleString()}.`,
      });
    }

    if (
      monthSummary.totalExpense > monthSummary.totalIncome * 0.7 &&
      monthSummary.totalIncome > 0
    ) {
      insights.push({
        type: 'WARNING',
        title: 'Burn Rate Warning',
        message: `Current expense burn rate is ${Math.round((monthSummary.totalExpense / monthSummary.totalIncome) * 100)}% of monthly income.`,
      });
    } else if (monthSummary.totalIncome > 0) {
      insights.push({
        type: 'SUCCESS',
        title: 'Healthy Savings Rate',
        message: `You saved ${currSym}${monthSummary.netSavings.toLocaleString()} this period. Target retention intact.`,
      });
    } else {
      insights.push({
        type: 'INFO',
        title: 'Active Financial Ledger',
        message: `Recorded ${monthSummary.transactionCount} transaction${monthSummary.transactionCount === 1 ? '' : 's'} across active categories.`,
      });
    }

    return insights;
  }

  public async getFinancialContextSnapshot(userId: string) {
    const now = new Date();
    const currentMonthStart = startOfMonth(now);
    const currentMonthEnd = endOfMonth(now);
    const priorMonthDate = subMonths(now, 1);
    const priorMonthStart = startOfMonth(priorMonthDate);
    const priorMonthEnd = endOfMonth(priorMonthDate);

    const [userProfile, currentTxs, priorTxs, recurringTxs, budgets] =
      await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { monthlyIncome: true, targetSavingsRate: true, currency: true },
        }),
        this.prisma.transaction.findMany({
          where: {
            userId,
            isDeleted: false,
            transactionDate: { gte: currentMonthStart, lte: currentMonthEnd },
          },
          include: { category: true },
          orderBy: { transactionDate: 'desc' },
        }),
        this.prisma.transaction.findMany({
          where: {
            userId,
            isDeleted: false,
            transactionDate: { gte: priorMonthStart, lte: priorMonthEnd },
          },
          include: { category: true },
        }),
        this.prisma.recurringTransaction.findMany({
          where: { userId, isActive: true },
          include: { category: true },
        }),
        this.prisma.budget.findMany({
          where: {
            userId,
            month: now.getMonth() + 1,
            year: now.getFullYear(),
          },
          include: { category: true },
        }),
      ]);

    const currSym = this.getCurrencySymbol(userProfile?.currency);

    const computeMetrics = (txs: typeof currentTxs) => {
      let income = 0;
      let expense = 0;
      const catBreakdown: Record<string, number> = {};
      const merchantBreakdown: Record<
        string,
        { total: number; count: number; category: string }
      > = {};

      for (const t of txs) {
        const amt = Number(t.amount);
        if (t.type === 'EXPENSE') {
          expense += amt;
          const cat = t.category?.name || 'Uncategorized';
          catBreakdown[cat] = (catBreakdown[cat] || 0) + amt;
          const m = t.merchant || t.description || 'General Outlay';
          if (!merchantBreakdown[m]) {
            merchantBreakdown[m] = { total: 0, count: 0, category: cat };
          }
          merchantBreakdown[m].total += amt;
          merchantBreakdown[m].count += 1;
        } else {
          income += amt;
        }
      }

      return {
        income,
        expense,
        netSavings: income - expense,
        transactionCount: txs.length,
        catBreakdown,
        merchantBreakdown,
      };
    };

    const current = computeMetrics(currentTxs);
    const prior = computeMetrics(priorTxs);

    const daysInMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
    ).getDate();
    const dayOfMonth = now.getDate();
    const daysRemaining = Math.max(1, daysInMonth - dayOfMonth + 1);
    const dailyBurnSoFar =
      dayOfMonth > 0 ? Math.round(current.expense / dayOfMonth) : 0;
    const projectedMonthEndSpend = Math.round(dailyBurnSoFar * daysInMonth);

    const userBaseIncome = userProfile?.monthlyIncome
      ? Number(userProfile.monthlyIncome)
      : 0;
    const effectiveIncome = Math.max(current.income, userBaseIncome);
    const savingsTargetPct = userProfile?.targetSavingsRate ?? 20;
    const targetSavings = effectiveIncome * (savingsTargetPct / 100);

    return {
      userId,
      currSym,
      currencyCode: userProfile?.currency || 'INR',
      daysInMonth,
      dayOfMonth,
      daysRemaining,
      dailyBurnSoFar,
      projectedMonthEndSpend,
      effectiveIncome,
      savingsTargetPct,
      targetSavings,
      current,
      prior,
      currentTxs,
      recurringTxs,
      budgets,
    };
  }

  public async performFinancialRagAnalysis(
    userId: string,
    query: string,
  ): Promise<{ reply: string; data?: any }> {
    const ctx = await this.getFinancialContextSnapshot(userId);
    const lower = query.toLowerCase();
    const sym = ctx.currSym;

    // Sub-intent 1: Month-over-Month Comparison
    if (
      lower.includes('compare') ||
      lower.includes('vs last') ||
      lower.includes('versus') ||
      lower.includes('last month') ||
      lower.includes('trend')
    ) {
      if (ctx.prior.expense === 0 && ctx.current.expense === 0) {
        return {
          reply: `📊 **Month-over-Month Comparison**\n\nNo expense transactions have been recorded for either this month or last month yet. Once you log outlays, I'll provide side-by-side velocity and category variance metrics.`,
          data: ctx,
        };
      }

      const diff = ctx.current.expense - ctx.prior.expense;
      const pct =
        ctx.prior.expense > 0
          ? Math.round((Math.abs(diff) / ctx.prior.expense) * 100)
          : null;
      const directionEmoji = diff > 0 ? '🔺' : diff < 0 ? '🟢' : '➡️';
      const directionText =
        diff > 0
          ? `+${sym}${diff.toLocaleString()} (${pct}% increase)`
          : diff < 0
            ? `-${sym}${Math.abs(diff).toLocaleString()} (${pct}% decrease)`
            : `identical (${sym}0 variance)`;

      // Identify major category shifts
      const allCats = Array.from(
        new Set([
          ...Object.keys(ctx.current.catBreakdown),
          ...Object.keys(ctx.prior.catBreakdown),
        ]),
      );

      const catShifts = allCats
        .map((cat) => {
          const currAmt = ctx.current.catBreakdown[cat] || 0;
          const priorAmt = ctx.prior.catBreakdown[cat] || 0;
          const delta = currAmt - priorAmt;
          return { cat, currAmt, priorAmt, delta };
        })
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 3);

      const shiftLines = catShifts
        .map((s) => {
          const shiftSign =
            s.delta > 0 ? '🔺 +' : s.delta < 0 ? '🟢 -' : '➡️ ';
          return `• **${s.cat}**: ${shiftSign}${sym}${Math.abs(s.delta).toLocaleString()} (Now: ${sym}${s.currAmt.toLocaleString()} vs Prior: ${sym}${s.priorAmt.toLocaleString()})`;
        })
        .join('\n');

      const savingsRateCurr =
        ctx.effectiveIncome > 0
          ? Math.round(
              ((ctx.effectiveIncome - ctx.current.expense) /
                ctx.effectiveIncome) *
                100,
            )
          : null;

      let reply = `📊 **Month-over-Month Comparative Audit**\n\n`;
      reply += `• **This Month Spending**: ${sym}${ctx.current.expense.toLocaleString()} (${ctx.dayOfMonth}/${ctx.daysInMonth} days)\n`;
      reply += `• **Last Month Total**: ${sym}${ctx.prior.expense.toLocaleString()}\n`;
      reply += `• **Net Trajectory**: ${directionEmoji} ${directionText}\n\n`;
      if (shiftLines) {
        reply += `**Key Category Shifts**:\n${shiftLines}\n\n`;
      }
      if (savingsRateCurr !== null) {
        reply += `💡 **Current Savings Retention**: **${savingsRateCurr}%** of income preserved this month.`;
      }

      return { reply, data: ctx };
    }

    // Sub-intent 2: Subscriptions & Recurring Commitments Audit
    if (
      lower.includes('subscription') ||
      lower.includes('recurring') ||
      lower.includes('membership') ||
      lower.includes('audit') ||
      lower.includes('bill')
    ) {
      const subKeywords = [
        'netflix',
        'spotify',
        'prime',
        'amazon prime',
        'gym',
        'fitness',
        'icloud',
        'youtube',
        'chatgpt',
        'openai',
        'claude',
        'wifi',
        'broadband',
        'airtel',
        'jio',
        'disney',
        'hotstar',
        'patreon',
        'apple',
        'adobe',
        'aws',
        'github',
        'zoom',
        'subscription',
      ];

      const detectedSubs: Array<{
        name: string;
        amount: number;
        source: string;
      }> = [];

      for (const r of ctx.recurringTxs) {
        detectedSubs.push({
          name: r.description || r.category?.name || 'Recurring Commitment',
          amount: Number(r.amount),
          source: 'Configured Recurring',
        });
      }

      const existingNames = new Set(
        detectedSubs.map((s) => (s.name || '').toLowerCase()),
      );
      for (const [mName, mData] of Object.entries(
        ctx.current.merchantBreakdown,
      )) {
        const lowerM = mName.toLowerCase();
        if (
          !existingNames.has(lowerM) &&
          subKeywords.some((k) => lowerM.includes(k))
        ) {
          detectedSubs.push({
            name: mName,
            amount: mData.total,
            source: 'Detected Service',
          });
          existingNames.add(lowerM);
        }
      }

      const totalMonthlySub = detectedSubs.reduce(
        (sum, s) => sum + s.amount,
        0,
      );
      const annualizedSub = totalMonthlySub * 12;

      let reply = `🔍 **Subscription & Recurring Commitments Audit**\n\n`;
      if (detectedSubs.length === 0) {
        reply += `No active recurring subscriptions or recurring billing profiles detected in your ledger! All current expenses are variable on-demand outlays.`;
      } else {
        const subList = detectedSubs
          .map(
            (s) =>
              `• **${s.name}**: ${sym}${s.amount.toLocaleString()}/mo (${s.source})`,
          )
          .join('\n');

        const incomeShare =
          ctx.effectiveIncome > 0
            ? ` (${Math.round((totalMonthlySub / ctx.effectiveIncome) * 100)}% of monthly income)`
            : '';

        reply += `Identified **${detectedSubs.length} active recurring commitments** totaling **${sym}${totalMonthlySub.toLocaleString()}/month**${incomeShare}:\n\n`;
        reply += `${subList}\n\n`;
        reply += `• **Annualized Drag**: **${sym}${annualizedSub.toLocaleString()}/year** committed overhead.\n`;
        reply += `💡 **Tactical Tip**: Auditing and canceling 1–2 unused digital services can instantly free up ${sym}${Math.round(totalMonthlySub * 0.3).toLocaleString()}/month.`;
      }

      return {
        reply,
        data: { detectedSubs, totalMonthlySub, annualizedSub },
      };
    }

    // Sub-intent 3: Affordability & Purchase Simulation
    if (
      lower.includes('afford') ||
      lower.includes('should i buy') ||
      lower.includes('can i spend') ||
      lower.includes('planning to buy') ||
      lower.includes('what if')
    ) {
      const amtMatch = query.match(/(?:[^\d]|^)(\d+(?:,\d+)*(?:\.\d+)?)/);
      const parsedAmount = amtMatch
        ? parseFloat(amtMatch[1].replace(/,/g, ''))
        : null;

      const discretionaryPool = Math.max(
        0,
        ctx.effectiveIncome - ctx.current.expense - ctx.targetSavings,
      );

      let reply = `🤔 **Affordability & Purchase Impact Simulation**\n\n`;

      if (parsedAmount && parsedAmount > 0) {
        if (ctx.effectiveIncome === 0) {
          reply += `You're evaluating an outlay of **${sym}${parsedAmount.toLocaleString()}**.\n\n`;
          reply += `• **Month Spend to Date**: ${sym}${ctx.current.expense.toLocaleString()}\n`;
          reply += `• **Days Remaining**: ${ctx.daysRemaining} days\n\n`;
          reply += `Since baseline income is unconfigured, this purchase will increase your monthly outflow to **${sym}${(ctx.current.expense + parsedAmount).toLocaleString()}**. If you set your income in Settings, I'll calculate exact savings retention!`;
        } else if (parsedAmount <= discretionaryPool) {
          const remainingAfter = discretionaryPool - parsedAmount;
          const newDaily = Math.round(remainingAfter / ctx.daysRemaining);
          reply += `✅ **Fully Affordable!**\n\n`;
          reply += `An outlay of **${sym}${parsedAmount.toLocaleString()}** fits safely within your remaining discretionary pool of **${sym}${discretionaryPool.toLocaleString()}**.\n\n`;
          reply += `• **Discretionary Buffer Left**: ${sym}${remainingAfter.toLocaleString()}\n`;
          reply += `• **Adjusted Daily Allowance**: ${sym}${newDaily.toLocaleString()}/day for the next ${ctx.daysRemaining} days\n`;
          reply += `• **Target Savings**: ${sym}${ctx.targetSavings.toLocaleString()} (${ctx.savingsTargetPct}%) remains completely protected!`;
        } else {
          const deficit = parsedAmount - discretionaryPool;
          reply += `⚠️ **Budget Strain Detected**\n\n`;
          reply += `Spending **${sym}${parsedAmount.toLocaleString()}** exceeds your remaining unallocated discretionary pool of **${sym}${discretionaryPool.toLocaleString()}** by **${sym}${deficit.toLocaleString()}**.\n\n`;
          reply += `• **Impact**: This purchase would dip into your target savings buffer by ${sym}${deficit.toLocaleString()}.\n`;
          reply += `• **Recommendation**: To keep your ${ctx.savingsTargetPct}% savings target intact, consider deferring this to next month or trimming non-essential dining/shopping by ${sym}${deficit.toLocaleString()}.`;
        }
      } else {
        reply += `• **Current Effective Income**: ${sym}${ctx.effectiveIncome.toLocaleString()}\n`;
        reply += `• **Spent So Far**: ${sym}${ctx.current.expense.toLocaleString()}\n`;
        reply += `• **Protected Savings**: ${sym}${ctx.targetSavings.toLocaleString()} (${ctx.savingsTargetPct}%)\n`;
        reply += `• **Remaining Discretionary Pool**: **${sym}${discretionaryPool.toLocaleString()}**\n\n`;
        reply += `You have **${sym}${Math.round(discretionaryPool / ctx.daysRemaining).toLocaleString()}/day** safe spending power for the remaining **${ctx.daysRemaining} days**. Ask me "Can I afford 5000?" with any amount to test a specific purchase!`;
      }

      return { reply, data: ctx };
    }

    // Sub-intent 4: Spending Leakage & Friction Point Detection
    if (
      lower.includes('leak') ||
      lower.includes('waste') ||
      lower.includes('hidden') ||
      lower.includes('cut down') ||
      lower.includes('save money') ||
      lower.includes('friction')
    ) {
      const microThreshold = ctx.currencyCode === 'INR' ? 400 : 20;
      const microTxs = ctx.currentTxs.filter(
        (t) => t.type === 'EXPENSE' && Number(t.amount) <= microThreshold,
      );
      const microTotal = microTxs.reduce(
        (sum, t) => sum + Number(t.amount),
        0,
      );

      let dominantCat: {
        name: string;
        pct: number;
        amount: number;
      } | null = null;
      if (ctx.current.expense > 0) {
        for (const [cat, amt] of Object.entries(ctx.current.catBreakdown)) {
          const pct = Math.round((amt / ctx.current.expense) * 100);
          if (pct >= 30) {
            dominantCat = { name: cat, pct, amount: amt };
            break;
          }
        }
      }

      const overBudgets: Array<{ category: string; over: number }> = [];
      for (const b of ctx.budgets) {
        const catName = b.category?.name || '';
        const limit = Number(b.monthlyLimit);
        const spent = ctx.current.catBreakdown[catName] || 0;
        if (limit > 0 && spent > limit) {
          overBudgets.push({ category: catName, over: spent - limit });
        }
      }

      let reply = `💡 **Spending Leakage & Anomaly Audit**\n\n`;

      if (microTxs.length >= 3) {
        reply += `• **Micro-Transaction Creep**: Found **${microTxs.length} small transactions** (under ${sym}${microThreshold}) totaling **${sym}${microTotal.toLocaleString()}**. Frequent small orders accumulate fast!\n`;
      }

      if (dominantCat) {
        reply += `• **High Category Concentration**: **${dominantCat.name}** accounts for **${dominantCat.pct}%** (${sym}${dominantCat.amount.toLocaleString()}) of all outlays this month.\n`;
      }

      if (overBudgets.length > 0) {
        const overList = overBudgets
          .map(
            (o) =>
              `  - ${o.category}: +${sym}${o.over.toLocaleString()} over limit`,
          )
          .join('\n');
        reply += `• **Exceeded Budgets**:\n${overList}\n`;
      }

      if (microTxs.length < 3 && !dominantCat && overBudgets.length === 0) {
        reply += `Your ledger exhibits disciplined control with no excessive micro-spending leaks or severe budget breaches detected. Keep maintaining this pace!`;
      } else {
        const potentialSavings = Math.round(
          microTotal * 0.4 +
            overBudgets.reduce((s, o) => s + o.over, 0),
        );
        reply += `\n🎯 **Immediate Action Plan**: Consolidating micro-deliveries and capping high-burn categories could retain up to **${sym}${potentialSavings.toLocaleString()}** before month end.`;
      }

      return {
        reply,
        data: {
          microTxs: microTxs.length,
          microTotal,
          dominantCat,
          overBudgets,
        },
      };
    }

    // Sub-intent 5: Trajectory & Scenario Forecasting
    const projectedDeficitOrSurplus =
      ctx.effectiveIncome - ctx.projectedMonthEndSpend;

    let reply = `📈 **Month-End Trajectory & Velocity Forecast**\n\n`;
    reply += `• **Current Burn Velocity**: ${sym}${ctx.dailyBurnSoFar.toLocaleString()}/day over the first ${ctx.dayOfMonth} days\n`;
    reply += `• **Projected Month-End Spend**: **${sym}${ctx.projectedMonthEndSpend.toLocaleString()}**\n`;
    reply += `• **Days Remaining**: ${ctx.daysRemaining} days\n\n`;

    if (ctx.effectiveIncome > 0) {
      if (projectedDeficitOrSurplus >= ctx.targetSavings) {
        reply += `🟢 **On Track for Surplus**: At your current pace, you will finish the month with **+${sym}${projectedDeficitOrSurplus.toLocaleString()}** in net savings, safely beating your target of ${sym}${ctx.targetSavings.toLocaleString()} (${ctx.savingsTargetPct}%).`;
      } else if (projectedDeficitOrSurplus >= 0) {
        reply += `🟡 **Moderate Surplus**: You are projected to finish with **+${sym}${projectedDeficitOrSurplus.toLocaleString()}** in savings, but slightly below your ideal target of ${sym}${ctx.targetSavings.toLocaleString()}.`;
      } else {
        reply += `🔴 **Deficit Alert**: At this burn rate, spending is projected to exceed income by **${sym}${Math.abs(projectedDeficitOrSurplus).toLocaleString()}**. To avoid a deficit, throttle daily spend to under **${sym}${Math.max(0, Math.round((ctx.effectiveIncome - ctx.current.expense) / ctx.daysRemaining)).toLocaleString()}/day**.`;
      }
    } else {
      reply += `💡 Set your monthly income in Settings to enable real-time surplus/deficit projections and automated runway modeling!`;
    }

    return { reply, data: ctx };
  }
}
