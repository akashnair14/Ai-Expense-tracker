import { Injectable, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { ParsedTransaction } from '../nlu/interfaces/nlu-parser.interface';
import { Prisma } from '@prisma/client';
import {
  CreateManualTransactionSchema,
  CreateManualTransactionDto,
  SetBudgetSchema,
  FinancialAmountSchema,
  TransactionCategorySchema,
} from '../common/validation/schemas';
import { AuditService } from '../common/audit/audit.service';
import { ForexService } from '../common/forex/forex.service';

@Injectable()
export class TransactionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly auditService: AuditService,
    private readonly forexService: ForexService,
  ) {}

  
  
  public async updateTransactionDetails(
    userId: string,
    txId: string,
    data: {
      amount?: number;
      merchant?: string;
      description?: string;
      categoryName?: string;
      type?: 'EXPENSE' | 'INCOME';
      transactionDate?: Date | string;
    },
  ) {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ id: userId }, { telegramId: userId }] },
    });
    if (!user) throw new BadRequestException('User not found');

    const existingTx = await this.prisma.transaction.findFirst({
      where: { id: txId, userId: user.id, isDeleted: false },
    });
    if (!existingTx) throw new BadRequestException('Transaction not found');

    let categoryId = existingTx.categoryId;
    if (data.categoryName) {
      let category = await this.prisma.category.findFirst({
        where: {
          userId: user.id,
          name: { equals: data.categoryName, mode: 'insensitive' },
        },
      });
      if (!category) {
        category = await this.prisma.category.create({
          data: {
            userId: user.id,
            name: data.categoryName,
            type: data.type || existingTx.type,
          },
        });
      }
      categoryId = category.id;
    }

    const updateData: any = {};
    if (data.amount !== undefined && !isNaN(data.amount)) updateData.amount = new Prisma.Decimal(data.amount);
    if (data.merchant !== undefined) updateData.merchant = data.merchant;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.type) updateData.type = data.type;
    if (categoryId) updateData.categoryId = categoryId;
    if (data.transactionDate) updateData.transactionDate = new Date(data.transactionDate);

    const updated = await this.prisma.transaction.update({
      where: { id: txId },
      data: updateData,
      include: { category: true },
    });

    await this.auditService.log({
      userId: user.id,
      action: 'TRANSACTION_UPDATED',
      entityType: 'TRANSACTION',
      entityId: txId,
      source: 'WEB',
      details: { updatedFields: Object.keys(updateData) },
    });

    return updated;
  }

  public async updateTransactionCategory(
    userId: string,
    txId: string,
    categoryName: string,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ id: userId }, { telegramId: userId }] },
    });
    if (!user) return null;

    let category = await this.prisma.category.findFirst({
      where: {
        userId: user.id,
        name: { equals: categoryName, mode: 'insensitive' },
      },
    });

    if (!category) {
      category = await this.prisma.category.create({
        data: {
          userId: user.id,
          name: categoryName,
          type: 'EXPENSE',
          isSystem: false,
        },
      });
    }

    const updated = await this.prisma.transaction.update({
      where: { id: txId },
      data: { categoryId: category.id },
      include: { category: true },
    });

    await this.auditService.log({
      userId: user.id,
      action: 'TRANSACTION_UPDATED',
      entityType: 'TRANSACTION',
      entityId: txId,
      source: 'TELEGRAM',
      details: { newCategory: categoryName },
    });

    return updated;
  }

  public async seedDefaultCategories(userId: string) {
    const defaults = [
      'Food',
      'Groceries',
      'Shopping',
      'Transport',
      'Fuel',
      'Bills',
      'Rent',
      'EMI',
      'Entertainment',
      'Travel',
      'Healthcare',
      'Education',
      'Investment',
      'Insurance',
      'Salary',
      'Freelance',
      'Business',
      'Gift',
      'Others',
    ];

    try {
      await this.prisma.category.createMany({
        data: defaults.map((name) => ({
          userId,
          name,
          type: ['Salary', 'Freelance', 'Business'].includes(name)
            ? ('INCOME' as const)
            : ('EXPENSE' as const),
          isSystem: true,
        })),
        skipDuplicates: true,
      });
    } catch {
      // Ignored if categories created concurrently
    }
  }

  public async seedDemoTransactions(userId: string) {
    // Completely disabled to prevent confusing users with fake data
    return;
  }

  public async getOrCreateUser(
    telegramId: string | number,
    username?: string,
    firstName?: string,
    lastName?: string,
  ) {
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
    } else if (
      (firstName && user.firstName !== firstName) ||
      (username && user.username !== username) ||
      (lastName && user.lastName !== lastName)
    ) {
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

  public async recordParsedTransaction(
    telegramId: string | number,
    parsed: ParsedTransaction,
  ) {
    if (!telegramId) {
      throw new BadRequestException('User identifier is required');
    }

    const validatedAmountResult = FinancialAmountSchema.safeParse(
      parsed.amount,
    );
    if (!validatedAmountResult.success) {
      throw new BadRequestException(
        `Invalid transaction amount: ${parsed.amount}`,
      );
    }

    const validatedCategoryResult = TransactionCategorySchema.safeParse(
      parsed.category,
    );
    const categoryName = validatedCategoryResult.success
      ? validatedCategoryResult.data
      : 'Others';

    const user = await this.getOrCreateUser(telegramId);

    // Resolve Category ID
    let category = await this.prisma.category.findFirst({
      where: {
        userId: user.id,
        name: { equals: categoryName, mode: 'insensitive' },
      },
    });

    if (!category) {
      category = await this.prisma.category.create({
        data: {
          userId: user.id,
          name: categoryName,
          type: parsed.type,
          isSystem: false,
        },
      });
    }

    let cleanAmount = validatedAmountResult.data;
    let cleanOriginalAmount =
      parsed.originalAmount &&
      FinancialAmountSchema.safeParse(parsed.originalAmount).success
        ? FinancialAmountSchema.parse(parsed.originalAmount)
        : null;

    // Smart Multi-Currency Auto Forex Conversion
    if (parsed.currency && user.currency && parsed.currency.toUpperCase() !== user.currency.toUpperCase()) {
      const conversion = await this.forexService.convert(cleanAmount, parsed.currency, user.currency);
      cleanOriginalAmount = cleanAmount;
      cleanAmount = conversion.convertedAmount;
    }
    

    const transaction = await this.prisma.transaction.create({
      data: {
        userId: user.id,
        categoryId: category.id,
        type: parsed.type,
        amount: new Prisma.Decimal(cleanAmount),
        originalAmount: cleanOriginalAmount
          ? new Prisma.Decimal(cleanOriginalAmount)
          : null,
        currency: parsed.currency || user.currency || 'INR',
        merchant: parsed.merchant || null,
        description: parsed.description || null,
        transactionDate: parsed.transactionDate || new Date(),
        splitCount:
          parsed.splitCount && parsed.splitCount >= 1 ? parsed.splitCount : 1,
        rawText:
          parsed.rawText || `Transaction: ${categoryName} ${cleanAmount}`,
        parsedBy: parsed.parsedBy || 'REGEX',
      },
      include: { category: true },
    });

    await this.auditService.log({
      userId: user.id,
      action: 'TRANSACTION_CREATED',
      entityType: 'TRANSACTION',
      entityId: transaction.id,
      source: 'TELEGRAM',
      details: {
        amount: cleanAmount,
        type: parsed.type,
        category: categoryName,
        merchant: parsed.merchant,
        parsedBy: parsed.parsedBy,
      },
    });

    // Check Budget Limit Trigger
    const budgetAlert = await this.checkBudgetAlert(
      user.id,
      category.id,
      cleanAmount,
    );

    return { transaction, budgetAlert };
  }

  public async createManualTransaction(
    userIdentifier: string,
    payload:
      | CreateManualTransactionDto
      | {
          type?: 'EXPENSE' | 'INCOME';
          merchant?: string | null;
          amount: number;
          categoryName?: string;
          description?: string | null;
          originalAmount?: number | null;
          transactionDate?: Date;
          currency?: string;
          splitCount?: number;
        },
  ) {
    if (!userIdentifier) {
      throw new BadRequestException('User identifier is required');
    }

    const validation = CreateManualTransactionSchema.safeParse(payload);
    if (!validation.success) {
      const errorMsg = validation.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join(', ');
      throw new BadRequestException(`Invalid transaction payload: ${errorMsg}`);
    }

    const cleanPayload = validation.data;

    let user = await this.prisma.user.findFirst({
      where: { OR: [{ id: userIdentifier }, { telegramId: userIdentifier }] },
    });

    if (!user) {
      user = await this.getOrCreateUser(userIdentifier);
    }

    const categoryName = cleanPayload.categoryName || 'General';

    let category = await this.prisma.category.findFirst({
      where: {
        userId: user.id,
        name: { equals: categoryName, mode: 'insensitive' },
      },
    });

    if (!category) {
      category = await this.prisma.category.create({
        data: {
          name: categoryName,
          type: cleanPayload.type || 'EXPENSE',
          userId: user.id,
        },
      });
    }

    const tx = await this.prisma.transaction.create({
      data: {
        userId: user.id,
        categoryId: category.id,
        type: cleanPayload.type || 'EXPENSE',
        amount: new Prisma.Decimal(cleanPayload.amount),
        merchant: cleanPayload.merchant,
        description: cleanPayload.merchant || 'Manual Transaction',
        rawText: `Manual entry: ${cleanPayload.merchant || ''} ${cleanPayload.amount}`,
        parsedBy: 'LLM',
      },
      include: { category: true },
    });

    await this.auditService.log({
      userId: user.id,
      action: 'TRANSACTION_CREATED',
      entityType: 'TRANSACTION',
      entityId: tx.id,
      source: 'WEB',
      details: {
        amount: cleanPayload.amount,
        type: cleanPayload.type || 'EXPENSE',
        category: categoryName,
        merchant: cleanPayload.merchant,
      },
    });

    const budgetAlert = await this.checkBudgetAlert(
      user.id,
      category.id,
      cleanPayload.amount,
    );
    if (
      budgetAlert &&
      (budgetAlert.usedPercentage >= 80 || budgetAlert.isExceeded)
    ) {
      this.eventEmitter.emit('budget.alert', {
        telegramId: user.telegramId,
        currency: user.currency || '₹',
        ...budgetAlert,
      });
    }

    return tx;
  }

  public async setBudgetLimit(
    userIdentifier: string,
    categoryName: string,
    monthlyLimit: number,
  ) {
    if (!userIdentifier) {
      throw new BadRequestException('User identifier is required');
    }

    const validation = SetBudgetSchema.safeParse({
      categoryName,
      monthlyLimit,
    });
    if (!validation.success) {
      const errorMsg = validation.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join(', ');
      throw new BadRequestException(
        `Invalid budget configuration: ${errorMsg}`,
      );
    }

    const cleanCategory = validation.data.categoryName;
    const cleanLimit = validation.data.monthlyLimit;

    let user = await this.prisma.user.findFirst({
      where: { OR: [{ id: userIdentifier }, { telegramId: userIdentifier }] },
    });

    if (!user) {
      user = await this.getOrCreateUser(userIdentifier);
    }
    let category = await this.prisma.category.findFirst({
      where: {
        userId: user.id,
        name: { equals: cleanCategory, mode: 'insensitive' },
      },
    });

    if (!category) {
      category = await this.prisma.category.create({
        data: { name: cleanCategory, userId: user.id },
      });
    }

    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const budget = await this.prisma.budget.upsert({
      where: {
        userId_categoryId_month_year: {
          userId: user.id,
          categoryId: category.id,
          month,
          year,
        },
      },
      update: { monthlyLimit: new Prisma.Decimal(cleanLimit) },
      create: {
        userId: user.id,
        categoryId: category.id,
        month,
        year,
        monthlyLimit: new Prisma.Decimal(cleanLimit),
      },
    });

    await this.auditService.log({
      userId: user.id,
      action: 'BUDGET_SET',
      entityType: 'BUDGET',
      entityId: budget.id,
      source: 'SYSTEM',
      details: {
        categoryName: cleanCategory,
        monthlyLimit: cleanLimit,
        month,
        year,
      },
    });

    return budget;
  }

  public async checkBudgetAlert(
    userId: string,
    categoryId: string,
    _addedAmount?: number,
  ) {
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

    const currentSpent = aggregate._sum.amount
      ? Number(aggregate._sum.amount)
      : 0;
    const limitNum = Number(budget.monthlyLimit);
    const usedPercentage = limitNum > 0 ? (currentSpent / limitNum) * 100 : 0;

    // Predictive Run-Rate & Month-End Pace Warning Calculation
    const totalDaysInMonth = new Date(year, month, 0).getDate();
    const currentDay = now.getDate();
    const expectedPacePercentage = (currentDay / totalDaysInMonth) * 100;

    // Flag if burn pace is more than 20% ahead of calendar schedule
    const isOverPaced =
      usedPercentage > expectedPacePercentage + 20 && currentSpent < limitNum;
    const projectedMonthEndSpend = Math.round(
      (currentSpent / currentDay) * totalDaysInMonth,
    );
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

    const updated = await this.prisma.transaction.update({
      where: { id: lastTx.id },
      data: { isDeleted: true },
    });

    await this.auditService.log({
      userId: user.id,
      action: 'TRANSACTION_DELETED',
      entityType: 'TRANSACTION',
      entityId: lastTx.id,
      source: 'TELEGRAM',
      details: {
        amount: Number(lastTx.amount),
        type: lastTx.type,
        merchant: lastTx.merchant,
      },
    });

    return updated;
  }

  public async restoreLastTransaction(telegramId: string | number) {
    const user = await this.getOrCreateUser(telegramId);
    const deletedTx = await this.prisma.transaction.findFirst({
      where: { userId: user.id, isDeleted: true },
      orderBy: { updatedAt: 'desc' },
    });

    if (!deletedTx) return null;

    const updated = await this.prisma.transaction.update({
      where: { id: deletedTx.id },
      data: { isDeleted: false },
    });

    await this.auditService.log({
      userId: user.id,
      action: 'TRANSACTION_UPDATED',
      entityType: 'TRANSACTION',
      entityId: deletedTx.id,
      source: 'TELEGRAM',
      details: {
        action: 'RESTORE_TRANSACTION',
        amount: Number(deletedTx.amount),
      },
    });

    return updated;
  }
}
