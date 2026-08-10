import { Controller, Get, Post, Delete, Param, Body, UseGuards, Req, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionService } from '../transactions/transaction.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Prisma, User } from '@prisma/client';

@Controller()
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly prisma: PrismaService,
    private readonly transactionService: TransactionService,
  ) {}

  @Get(['api/transactions', 'analytics/dashboard-data'])
  async getDashboardData(@Req() req: Request & { user: User }) {
    const user = req.user;

    const todaySummary = await this.analyticsService.getSummaryReport(user.id, 'today');
    const weekSummary = await this.analyticsService.getSummaryReport(user.id, 'week');
    const monthSummary = await this.analyticsService.getSummaryReport(user.id, 'month');
    const yearSummary = await this.analyticsService.getSummaryReport(user.id, 'year');

    const recentTransactions = await this.prisma.transaction.findMany({
      where: { userId: user.id, isDeleted: false },
      orderBy: { transactionDate: 'desc' },
      take: 20,
      include: { category: true },
    });

    const now = new Date();
    const budgets = await this.prisma.budget.findMany({
      where: { userId: user.id, month: now.getMonth() + 1, year: now.getFullYear() },
      include: { category: true },
    });

    const budgetOverview = budgets.map(b => {
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
    const aiInsights = await this.analyticsService.generateInsights(user.id, monthSummary);

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
      today: todaySummary,
      week: weekSummary,
      month: monthSummary,
      year: yearSummary,
      weeklyTrend,
      budgetOverview,
      aiInsights,
      recentTransactions: recentTransactions.map(t => ({
        ...t,
        amount: Number(t.amount),
        originalAmount: t.originalAmount ? Number(t.originalAmount) : null,
      })),
    };
  }

  @Post(['api/transactions', 'analytics/transaction'])
  async createTransaction(@Body() body: any, @Req() req: Request & { user: User }) {
    const user = req.user;

    return this.transactionService.createManualTransaction(user.telegramId, {
      type: body.type,
      merchant: body.merchant,
      amount: parseFloat(body.amount),
      categoryName: body.categoryName,
    });
  }

  @Delete(['api/transactions/:id', 'analytics/transaction/:id'])
  async deleteTransaction(@Param('id') id: string, @Req() req: Request & { user: User }) {
    const user = req.user;

    // Secure ownership verification: query strictly by ID AND userId
    const tx = await this.prisma.transaction.findFirst({
      where: { id, userId: user.id, isDeleted: false },
    });

    if (!tx) {
      throw new NotFoundException('Transaction not found');
    }

    return this.prisma.transaction.update({
      where: { id: tx.id },
      data: { isDeleted: true },
    });
  }

  @Get(['api/budgets', 'analytics/budgets'])
  async getBudgets(@Req() req: Request & { user: User }) {
    const user = req.user;
    const now = new Date();

    return this.prisma.budget.findMany({
      where: { userId: user.id, month: now.getMonth() + 1, year: now.getFullYear() },
      include: { category: true },
    });
  }

  @Post(['api/budgets', 'analytics/budget'])
  async setBudget(@Body() body: any, @Req() req: Request & { user: User }) {
    const user = req.user;

    return this.transactionService.setBudgetLimit(
      user.telegramId,
      body.categoryName,
      parseFloat(body.monthlyLimit),
    );
  }

  @Get(['api/recurring', 'analytics/recurring'])
  async getRecurring(@Req() req: Request & { user: User }) {
    const user = req.user;

    const recurring = await this.prisma.recurringTransaction.findMany({
      where: { userId: user.id },
      include: { category: true },
      orderBy: { createdAt: 'desc' },
    });

    return recurring.map(r => ({
      ...r,
      amount: Number(r.amount),
    }));
  }

  @Post(['api/recurring', 'analytics/recurring'])
  async createRecurring(@Body() body: any, @Req() req: Request & { user: User }) {
    const user = req.user;
    const { type, name, amount, categoryName, dayOfMonth } = body;

    let category = await this.prisma.category.findFirst({
      where: { userId: user.id, name: { equals: categoryName || 'Others', mode: 'insensitive' } },
    });

    if (!category) {
      category = await this.prisma.category.create({
        data: { name: categoryName || 'Others', userId: user.id },
      });
    }

    const day = parseInt(dayOfMonth || '1');
    const now = new Date();
    let nextRun = new Date(now.getFullYear(), now.getMonth(), day);
    if (nextRun <= now) {
      nextRun = new Date(now.getFullYear(), now.getMonth() + 1, day);
    }

    const cronExp = `0 0 ${day} * *`;

    return this.prisma.recurringTransaction.create({
      data: {
        userId: user.id,
        categoryId: category.id,
        type: type || 'EXPENSE',
        amount: new Prisma.Decimal(parseFloat(amount)),
        description: name,
        cronExpression: cronExp,
        nextRun,
        isActive: true,
      },
      include: { category: true },
    });
  }

  @Get(['api/export/csv', 'analytics/export/csv'])
  async exportCsv(@Req() req: Request & { user: User }) {
    const user = req.user;

    const transactions = await this.prisma.transaction.findMany({
      where: { userId: user.id, isDeleted: false },
      include: { category: true },
      orderBy: { transactionDate: 'desc' },
    });

    let csv = 'Date,Merchant/Description,Category,Type,ParsedBy,Amount\n';
    transactions.forEach(t => {
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
