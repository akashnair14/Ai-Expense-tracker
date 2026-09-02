import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateGroupExpenseInput {
  chatId: string;
  paidByUserId: string;
  totalAmount: number;
  currency?: string;
  description: string;
  members: string[]; // array of usernames e.g. ["@alice", "@bob", "Self"]
}

export interface GroupBalanceSummary {
  chatId: string;
  balances: Array<{
    userName: string;
    netBalance: number; // positive = should receive, negative = owes
  }>;
  unsettledExpensesCount: number;
}

@Injectable()
export class GroupSplitService {
  private readonly logger = new Logger(GroupSplitService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createGroupExpense(input: CreateGroupExpenseInput) {
    const { chatId, paidByUserId, totalAmount, currency = 'INR', description, members } = input;
    const splitCount = Math.max(1, members.length);
    const amountPerPerson = Number((totalAmount / splitCount).toFixed(2));

    const expense = await this.prisma.groupExpense.create({
      data: {
        chatId: String(chatId),
        paidByUserId,
        totalAmount,
        currency,
        description,
        splitCount,
        splits: {
          create: members.map((member) => ({
            userName: member.trim(),
            amountOwed: amountPerPerson,
            isPaid: member.toLowerCase() === 'self' || member.toLowerCase() === 'me',
            paidAt: member.toLowerCase() === 'self' || member.toLowerCase() === 'me' ? new Date() : null,
          })),
        },
      },
      include: {
        splits: true,
        paidBy: true,
      },
    });

    this.logger.log(`Recorded group expense "${description}" (${currency} ${totalAmount}) in chat ${chatId}`);
    return expense;
  }

  async getGroupBalances(chatId: string): Promise<GroupBalanceSummary> {
    const unsettledExpenses = await this.prisma.groupExpense.findMany({
      where: {
        chatId: String(chatId),
        isSettled: false,
      },
      include: {
        splits: true,
        paidBy: true,
      },
    });

    const balanceMap: Record<string, number> = {};

    for (const exp of unsettledExpenses) {
      const payerName = exp.paidBy.firstName || exp.paidBy.username || 'Payer';
      const totalAmt = Number(exp.totalAmount);
      
      // Payer initially gets credit for total paid
      balanceMap[payerName] = (balanceMap[payerName] || 0) + totalAmt;

      for (const split of exp.splits) {
        const debtor = split.userName;
        const owed = Number(split.amountOwed);
        balanceMap[debtor] = (balanceMap[debtor] || 0) - owed;
      }
    }

    const balances = Object.entries(balanceMap).map(([userName, netBalance]) => ({
      userName,
      netBalance: Number(netBalance.toFixed(2)),
    }));

    return {
      chatId: String(chatId),
      balances,
      unsettledExpensesCount: unsettledExpenses.length,
    };
  }

  async settleGroupExpenses(chatId: string) {
    const result = await this.prisma.groupExpense.updateMany({
      where: {
        chatId: String(chatId),
        isSettled: false,
      },
      data: {
        isSettled: true,
      },
    });

    await this.prisma.groupSplit.updateMany({
      where: {
        groupExpense: {
          chatId: String(chatId),
        },
        isPaid: false,
      },
      data: {
        isPaid: true,
        paidAt: new Date(),
      },
    });

    return { settledCount: result.count };
  }
}
