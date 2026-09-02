import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionService } from '../transactions/transaction.service';
import { NluService } from '../nlu/nlu.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { Prisma, User } from '@prisma/client';
import {
  CreateManualTransactionSchema,
  SetBudgetSchema,
  CreateRecurringSchema,
} from '../common/validation/schemas';
import { AuditService } from '../common/audit/audit.service';

@Controller()
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly prisma: PrismaService,
    private readonly transactionService: TransactionService,
    private readonly nluService: NluService,
    private readonly auditService: AuditService,
  ) {}

  @Post('api/chat')
  @UseGuards(OptionalJwtAuthGuard)
  async handleChat(
    @Body('message') message: string,
    @Req() req: Request & { user?: User },
  ) {
    let user = req.user;
    if (!message || !message.trim()) {
      return { reply: 'Please provide a message or expense description.' };
    }

    const trimmedMsg = message.trim();
    const lower = trimmedMsg.toLowerCase();

    // 1. Instant informational guidance for SaaS questions
    if (
      lower.includes('pulse') ||
      lower.includes('health') ||
      lower.includes('score')
    ) {
      return {
        reply:
          '📈 **Pulse Health (0–100)** measures your net savings retention, budget pacing, and spending discipline. Scores >80 indicate optimal financial health! You can log your expenses in natural language to update your score.',
      };
    }
    if (
      lower.includes('safe') ||
      lower.includes('daily') ||
      lower.includes('limit')
    ) {
      return {
        reply:
          '🛡️ **Safe Daily Spend Limit** dynamically divides your remaining discretionary budget by the exact days left in the month to guarantee you never overspend.',
      };
    }
    if (
      lower.includes('recurring') ||
      lower.includes('sip') ||
      lower.includes('rent') ||
      lower.includes('emi')
    ) {
      return {
        reply:
          '🔁 **Recurring Outlays:** Set up recurring commitments (like Rent on 1st or SIP on 5th) and Kinetiq will auto-log them and project your cashflow in real time.',
      };
    }

    // 2. If unauthenticated guest and trying to log transactions, assign demo user or guide them
    if (!user) {
      let demoUser = await this.prisma.user.findUnique({
        where: { email: 'demo@pulseai.internal' },
      });
      if (!demoUser) {
        demoUser = await this.prisma.user.create({
          data: {
            email: 'demo@pulseai.internal',
            firstName: 'Demo Guest',
            currency: 'INR',
          },
        });
        await this.transactionService.seedDefaultCategories(demoUser.id);
      }
      user = demoUser;
    }

    const nluResult = await this.nluService.processUserInput(
      user.id,
      trimmedMsg,
    );
    const curr = user.currency || '₹';

    // 3. Transaction extraction & auto-creation
    if (nluResult.transactions && nluResult.transactions.length > 0) {
      const createdTxList: any[] = [];
      for (const txData of nluResult.transactions) {
        const tx = await this.transactionService.createManualTransaction(
          user.id,
          {
            type: txData.type,
            merchant: txData.merchant || txData.description || 'General Outlay',
            amount: txData.amount,
            categoryName: txData.category,
          },
        );
        createdTxList.push(tx);
      }

      const tx: any = createdTxList[0];
      const isExpense = tx.type === 'EXPENSE';
      const actionText = isExpense ? 'Logged expense' : 'Recorded income';
      return {
        reply: `✅ **${actionText}:** ${curr}${Number(tx.amount).toLocaleString()} for *${tx.merchant || tx.description}* (${tx.category?.name || 'Others'}).\n\nYour live dashboard has been updated!`,
        transaction: tx,
        transactions: createdTxList,
      };
    }

    // 4. Tool Query Result
    if (nluResult.toolResult) {
      return {
        reply:
          nluResult.replyText ||
          (typeof nluResult.toolResult === 'string'
            ? nluResult.toolResult
            : JSON.stringify(nluResult.toolResult)),
        toolResult: nluResult.toolResult,
      };
    }

    // 5. Fallback conversational reply
    if (nluResult.replyText) {
      return { reply: nluResult.replyText };
    }

    return {
      reply: `💡 **Kinetiq Assistant:**\n• To add an expense, type: \`spent 450 on swiggy\` or \`uber 320\`\n• To log income: \`salary +65000 credited\`\n• To ask a question: \`what is pulse health?\``,
    };
  }

  @Get(['api/transactions', 'analytics/dashboard-data'])
  @UseGuards(JwtAuthGuard)
  async getDashboardData(@Req() req: Request & { user: User }) {
    const user = req.user;

    const todaySummary = await this.analyticsService.getSummaryReport(
      user.id,
      'today',
    );
    const weekSummary = await this.analyticsService.getSummaryReport(
      user.id,
      'week',
    );
    const monthSummary = await this.analyticsService.getSummaryReport(
      user.id,
      'month',
    );
    const yearSummary = await this.analyticsService.getSummaryReport(
      user.id,
      'year',
    );

    const recentTransactions = await this.prisma.transaction.findMany({
      where: { userId: user.id, isDeleted: false },
      orderBy: { transactionDate: 'desc' },
      take: 20,
      include: { category: true },
    });

    const now = new Date();
    const budgets = await this.prisma.budget.findMany({
      where: {
        userId: user.id,
        month: now.getMonth() + 1,
        year: now.getFullYear(),
      },
      include: { category: true },
    });

    const budgetOverview = budgets.map((b) => {
      const spent = monthSummary.categoryBreakdown[b.category.name] || 0;
      const limitNum = Number(b.monthlyLimit);
      const percentage = limitNum > 0 ? (spent / limitNum) * 100 : 0;
      return {
        category: b.category.name,
        spent,
        limit: limitNum,
        percentage: Math.min(Math.round(percentage * 10) / 10, 100),
      };
    });

    const weeklyTrend = await this.analyticsService.getWeeklyTrend(user.id);
    const aiInsights = await this.analyticsService.generateInsights(
      user.id,
      monthSummary,
    );
    const pulseHealth = await this.analyticsService.calculatePulseScore(
      user.id,
    );
    const dailyLimit =
      await this.analyticsService.calculateDailyDiscretionaryLimit(user.id);

    return {
      user: {
        id: user.id,
        telegramId: user.telegramId,
        firstName: user.firstName || 'User',
        lastName: user.lastName || '',
        username: user.username,
        profilePhotoUrl: user.profilePhotoUrl,
        currency: user.currency || '₹',
      },
      pulseHealth,
      dailyLimit,
      today: todaySummary,
      week: weekSummary,
      month: monthSummary,
      year: yearSummary,
      weeklyTrend,
      budgetOverview,
      aiInsights,
      recentTransactions: recentTransactions.map((t) => ({
        ...t,
        amount: Number(t.amount),
        originalAmount: t.originalAmount ? Number(t.originalAmount) : null,
      })),
    };
  }

  @Post(['api/transactions', 'analytics/transaction'])
  @UseGuards(JwtAuthGuard)
  async createTransaction(
    @Body() body: any,
    @Req() req: Request & { user: User },
  ) {
    const user = req.user;

    const validation = CreateManualTransactionSchema.safeParse(body);
    if (!validation.success) {
      const errorMsg = validation.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join(', ');
      throw new BadRequestException(`Invalid transaction payload: ${errorMsg}`);
    }

    return this.transactionService.createManualTransaction(
      user.id,
      validation.data,
    );
  }

  
  @Patch(['api/transactions/:id', 'analytics/transaction/:id'])
  @UseGuards(JwtAuthGuard)
  async updateTransaction(
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: Request & { user: User },
  ) {
    const user = req.user;
    if (!id || typeof id !== 'string') {
      throw new BadRequestException('Transaction ID is required');
    }
    return this.transactionService.updateTransactionDetails(user.id, id.trim(), body);
  }

  @Delete(['api/transactions/:id', 'analytics/transaction/:id'])
  @UseGuards(JwtAuthGuard)
  async deleteTransaction(
    @Param('id') id: string,
    @Req() req: Request & { user: User },
  ) {
    const user = req.user;

    if (!id || typeof id !== 'string' || id.trim() === '') {
      throw new BadRequestException('Transaction ID is required');
    }

    // Secure ownership verification: query strictly by ID AND userId
    const tx = await this.prisma.transaction.findFirst({
      where: { id: id.trim(), userId: user.id, isDeleted: false },
    });

    if (!tx) {
      throw new NotFoundException('Transaction not found');
    }

    const updated = await this.prisma.transaction.update({
      where: { id: tx.id },
      data: { isDeleted: true },
    });

    await this.auditService.log({
      userId: user.id,
      action: 'TRANSACTION_DELETED',
      entityType: 'TRANSACTION',
      entityId: tx.id,
      source: 'WEB',
      details: {
        amount: Number(tx.amount),
        type: tx.type,
        merchant: tx.merchant,
      },
    });

    return updated;
  }

  @Get(['api/budgets', 'analytics/budgets'])
  @UseGuards(JwtAuthGuard)
  async getBudgets(@Req() req: Request & { user: User }) {
    const user = req.user;
    const now = new Date();

    return this.prisma.budget.findMany({
      where: {
        userId: user.id,
        month: now.getMonth() + 1,
        year: now.getFullYear(),
      },
      include: { category: true },
    });
  }

  @Post(['api/budgets', 'analytics/budget'])
  @UseGuards(JwtAuthGuard)
  async setBudget(@Body() body: any, @Req() req: Request & { user: User }) {
    const user = req.user;

    const validation = SetBudgetSchema.safeParse(body);
    if (!validation.success) {
      const errorMsg = validation.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join(', ');
      throw new BadRequestException(`Invalid budget payload: ${errorMsg}`);
    }

    return this.transactionService.setBudgetLimit(
      user.id,
      validation.data.categoryName,
      validation.data.monthlyLimit,
    );
  }

  @Get(['api/recurring', 'analytics/recurring'])
  @UseGuards(JwtAuthGuard)
  async getRecurring(@Req() req: Request & { user: User }) {
    const user = req.user;

    const recurring = await this.prisma.recurringTransaction.findMany({
      where: { userId: user.id },
      include: { category: true },
      orderBy: { createdAt: 'desc' },
    });

    return recurring.map((r) => ({
      ...r,
      amount: Number(r.amount),
    }));
  }

  @Post(['api/recurring', 'analytics/recurring'])
  @UseGuards(JwtAuthGuard)
  async createRecurring(
    @Body() body: any,
    @Req() req: Request & { user: User },
  ) {
    const user = req.user;

    const validation = CreateRecurringSchema.safeParse(body);
    if (!validation.success) {
      const errorMsg = validation.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join(', ');
      throw new BadRequestException(`Invalid recurring payload: ${errorMsg}`);
    }

    const { type, name, amount, categoryName, dayOfMonth } = validation.data;

    let category = await this.prisma.category.findFirst({
      where: {
        userId: user.id,
        name: { equals: categoryName || 'Others', mode: 'insensitive' },
      },
    });

    if (!category) {
      category = await this.prisma.category.create({
        data: { name: categoryName || 'Others', userId: user.id },
      });
    }

    const day = dayOfMonth || 1;
    const now = new Date();
    let nextRun = new Date(now.getFullYear(), now.getMonth(), day);
    if (nextRun <= now) {
      nextRun = new Date(now.getFullYear(), now.getMonth() + 1, day);
    }

    const cronExp = `0 0 ${day} * *`;

    const recurring = await this.prisma.recurringTransaction.create({
      data: {
        userId: user.id,
        categoryId: category.id,
        type: type || 'EXPENSE',
        amount: new Prisma.Decimal(amount),
        description: name,
        cronExpression: cronExp,
        nextRun,
        isActive: true,
      },
      include: { category: true },
    });

    await this.auditService.log({
      userId: user.id,
      action: 'RECURRING_CREATED',
      entityType: 'RECURRING_TRANSACTION',
      entityId: recurring.id,
      source: 'WEB',
      details: {
        name,
        amount,
        type: type || 'EXPENSE',
        dayOfMonth: day,
        category: category.name,
      },
    });

    return recurring;
  }

  @Get(['api/export/csv', 'analytics/export/csv'])
  @UseGuards(JwtAuthGuard)
  async exportCsv(@Req() req: Request & { user: User }) {
    const user = req.user;

    const transactions = await this.prisma.transaction.findMany({
      where: { userId: user.id, isDeleted: false },
      include: { category: true },
      orderBy: { transactionDate: 'desc' },
    });

    let csv = 'Date,Merchant/Description,Category,Type,ParsedBy,Amount\n';
    transactions.forEach((t) => {
      const d = new Date(t.transactionDate).toISOString().split('T')[0];
      let merchantRaw = (t.merchant || t.description || '').replace(/"/g, '""');
      if (['=', '+', '-', '@'].includes(merchantRaw.charAt(0))) {
        merchantRaw = `'` + merchantRaw;
      }
      const merchant = `"${merchantRaw}"`;

      let catRaw = (t.category?.name || 'Others').replace(/"/g, '""');
      if (['=', '+', '-', '@'].includes(catRaw.charAt(0))) {
        catRaw = `'` + catRaw;
      }
      const cat = `"${catRaw}"`;

      csv += `${d},${merchant},${cat},${t.type},${t.parsedBy},${Number(t.amount)}\n`;
    });

    return csv;
  }
}
