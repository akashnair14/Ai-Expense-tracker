import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { ParsedTransaction } from '../nlu/interfaces/nlu-parser.interface';
import { Prisma } from '@prisma/client';

@Injectable()
export class TransactionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  public async seedDefaultCategories(userId: string) {
    const defaults = [
      'Food', 'Groceries', 'Shopping', 'Transport', 'Fuel',
      'Bills', 'Rent', 'EMI', 'Entertainment', 'Travel',
      'Healthcare', 'Education', 'Investment', 'Insurance',
      'Salary', 'Freelance', 'Business', 'Gift', 'Others'
    ];

    try {
      await this.prisma.category.createMany({
        data: defaults.map(name => ({
          userId,
          name,
          type: ['Salary', 'Freelance', 'Business'].includes(name) ? ('INCOME' as const) : ('EXPENSE' as const),
          isSystem: true,
        })),
        skipDuplicates: true,
      });
    } catch (err) {
      // Ignored if categories created concurrently
    }
  }

  public async getOrCreateUser(telegramId: string | number, username?: string, firstName?: string, lastName?: string) {
    const stringId = String(telegramId);
    let user = await this.prisma.user.findUnique({
      where: { telegramId: stringId },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          telegramId: stringId,
          username: username || undefined,
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          currency: 'INR',
        },
      });

      await this.seedDefaultCategories(user.id);
    } else if ((firstName && user.firstName !== firstName) || (username && user.username !== username) || (lastName && user.lastName !== lastName)) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          firstName: firstName || user.firstName,
          lastName: lastName || user.lastName,
          username: username || user.username,
        },
      });
    }

    return user;
  }

  public async recordParsedTransaction(telegramId: string | number, parsed: ParsedTransaction) {
    const user = await this.getOrCreateUser(telegramId);

    // Resolve Category ID
    let category = await this.prisma.category.findFirst({
      where: {
        userId: user.id,
        name: { equals: parsed.category, mode: 'insensitive' },
      },
    });

    if (!category) {
      category = await this.prisma.category.create({
        data: {
          userId: user.id,
          name: parsed.category,
          type: parsed.type,
          isSystem: false,
        },
      });
    }

    const transaction = await this.prisma.transaction.create({
      data: {
        userId: user.id,
        categoryId: category.id,
        type: parsed.type,
        amount: new Prisma.Decimal(parsed.amount),
        originalAmount: parsed.originalAmount ? new Prisma.Decimal(parsed.originalAmount) : null,
        currency: parsed.currency,
        merchant: parsed.merchant,
        description: parsed.description,
        transactionDate: parsed.transactionDate,
        splitCount: parsed.splitCount,
        rawText: parsed.rawText,
        parsedBy: parsed.parsedBy,
      },
      include: { category: true },
    });

    // Check Budget Limit Trigger
    const budgetAlert = await this.checkBudgetAlert(user.id, category.id, parsed.amount);

    return { transaction, budgetAlert };
  }

  public async createManualTransaction(userIdentifier: string, payload: { type?: 'EXPENSE' | 'INCOME'; merchant?: string; amount: number; categoryName?: string }) {
    let user = await this.prisma.user.findFirst({
      where: { OR: [{ id: userIdentifier }, { telegramId: userIdentifier }] }
    });

    if (!user) {
      user = await this.getOrCreateUser(userIdentifier);
    }

    const categoryName = payload.categoryName || 'General';

    let category = await this.prisma.category.findFirst({
      where: { userId: user.id, name: { equals: categoryName, mode: 'insensitive' } },
    });

    if (!category) {
      category = await this.prisma.category.create({
        data: { name: categoryName, type: payload.type || 'EXPENSE', userId: user.id },
      });
    }

    const tx = await this.prisma.transaction.create({
      data: {
        userId: user.id,
        categoryId: category.id,
        type: payload.type || 'EXPENSE',
        amount: new Prisma.Decimal(payload.amount),
        merchant: payload.merchant,
        description: payload.merchant || 'Manual Transaction',
        rawText: `Manual entry: ${payload.merchant || ''} ${payload.amount}`,
        parsedBy: 'LLM',
      },
      include: { category: true },
    });

    const budgetAlert = await this.checkBudgetAlert(user.id, category.id, payload.amount);
    if (budgetAlert && (budgetAlert.usedPercentage >= 80 || budgetAlert.isExceeded)) {
      this.eventEmitter.emit('budget.alert', {
        telegramId: user.telegramId,
        currency: user.currency || '₹',
        ...budgetAlert,
      });
    }

    return tx;
  }

  public async setBudgetLimit(userIdentifier: string, categoryName: string, monthlyLimit: number) {
    let user = await this.prisma.user.findFirst({
      where: { OR: [{ id: userIdentifier }, { telegramId: userIdentifier }] }
    });

    if (!user) {
      user = await this.getOrCreateUser(userIdentifier);
    }
    let category = await this.prisma.category.findFirst({
      where: { userId: user.id, name: { equals: categoryName, mode: 'insensitive' } },
    });

    if (!category) {
      category = await this.prisma.category.create({
        data: { name: categoryName, userId: user.id },
      });
    }

    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    return this.prisma.budget.upsert({
      where: {
        userId_categoryId_month_year: {
          userId: user.id,
          categoryId: category.id,
          month,
          year,
        },
      },
      update: { monthlyLimit: new Prisma.Decimal(monthlyLimit) },
      create: {
        userId: user.id,
        categoryId: category.id,
        month,
        year,
        monthlyLimit: new Prisma.Decimal(monthlyLimit),
      },
    });
  }

  public async checkBudgetAlert(userId: string, categoryId: string, addedAmount: number) {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const budget = await this.prisma.budget.findUnique({
      where: {
        userId_categoryId_month_year: {
          userId,
          categoryId,
          month,
          year,
        },
      },
      include: { category: true },
    });

    if (!budget) return null;

    // Calculate total spend this month for this category
    const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59));

    const aggregate = await this.prisma.transaction.aggregate({
      where: {
        userId,
        categoryId,
        isDeleted: false,
        type: 'EXPENSE',
        transactionDate: { gte: startOfMonth, lte: endOfMonth },
      },
      _sum: { amount: true },
    });

    const currentSpent = aggregate._sum.amount ? Number(aggregate._sum.amount) : 0;
    const limitNum = Number(budget.monthlyLimit);
    const usedPercentage = limitNum > 0 ? (currentSpent / limitNum) * 100 : 0;

    // Predictive Run-Rate & Month-End Pace Warning Calculation
    const totalDaysInMonth = new Date(year, month, 0).getDate();
    const currentDay = now.getDate();
    const expectedPacePercentage = (currentDay / totalDaysInMonth) * 100;
    
    // Flag if burn pace is more than 20% ahead of calendar schedule
    const isOverPaced = usedPercentage > (expectedPacePercentage + 20) && currentSpent < limitNum;
    const projectedMonthEndSpend = Math.round((currentSpent / currentDay) * totalDaysInMonth);
    const projectedOverage = projectedMonthEndSpend - limitNum;

    return {
      categoryName: budget.category.name,
      monthlyLimit: limitNum,
      currentSpent,
      remaining: limitNum - currentSpent,
      usedPercentage: Math.round(usedPercentage),
      isExceeded: currentSpent > limitNum,
      isOverPaced,
      currentDay,
      totalDaysInMonth,
      projectedMonthEndSpend,
      projectedOverage,
    };
  }

  public async deleteLastTransaction(telegramId: string | number) {
    const user = await this.getOrCreateUser(telegramId);
    const lastTx = await this.prisma.transaction.findFirst({
      where: { userId: user.id, isDeleted: false },
      orderBy: { createdAt: 'desc' },
    });

    if (!lastTx) return null;

    return this.prisma.transaction.update({
      where: { id: lastTx.id },
      data: { isDeleted: true },
    });
  }

  public async restoreLastTransaction(telegramId: string | number) {
    const user = await this.getOrCreateUser(telegramId);
    const deletedTx = await this.prisma.transaction.findFirst({
      where: { userId: user.id, isDeleted: true },
      orderBy: { updatedAt: 'desc' },
    });

    if (!deletedTx) return null;

    return this.prisma.transaction.update({
      where: { id: deletedTx.id },
      data: { isDeleted: false },
    });
  }
}
