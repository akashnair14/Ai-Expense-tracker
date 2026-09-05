import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
  Res,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionService } from '../transactions/transaction.service';
import { NluService } from '../nlu/nlu.service';
import { LlmIntentAdapter } from '../nlu/adapters/llm-intent.adapter';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { Prisma, User } from '@prisma/client';
import {
  CreateManualTransactionSchema,
  SetBudgetSchema,
  CreateRecurringSchema,
} from '../common/validation/schemas';
import { AuditService } from '../common/audit/audit.service';
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
} from 'date-fns';

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
      return { reply: 'Please provide a message, expense description, or financial question.' };
    }

    const trimmedMsg = message.trim();
    const lower = trimmedMsg.toLowerCase();

    // 1. Assign demo user if unauthenticated guest
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

    const curr = user.currency === 'USD' ? '$' : user.currency === 'EUR' ? '€' : user.currency === 'GBP' ? '£' : user.currency === 'AED' ? 'AED ' : '₹';

    // 2. Intelligent Contextual Financial Inquiries & Ledger Operations

    // 2-ZERO: Clear demo data / Reset account
    if (
      lower.includes('clear demo') ||
      lower.includes('reset data') ||
      lower.includes('delete demo') ||
      lower.includes('clear all data') ||
      lower.includes('reset ledger')
    ) {
      await this.prisma.transaction.updateMany({
        where: { userId: user.id, isDeleted: false },
        data: { isDeleted: true },
      });
      return {
        reply: `All sample demo transactions have been cleared from your ledger! You now have a fresh account with **${curr}0** recorded expenses.`,
        transactions: [],
      };
    }

    // 2-DISPUTE: Handling user disputes, disavowals, and transaction deletions (e.g. "how ? i havent filled petrol from shell anyyime", "i havnt filled petro; from shell")
    const cleanLower = lower.replace(/[;:,._!?-]/g, ' ');
    const isDisputeOrNegation =
      cleanLower.includes("haven't") || cleanLower.includes("havent") || cleanLower.includes("havnt") ||
      cleanLower.includes("didn't") || cleanLower.includes("didnt") || cleanLower.includes("dint") ||
      cleanLower.includes("never") || cleanLower.includes("not filled") || cleanLower.includes("not bought") ||
      cleanLower.includes("not paid") || cleanLower.includes("not me") || cleanLower.includes("not ") ||
      cleanLower.includes("wrong") || cleanLower.includes("fake") || cleanLower.includes("delete") ||
      cleanLower.includes("remove") ||
      (cleanLower.includes("how") && (cleanLower.includes("haven") || cleanLower.includes("havn") || cleanLower.includes("didn") || cleanLower.includes("why") || cleanLower.includes("shell")));

    if (isDisputeOrNegation) {
      const candidateTerms = [
        'shell', 'petrol', 'petro', 'fuel', 'uber', 'swiggy', 'barbeque', 'blinkit',
        'zara', 'netflix', 'airtel', 'coffee', 'dining', 'groceries', 'transport'
      ];
      const matchedTerms = candidateTerms.filter(t => cleanLower.includes(t));

      let disputedTxs: any[] = [];
      if (matchedTerms.length > 0) {
        disputedTxs = await this.prisma.transaction.findMany({
          where: {
            userId: user.id,
            isDeleted: false,
            OR: [
              ...matchedTerms.map(t => ({ merchant: { contains: t, mode: 'insensitive' as const } })),
              ...matchedTerms.map(t => ({ description: { contains: t, mode: 'insensitive' as const } })),
              ...matchedTerms.map(t => ({ category: { name: { contains: t, mode: 'insensitive' as const } } })),
            ],
          },
          orderBy: { createdAt: 'desc' },
          include: { category: true },
        });
      }

      if (disputedTxs.length > 0) {
        const txIds = disputedTxs.map(t => t.id);
        await this.prisma.transaction.updateMany({
          where: { id: { in: txIds }, userId: user.id },
          data: { isDeleted: true },
        });

        const targetTx = disputedTxs[0];
        const merchantName = targetTx.merchant || targetTx.description || 'entry';
        const amtStr = `${curr}${Number(targetTx.amount).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

        return {
          reply: `Understood! That **${amtStr}** for **${merchantName}** was a sample demo transaction preloaded in sandbox mode.\n\nSince you didn't make this purchase, I have removed it from your ledger. Your spending is now updated to **${curr}0**.`,
          transaction: targetTx,
          transactions: disputedTxs,
        };
      }

      if (lower.includes('petrol') || lower.includes('shell') || lower.includes('fuel')) {
        return {
          reply: `No worries! You have **${curr}0** recorded petrol expenses in your ledger now. Any sample demo entries for Shell Petrol Station have been removed.`,
          transactions: [],
        };
      }

      if (lower.includes('how') || lower.includes('why')) {
        return {
          reply: `In demo mode, sample transactions are preloaded so you can explore charts and features. You can delete any transaction anytime by asking me to delete it, or say "clear demo data" to wipe all sample entries.`,
        };
      }
    }

    // 2-RAG: Advanced Financial RAG Engine (MoM Comparisons, Subscription Audits, Affordability Simulations, Leakage Detection, Runway Forecasting)
    const isRagQuery =
      lower.includes('compare') ||
      lower.includes('vs last') ||
      lower.includes('versus') ||
      lower.includes('last month') ||
      lower.includes('subscription') ||
      lower.includes('recurring') ||
      lower.includes('membership') ||
      lower.includes('afford') ||
      lower.includes('should i buy') ||
      lower.includes('what if') ||
      lower.includes('leak') ||
      lower.includes('waste') ||
      lower.includes('cut down') ||
      lower.includes('save money') ||
      lower.includes('forecast') ||
      lower.includes('project') ||
      lower.includes('runway') ||
      lower.includes('trajectory') ||
      lower.includes('audit');

    if (isRagQuery) {
      const ragAnalysis = await this.analyticsService.performFinancialRagAnalysis(
        user.id,
        trimmedMsg,
      );
      return {
        reply: ragAnalysis.reply,
        financialContext: ragAnalysis.data,
      };
    }

    // 2A. Safe daily spend & discretionary allowance
    if (lower.includes('safe') || lower.includes('daily') || lower.includes('can i spend') || lower.includes('allowance')) {
      const daily = await this.analyticsService.calculateDailyDiscretionaryLimit(user.id);
      const amtMatch = trimmedMsg.match(/(\d+)/);

      let reply = '';
      if (daily.needsIncomeConfig) {
        reply = `You haven't set a baseline monthly income yet. Once you configure your monthly income in Settings or record income (e.g. "Salary 65000"), I'll track your safe daily discretionary limit.\n\nIn the meantime, feel free to log expenses or ask "How much on food?".`;
      } else if (amtMatch) {
        const proposedAmt = parseFloat(amtMatch[1]);
        if (proposedAmt <= daily.recommendedDailyLimit) {
          reply = `Yes, you can! Your safe daily spend is **${curr}${daily.recommendedDailyLimit.toLocaleString()}**, so spending **${curr}${proposedAmt.toLocaleString()}** is well within your budget today.\n\nYou have **${daily.daysRemaining} days** remaining in this month.`;
        } else {
          const over = proposedAmt - daily.recommendedDailyLimit;
          reply = `**${curr}${proposedAmt.toLocaleString()}** is slightly above your daily limit of **${curr}${daily.recommendedDailyLimit.toLocaleString()}** (by ${curr}${over.toLocaleString()}).\n\nYou can still spend it, but try to keep spending low tomorrow to stay on track for the remaining **${daily.daysRemaining} days**!`;
        }
      } else {
        reply = `Your safe daily spend is **${curr}${daily.recommendedDailyLimit.toLocaleString()}/day** for the rest of this month (${daily.daysRemaining} days left).\n\nAs long as you stay within this daily amount, you'll hit your monthly savings target!`;
      }

      return {
        reply,
        financialContext: { recommendedDailyLimit: daily.recommendedDailyLimit, daysRemaining: daily.daysRemaining, needsIncomeConfig: daily.needsIncomeConfig }
      };
    }

    // 2B. Top / Largest expenses
    if (lower.includes('top') || lower.includes('largest') || lower.includes('biggest') || lower.includes('highest')) {
      const topTxs = await this.prisma.transaction.findMany({
        where: { userId: user.id, isDeleted: false, type: 'EXPENSE' },
        orderBy: { amount: 'desc' },
        take: 4,
        include: { category: true }
      });

      if (topTxs.length === 0) {
        return { reply: "You don't have any expenses recorded yet for this month." };
      }

      const listStr = topTxs.map(t =>
        `• **${t.merchant || t.description}**: ${curr}${Number(t.amount).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} (${t.category?.name || 'General'})`
      ).join('\n');

      return {
        reply: `Here are your biggest expenses this month:\n\n${listStr}`,
        transactions: topTxs
      };
    }

    // 2C. Monthly Cash Flow & Net Savings
    if (lower.includes('saving') || lower.includes('net') || lower.includes('burn rate') || lower.includes('income') || lower.includes('cash flow')) {
      const summary = await this.analyticsService.getSummaryReport(user.id, 'month');
      const savingsRate = summary.totalIncome > 0 ? Math.round((summary.netSavings / summary.totalIncome) * 100) : 0;
      return {
        reply: `Here is your summary for this month:\n\n• Income: **${curr}${summary.totalIncome.toLocaleString()}**\n• Total spent: **${curr}${summary.totalExpense.toLocaleString()}**\n• Savings left: **${curr}${summary.netSavings.toLocaleString()}** (${savingsRate}% saved)\n\nYou've recorded **${summary.transactionCount} transactions** so far.`,
        financialContext: summary
      };
    }

    // 2D. Overall Total Spend Queries
    if (lower.includes('total spend') || lower.includes('total expense') || lower.includes('total outflow') || (lower.includes('how much') && (lower.includes('overall') || lower.includes('total')))) {
      const summary = await this.analyticsService.getSummaryReport(user.id, 'month');
      return {
        reply: `You've spent a total of **${curr}${summary.totalExpense.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}** across ${summary.transactionCount} transactions this month.`,
        financialContext: summary,
      };
    }

    // 2E. Typo-Tolerant Category & Merchant Spending Inquiries (e.g. "how much i sent on petrol?", "how much did i spend on groceries?")
    const detectSpendingInquiry = (msg: string) => {
      const mLower = msg.toLowerCase().trim();

      let period: 'today' | 'week' | 'month' | 'year' = 'month';
      if (mLower.includes('today')) period = 'today';
      else if (mLower.includes('this week') || mLower.includes('last week')) period = 'week';
      else if (mLower.includes('this year') || mLower.includes('last year')) period = 'year';

      const DOMAINS: Array<{
        keywords: string[];
        categories: string[];
        displayName: string;
        emoji: string;
      }> = [
        {
          keywords: ['petrol', 'fuel', 'diesel', 'gas', 'cng', 'shell', 'hpcl', 'bpcl', 'iocl', 'gasoline'],
          categories: ['Fuel', 'Petrol', 'Travel & Fuel', 'Transport'],
          displayName: 'Petrol',
          emoji: '⛽',
        },
        {
          keywords: ['uber', 'ola', 'rapido', 'cab', 'taxi', 'auto', 'metro', 'bus', 'train', 'commute', 'transport', 'flight', 'travel'],
          categories: ['Transport', 'Travel', 'Travel & Fuel'],
          displayName: 'Travel & Transport',
          emoji: '🚕',
        },
        {
          keywords: ['food', 'dining', 'restaurant', 'swiggy', 'zomato', 'lunch', 'dinner', 'breakfast', 'cafe', 'coffee', 'starbucks', 'eat', 'burger', 'pizza', 'biryani'],
          categories: ['Food', 'Food & Dining'],
          displayName: 'Food & Dining',
          emoji: '🍔',
        },
        {
          keywords: ['grocery', 'groceries', 'blinkit', 'zepto', 'instamart', 'bigbasket', 'supermarket', 'mart', 'vegetables', 'fruits', 'milk', 'provisions'],
          categories: ['Groceries'],
          displayName: 'Groceries',
          emoji: '🛒',
        },
        {
          keywords: ['shopping', 'amazon', 'flipkart', 'myntra', 'clothes', 'shoes', 'electronics', 'mall', 'zara', 'nike', 'h&m'],
          categories: ['Shopping'],
          displayName: 'Shopping',
          emoji: '🛍️',
        },
        {
          keywords: ['bill', 'bills', 'electricity', 'water', 'wifi', 'internet', 'broadband', 'recharge', 'mobile', 'utility', 'utilities', 'jio', 'airtel', 'subscription', 'netflix'],
          categories: ['Bills', 'Bills & Utilities'],
          displayName: 'Bills & Utilities',
          emoji: '⚡',
        },
        {
          keywords: ['rent', 'house rent', 'flat rent', 'apartment'],
          categories: ['Rent'],
          displayName: 'Rent',
          emoji: '🏠',
        },
        {
          keywords: ['emi', 'loan', 'car loan', 'home loan'],
          categories: ['EMI'],
          displayName: 'EMI & Loans',
          emoji: '💳',
        },
        {
          keywords: ['movie', 'movies', 'cinema', 'spotify', 'prime', 'youtube', 'gaming', 'concert', 'entertainment', 'bookmyshow'],
          categories: ['Entertainment'],
          displayName: 'Entertainment',
          emoji: '🎬',
        },
        {
          keywords: ['health', 'healthcare', 'pharmacy', 'medicine', 'medicines', 'doctor', 'hospital', 'clinic', 'gym', 'apollo'],
          categories: ['Healthcare'],
          displayName: 'Healthcare',
          emoji: '💊',
        },
        {
          keywords: ['invest', 'investment', 'stocks', 'mutual fund', 'sip', 'crypto', 'zerodha', 'groww'],
          categories: ['Investment'],
          displayName: 'Investments',
          emoji: '📈',
        },
        {
          keywords: ['salary', 'paycheck', 'payroll', 'wages'],
          categories: ['Salary'],
          displayName: 'Salary',
          emoji: '💼',
        },
      ];

      // If the message is a dispute, negation, deletion, or questioning origin, do NOT treat as spending inquiry
      if (
        mLower.includes("haven't") || mLower.includes("havent") ||
        mLower.includes("didn't") || mLower.includes("didnt") ||
        mLower.includes("never") || mLower.includes("not ") ||
        mLower.includes("delete") || mLower.includes("remove") ||
        mLower.includes("how ?") || mLower.includes("how?") ||
        mLower.includes("why") || mLower.includes("clear")
      ) {
        return null;
      }

      // 1. Semantic inquiry indicator check (e.g. "how much is my petrol spent?", "food spending", "what did I spend on uber?")
      const inquiryIndicators = [
        'how much', 'what is', 'what did', 'what was', "what's",
        'tell me', 'show me', 'check', 'get', 'spending', 'spent',
        'spend', 'sent', 'cost', 'costs', 'expense', 'expenses',
        'outlay', 'burn', 'bill', 'total'
      ];
      const isAskingSpending = inquiryIndicators.some(ind => mLower.includes(ind));

      if (isAskingSpending) {
        for (const d of DOMAINS) {
          const matchedKw = d.keywords.find(k => {
            const regex = new RegExp(`\\b${k}\\b`, 'i');
            return regex.test(mLower);
          });
          if (matchedKw) {
            return {
              entity: matchedKw,
              candidateCategories: d.categories,
              displayName: d.displayName,
              emoji: d.emoji,
              period,
            };
          }
        }
      }

      // 2. Question regex patterns (forgiving typos like "sent" for "spent", entity before verb, etc.)
      const patterns = [
        /(?:how much|what|tell me|show me)?\s*(?:did|do|have|was|is)?\s*(?:i|we|my)?\s*([a-zA-Z0-9\s&'-]+?)\s+(?:spent|spend|sent|send|cost|costs|expense|expenses|outlay|spends?)\??$/i,
        /(?:how much|what|tell me|show me)?\s*(?:did|do|have|was|is)?\s*(?:i|we|my)?\s*(?:spent|spend|sent|send|pay|paid|cost|burn|burned|used|outlay)\s*(?:on|for|in|towards)\s+([a-zA-Z0-9\s&'-]+?)(?:\s+(?:this|last)\s+(?:month|week|year|cycle|today))?\??$/i,
        /(?:how much|what)\s+(?:did\s+)?(?:i|we)?\s*(?:spent|spend|sent|send|pay|paid)\s+([a-zA-Z0-9\s&'-]+?)(?:\s+(?:this|last)\s+(?:month|week|year|cycle|today))?\??$/i,
        /(?:spending|expenses?|cost|outlays?)\s+(?:on|for|in)\s+([a-zA-Z0-9\s&'-]+?)(?:\s+(?:this|last)\s+(?:month|week|year|cycle|today))?\??$/i,
        /^([a-zA-Z0-9\s&'-]+?)\s+(?:spending|expenses?|cost|outlays?|spends?)\??$/i,
        /^(?:how much|what)\s+(?:on|for)\s+([a-zA-Z0-9\s&'-]+?)\??$/i,
        /^(?:check|show|get)\s+([a-zA-Z0-9\s&'-]+?)\s+(?:spending|expenses?|cost)\??$/i,
      ];

      let extractedEntity: string | null = null;
      for (const pat of patterns) {
        const m = msg.match(pat);
        if (m && m[1]) {
          const ent = m[1].trim().toLowerCase();
          if (!['money', 'total', 'everything', 'all'].includes(ent)) {
            extractedEntity = ent;
            break;
          }
        }
      }

      if (extractedEntity) {
        for (const d of DOMAINS) {
          if (d.keywords.some(k => extractedEntity!.includes(k) || k.includes(extractedEntity!))) {
            return {
              entity: extractedEntity,
              candidateCategories: d.categories,
              displayName: d.displayName,
              emoji: d.emoji,
              period,
            };
          }
        }

        return {
          entity: extractedEntity,
          candidateCategories: [extractedEntity],
          displayName: extractedEntity.charAt(0).toUpperCase() + extractedEntity.slice(1),
          emoji: '🏷️',
          period,
        };
      }

      // Direct quick prompts (e.g. clicking chip or short direct inquiry words)
      const directPhrases = [
        'petrol', 'petrol & fuel', 'fuel', 'food', 'food spending',
        'food & dining', 'groceries', 'shopping', 'bills', 'transport',
        'travel', 'safe daily spend', 'top outlays'
      ];
      const cleaned = mLower.replace(/\?+$/, '').trim();
      if (directPhrases.includes(cleaned)) {
        for (const d of DOMAINS) {
          if (d.keywords.some(k => cleaned.includes(k))) {
            return {
              entity: d.displayName.toLowerCase(),
              candidateCategories: d.categories,
              displayName: d.displayName,
              emoji: d.emoji,
              period,
            };
          }
        }
      }

      return null;
    };

    const spendingInquiry = detectSpendingInquiry(trimmedMsg);
    if (spendingInquiry) {
      const now = new Date();
      let startDate = startOfMonth(now);
      let endDate = endOfMonth(now);
      if (spendingInquiry.period === 'today') {
        startDate = startOfDay(now);
        endDate = endOfDay(now);
      } else if (spendingInquiry.period === 'week') {
        startDate = startOfWeek(now, { weekStartsOn: 1 });
        endDate = endOfWeek(now, { weekStartsOn: 1 });
      } else if (spendingInquiry.period === 'year') {
        startDate = startOfYear(now);
        endDate = endOfYear(now);
      }

      const matchingTxs = await this.prisma.transaction.findMany({
        where: {
          userId: user.id,
          isDeleted: false,
          type: 'EXPENSE',
          transactionDate: { gte: startDate, lte: endDate },
          OR: [
            { category: { name: { in: spendingInquiry.candidateCategories, mode: 'insensitive' } } },
            { merchant: { contains: spendingInquiry.entity, mode: 'insensitive' } },
            { description: { contains: spendingInquiry.entity, mode: 'insensitive' } },
          ],
        },
        orderBy: { transactionDate: 'desc' },
        include: { category: true },
      });

      let spent = matchingTxs.reduce((sum, t) => sum + Number(t.amount), 0);

      // If no direct transaction found, check if category breakdown has a total
      if (spent === 0 && matchingTxs.length === 0) {
        const summary = await this.analyticsService.getSummaryReport(user.id, spendingInquiry.period);
        for (const cat of spendingInquiry.candidateCategories) {
          spent += summary.categoryBreakdown[cat] || 0;
        }
      }

      const budget = await this.prisma.budget.findFirst({
        where: {
          userId: user.id,
          category: { name: { in: spendingInquiry.candidateCategories, mode: 'insensitive' } },
        },
      });

      const budgetLimit = budget ? Number(budget.monthlyLimit) : null;
      const periodLabel = spendingInquiry.period === 'today' ? 'today' : spendingInquiry.period === 'week' ? 'this week' : spendingInquiry.period === 'year' ? 'this year' : 'this month';
      const entityLabel = spendingInquiry.entity.toLowerCase();

      let reply = '';
      if (spent === 0) {
        reply = `You haven't spent anything on **${entityLabel}** ${periodLabel}!`;
      } else {
        let budgetContext = '';
        if (budgetLimit && budgetLimit > 0) {
          if (spent > budgetLimit) {
            const over = spent - budgetLimit;
            budgetContext = `\n\n⚠️ You're **${curr}${over.toLocaleString()} over** your ${curr}${budgetLimit.toLocaleString()} monthly ${spendingInquiry.displayName.toLowerCase()} budget.`;
          } else if (spent >= budgetLimit * 0.8) {
            const remaining = budgetLimit - spent;
            budgetContext = `\n\n⚠️ You have **${curr}${remaining.toLocaleString()} left** of your ${curr}${budgetLimit.toLocaleString()} monthly ${spendingInquiry.displayName.toLowerCase()} budget.`;
          } else {
            const remaining = budgetLimit - spent;
            budgetContext = `\n\n✅ You have **${curr}${remaining.toLocaleString()} left** of your ${curr}${budgetLimit.toLocaleString()} monthly ${spendingInquiry.displayName.toLowerCase()} budget.`;
          }
        }

        if (matchingTxs.length === 1) {
          const t = matchingTxs[0];
          const merchantText = t.merchant ? ` at **${t.merchant}**` : '';
          reply = `You've spent **${curr}${spent.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}** on ${entityLabel} ${periodLabel}${merchantText}.${budgetContext}`;
        } else if (matchingTxs.length > 1) {
          const txList = matchingTxs.slice(0, 3).map(t =>
            `• ${t.merchant || t.description || 'Expense'}: **${curr}${Number(t.amount).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}**`
          ).join('\n');
          const extra = matchingTxs.length > 3 ? `\n• ...and ${matchingTxs.length - 3} more` : '';

          reply = `You've spent **${curr}${spent.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}** on ${entityLabel} ${periodLabel} across ${matchingTxs.length} expenses:\n\n${txList}${extra}${budgetContext}`;
        } else {
          reply = `You've spent **${curr}${spent.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}** on ${entityLabel} ${periodLabel}.${budgetContext}`;
        }
      }

      return {
        reply,
        financialContext: {
          category: spendingInquiry.displayName,
          spent,
          limit: budgetLimit,
          period: spendingInquiry.period,
        },
        transactions: matchingTxs,
      };
    }

    // 3. Process Transaction Creation via NLU
    const nluResult = await this.nluService.processUserInput(
      user.id,
      trimmedMsg,
    );

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
      const actionText = isExpense ? 'Logged Expense' : 'Recorded Income';
      
      const daily = await this.analyticsService.calculateDailyDiscretionaryLimit(user.id);
      const safeDailyStr = daily.needsIncomeConfig
        ? ''
        : `\n\nYour safe daily spend is **${curr}${daily.recommendedDailyLimit.toLocaleString()}/day** (${daily.daysRemaining} days left).`;

      return {
        reply: `✅ Logged **${curr}${Number(tx.amount).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}** for **${tx.merchant || tx.description}** (${tx.category?.name || 'General'}).${safeDailyStr}`,
        transaction: tx,
        transactions: createdTxList,
      };
    }

    if (nluResult.toolResult) {
      const tool = nluResult.toolResult;
      if (nluResult.intent === 'QUERY_CATEGORY_SPENDING' && tool.category) {
        const spent = Number(tool.spent || 0);
        const reply = spent > 0
          ? `You've spent **${curr}${spent.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}** on **${tool.category}** this ${tool.period || 'month'}.`
          : `You haven't recorded any expenses for **${tool.category}** this ${tool.period || 'month'}!`;
        return {
          reply,
          financialContext: tool,
        };
      }

      if (nluResult.intent === 'QUERY_EXPENSE_SUMMARY' && tool.totalExpense !== undefined) {
        return {
          reply: `Here is your summary for this ${tool.period || 'month'}:\n\n• Total Outflow: **${curr}${Number(tool.totalExpense || 0).toLocaleString()}**\n• Total Inflow: **${curr}${Number(tool.totalIncome || 0).toLocaleString()}**\n• Net Savings: **${curr}${Number(tool.netSavings || 0).toLocaleString()}**`,
          financialContext: tool,
        };
      }

      if (nluResult.intent === 'QUERY_TOP_EXPENSES' && Array.isArray(tool)) {
        const list = tool.map((t: any) => `• **${t.merchant || 'Expense'}**: ${curr}${Number(t.amount).toLocaleString()} (${t.category})`).join('\n');
        return {
          reply: tool.length === 0 ? "You don't have any expenses recorded yet for this month." : `Here are your biggest expenses this month:\n\n${list}`,
          financialContext: tool,
        };
      }

      if (nluResult.intent === 'BUDGET_QUERY' && Array.isArray(tool)) {
        const list = tool.map((b: any) => `• **${b.category}**: ${curr}${Number(b.spent).toLocaleString()} / ${curr}${Number(b.limit).toLocaleString()} (${b.usedPercentage}%) [${b.status}]`).join('\n');
        return {
          reply: tool.length === 0 ? "You don't have any category budgets configured yet. Try asking: 'Set food budget to 5000'." : `Here is your budget guardrails status:\n\n${list}`,
          financialContext: tool,
        };
      }
    }

    if (nluResult.replyText) {
      return { reply: nluResult.replyText };
    }

    // 4. Financial RAG & Semantic Intelligence: Route conversational questions, financial guidance, and analysis
    try {
      const ragAnalysis = await this.analyticsService.performFinancialRagAnalysis(
        user.id,
        trimmedMsg,
      );
      if (ragAnalysis && ragAnalysis.reply) {
        return {
          reply: ragAnalysis.reply,
          financialContext: ragAnalysis.data,
        };
      }
    } catch {
      // Fall through to conversational LLM fallback
    }

    // 5. Conversational LLM Direct Fallback
    try {
      const summary = await this.analyticsService.getSummaryReport(user.id, 'month');
      const topCats = Object.entries(summary.categoryBreakdown)
        .slice(0, 3)
        .map(([k, v]) => `${k}: ${curr}${v}`)
        .join(', ');
      const contextInfo = `Month Spend: ${curr}${summary.totalExpense}, Income: ${curr}${summary.totalIncome}, Net: ${curr}${summary.netSavings}. Top Categories: ${topCats || 'None'}.`;
      const conversationalReply = await LlmIntentAdapter.generateConversationalReply(trimmedMsg, contextInfo);
      if (conversationalReply) {
        return { reply: conversationalReply };
      }
    } catch {
      // Fall through to guidance card
    }

    // 6. Intelligent Copilot Guidance Card (rich, structured, actionable)
    return {
      reply: `I'm your **Kinetiq Financial Copilot**. I didn't recognize a specific transaction or command in your message.\n\nHere are some things you can ask me:\n• ⛽ **Category Spend:** "How much is my petrol spent?", "How much on food?"\n• 🛡️ **Safe Daily Spend:** "Can I spend ${curr}500 today?", "What is my daily limit?"\n• 📊 **Deep Financial RAG:** "Audit my subscriptions", "Compare vs last month", "Detect spending leaks"\n• ⚡ **Instant Outlay:** "Coffee 150", "Uber 280 to office", "Swiggy 420"`,
    };
  }

  @Get(['api/transactions/sync-check', 'analytics/sync-check'])
  @UseGuards(JwtAuthGuard)
  async checkSyncStatus(
    @Req() req: Request & { user: User },
    @Res({ passthrough: true }) res?: Response,
  ) {
    if (res) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    const user = req.user;

    const [latestTx, totalCount] = await Promise.all([
      this.prisma.transaction.findFirst({
        where: { userId: user.id, isDeleted: false },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, updatedAt: true, amount: true, merchant: true, description: true },
      }),
      this.prisma.transaction.count({
        where: { userId: user.id, isDeleted: false },
      }),
    ]);

    return {
      latestTxId: latestTx?.id || null,
      lastUpdatedAt: latestTx?.updatedAt?.toISOString() || null,
      merchant: latestTx?.merchant || latestTx?.description || null,
      amount: latestTx ? Number(latestTx.amount) : null,
      count: totalCount,
      timestamp: Date.now(),
    };
  }

  @Get(['api/transactions', 'analytics/dashboard-data'])
  @UseGuards(JwtAuthGuard)
  async getDashboardData(
    @Req() req: Request & { user: User },
    @Res({ passthrough: true }) res?: Response,
  ) {
    if (res) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
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

    const [recentTransactions, totalCount, latestTx] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { userId: user.id, isDeleted: false },
        orderBy: { transactionDate: 'desc' },
        take: 20,
        include: { category: true },
      }),
      this.prisma.transaction.count({
        where: { userId: user.id, isDeleted: false },
      }),
      this.prisma.transaction.findFirst({
        where: { userId: user.id, isDeleted: false },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, updatedAt: true },
      }),
    ]);

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
      totalCount,
      latestTxId: latestTx?.id || null,
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

  @Put(['api/budgets/sync', 'analytics/budgets/sync'])
  @UseGuards(JwtAuthGuard)
  async syncBudgets(
    @Body() body: any,
    @Req() req: Request & { user: User },
  ) {
    const user = req.user;
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const budgetsList = Array.isArray(body) ? body : (body?.budgets || []);
    if (!Array.isArray(budgetsList)) {
      throw new BadRequestException('Budgets array required');
    }

    const activeCategoryNames = budgetsList
      .filter((b: any) => b && b.categoryName && Number(b.monthlyLimit) > 0)
      .map((b: any) => String(b.categoryName).trim().toLowerCase());

    const existingBudgets = await this.prisma.budget.findMany({
      where: { userId: user.id, month, year },
      include: { category: true },
    });

    for (const eb of existingBudgets) {
      if (eb.category && !activeCategoryNames.includes(eb.category.name.toLowerCase())) {
        await this.prisma.budget.delete({ where: { id: eb.id } });
      }
    }

    const results: any[] = [];
    for (const b of budgetsList) {
      const cat = String(b.categoryName || '').trim();
      const limit = Number(b.monthlyLimit);
      if (cat && limit > 0) {
        const res = await this.transactionService.setBudgetLimit(user.id, cat, limit);
        results.push(res);
      }
    }

    return { success: true, count: results.length };
  }

  @Delete(['api/budgets/:categoryName', 'analytics/budget/:categoryName'])
  @UseGuards(JwtAuthGuard)
  async deleteBudget(
    @Param('categoryName') categoryName: string,
    @Req() req: Request & { user: User },
  ) {
    const user = req.user;
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const category = await this.prisma.category.findFirst({
      where: {
        userId: user.id,
        name: { equals: categoryName, mode: 'insensitive' },
      },
    });

    if (category) {
      await this.prisma.budget.deleteMany({
        where: {
          userId: user.id,
          categoryId: category.id,
          month,
          year,
        },
      });
    }

    return { success: true, message: `Budget for ${categoryName} removed` };
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
