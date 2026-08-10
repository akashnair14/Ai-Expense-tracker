import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Bot, InlineKeyboard } from 'grammy';
import { NluService } from '../nlu/nlu.service';
import { TransactionService } from '../transactions/transaction.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TelegramBotService implements OnModuleInit {
  private readonly logger = new Logger(TelegramBotService.name);
  private bot: Bot;

  constructor(
    private readonly nluService: NluService,
    private readonly transactionService: TransactionService,
    private readonly analyticsService: AnalyticsService,
    private readonly prisma: PrismaService,
  ) {

    const token = process.env.TELEGRAM_BOT_TOKEN || 'MOCK_TELEGRAM_TOKEN';
    this.bot = new Bot(token);
  }

  async onModuleInit() {
    this.registerHandlers();
    
    // Only run long-polling when NOT in a serverless environment (e.g. Vercel)
    if (process.env.TELEGRAM_BOT_TOKEN && !process.env.VERCEL) {
      this.bot.start({
        onStart: (botInfo) => {
          this.logger.log(`🤖 Telegram Bot successfully connected & running as @${botInfo.username}`);
        },
      }).catch((err) => {
        this.logger.warn(`Telegram Bot long polling notice: ${err.message}`);
      });
    }
  }

  private registerHandlers() {
    // /start command
    this.bot.command('start', async (ctx) => {
      const name = ctx.from?.first_name || 'Friend';
      const welcomeText = `👋 Hello ${name}!\n\nWelcome to your **AI-Powered Personal Expense Tracker**.\n\nYou can send any natural text like:\n• Paid ₹250 for lunch\n• Uber ₹420\n• Salary +50000\n• Zomato 800 split with 4\n\nCommands:\n/today - View today's summary\n/month - View current month overview\n/undo - Delete last transaction\n/help - Detailed user guide`;
      await ctx.reply(welcomeText, { parse_mode: 'Markdown' });
    });

    // /help command
    this.bot.command('help', async (ctx) => {
      const helpText = `📘 **Expense Tracker Guide**\n\n**Natural Language Examples:**\n• *Paid ₹500 to Rahul* (Expense)\n• *Received salary 55000* (Income)\n• *Movie yesterday 400* (Backdated)\n• *Zomato 800 split with 4* (Split calculation: ₹200)\n\n**All Commands:**\n/today | /yesterday | /week | /month | /year\n/summary | /undo | /redo`;
      await ctx.reply(helpText, { parse_mode: 'Markdown' });
    });

    // /today command
    this.bot.command('today', async (ctx) => {
      if (!ctx.from) return;
      const user = await this.transactionService.getOrCreateUser(ctx.from.id);
      const summary = await this.analyticsService.getSummaryReport(user.id, 'today');
      
      let text = `📅 **Today's Financial Summary**\n\n`;
      text += `💸 **Total Expenses:** ${user.currency} ${summary.totalExpense}\n`;
      text += `💰 **Total Income:** ${user.currency} ${summary.totalIncome}\n`;
      text += `📊 **Net Savings:** ${user.currency} ${summary.netSavings}\n`;
      text += `🔢 **Transactions Recorded:** ${summary.transactionCount}\n\n`;
      
      if (Object.keys(summary.categoryBreakdown).length > 0) {
        text += `🏷️ **Category Breakdown:**\n`;
        for (const [cat, amt] of Object.entries(summary.categoryBreakdown)) {
          text += `• ${cat}: ${user.currency} ${amt}\n`;
        }
      }
      
      await ctx.reply(text, { parse_mode: 'Markdown' });
    });

    // /month command
    this.bot.command('month', async (ctx) => {
      if (!ctx.from) return;
      const user = await this.transactionService.getOrCreateUser(ctx.from.id);
      const summary = await this.analyticsService.getSummaryReport(user.id, 'month');
      
      let text = `🗓️ **Monthly Financial Overview**\n\n`;
      text += `💸 **Total Expenses:** ${user.currency} ${summary.totalExpense}\n`;
      text += `💰 **Total Income:** ${user.currency} ${summary.totalIncome}\n`;
      text += `📊 **Net Savings:** ${user.currency} ${summary.netSavings}\n`;
      text += `🔢 **Transactions Recorded:** ${summary.transactionCount}\n\n`;
      
      if (Object.keys(summary.categoryBreakdown).length > 0) {
        text += `🏷️ **Top Expense Categories:**\n`;
        for (const [cat, amt] of Object.entries(summary.categoryBreakdown)) {
          text += `• ${cat}: ${user.currency} ${amt}\n`;
        }
      }
      
      await ctx.reply(text, { parse_mode: 'Markdown' });
    });

    // /undo command
    this.bot.command('undo', async (ctx) => {
      if (!ctx.from) return;
      const deleted = await this.transactionService.deleteLastTransaction(ctx.from.id);
      if (deleted) {
        await ctx.reply(`🗑️ Undone last transaction: **${deleted.description}** (${deleted.currency} ${deleted.amount})`, {
          parse_mode: 'Markdown',
        });
      } else {
        await ctx.reply('No active transaction found to undo.');
      }
    });

    // /recurring command
    this.bot.command('recurring', async (ctx) => {
      if (!ctx.from) return;
      const user = await this.transactionService.getOrCreateUser(ctx.from.id);
      const text = ctx.message?.text || '';
      const args = text.replace('/recurring', '').trim();

      if (!args) {
        // Show current recurring setups
        const recurrings = await this.prisma.recurringTransaction.findMany({
          where: { userId: user.id },
          include: { category: true },
        });

        if (recurrings.length === 0) {
          await ctx.reply(`🔁 **No Recurring Schedules Found**\n\nTo add a recurring payment/income, type:\n\`/recurring Rent 15000 on 1st\`\n\`/recurring SIP 5000 on 5th\`\n\`/recurring Salary 60000 income on 30th\``, { parse_mode: 'Markdown' });
          return;
        }

        let msg = `🔁 **Your Active Recurring Schedules:**\n\n`;
        recurrings.forEach(r => {
          const typeEmoji = r.type === 'INCOME' ? '💰' : '💸';
          const dateStr = new Date(r.nextRun).toISOString().split('T')[0];
          msg += `${typeEmoji} **${r.description}**: ${user.currency} ${r.amount} (${r.category?.name || 'General'})\n   🗓️ Next Due: ${dateStr}\n\n`;
        });
        await ctx.reply(msg, { parse_mode: 'Markdown' });
        return;
      }

      // Parse inline command args e.g. "Rent 15000 on 1st"
      const match = args.match(/(.+?)\s+(?:₹|Rs\.?)?\s*(\d+(?:\.\d+)?)(?:\s+(income|expense))?\s+(?:on|every)?\s*(\d+)(?:st|nd|rd|th)?/i);
      if (!match) {
        await ctx.reply(`⚠️ **Invalid Format**. Example format:\n\`/recurring Rent 15000 on 1st\`\n\`/recurring Zerodha SIP 5000 on 5th\``, { parse_mode: 'Markdown' });
        return;
      }

      const name = match[1].trim();
      const amount = parseFloat(match[2]);
      const isIncome = (match[3] || '').toLowerCase() === 'income' || name.toLowerCase().includes('salary');
      const type = isIncome ? 'INCOME' : 'EXPENSE';
      const day = parseInt(match[4]);

      const now = new Date();
      let nextRun = new Date(now.getFullYear(), now.getMonth(), day);
      if (nextRun <= now) {
        nextRun = new Date(now.getFullYear(), now.getMonth() + 1, day);
      }

      let category = await this.prisma.category.findFirst({
        where: { userId: user.id, name: { equals: name, mode: 'insensitive' } }
      });

      if (!category) {
        category = await this.prisma.category.create({
          data: { userId: user.id, name, type }
        });
      }

      await this.prisma.recurringTransaction.create({
        data: {
          userId: user.id,
          categoryId: category.id,
          type,
          amount,
          description: name,
          cronExpression: `0 0 ${day} * *`,
          nextRun,
          isActive: true
        }
      });

      await ctx.reply(`✅ **Recurring Schedule Created!**\n\n📌 **${name}**: ${user.currency} ${amount}\n🗓️ **Scheduled Day:** Every ${day}th of the month\n🗓️ **Next Auto-Run:** ${nextRun.toISOString().split('T')[0]}`, { parse_mode: 'Markdown' });
    });


    // Catch-all message handler for Natural Language processing
    this.bot.on('message:text', async (ctx) => {
      const text = ctx.message.text;
      if (text.startsWith('/')) return;

      const telegramId = ctx.from.id;
      const parsed = await this.nluService.parseText(text);

      if (parsed.amount <= 0) {
        await ctx.reply(`🤔 Couldn't detect an amount in "${text}". Please send like: "Coffee 180"`);
        return;
      }

      const { transaction, budgetAlert } = await this.transactionService.recordParsedTransaction(telegramId, parsed);

      let responseText = `✅ **Recorded ${transaction.type === 'INCOME' ? 'Income' : 'Expense'}**\n\n`;
      responseText += `💰 **Amount:** ${transaction.currency} ${transaction.amount}`;
      if (transaction.originalAmount) {
        responseText += ` *(Original: ${transaction.currency} ${transaction.originalAmount}, Split ${transaction.splitCount} ways)*`;
      }
      responseText += `\n🏷️ **Category:** ${parsed.category}`;
      if (transaction.merchant) responseText += `\n🏪 **Merchant:** ${transaction.merchant}`;
      responseText += `\n📝 **Description:** ${transaction.description}`;
      responseText += `\n⚡ **Parsed By:** ${transaction.parsedBy}`;

      if (budgetAlert) {
        responseText += `\n\n📊 **Budget Update (${budgetAlert.categoryName}):**`;
        responseText += `\nSpent: ${transaction.currency} ${budgetAlert.currentSpent} / ${budgetAlert.monthlyLimit} (${budgetAlert.usedPercentage}%)`;
        if (budgetAlert.isExceeded) {
          responseText += `\n⚠️ **WARNING: Budget limit exceeded by ${transaction.currency} ${Math.abs(budgetAlert.remaining)}!**`;
        }
      }

      const keyboard = new InlineKeyboard()
        .text('✏️ Edit', `edit_${transaction.id}`)
        .text('❌ Delete', `delete_${transaction.id}`);

      await ctx.reply(responseText, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    });
  }

  public async sendMessage(telegramId: number | string, message: string) {
    if (!this.bot || !process.env.TELEGRAM_BOT_TOKEN) {
      this.logger.warn(`Skipping Telegram message to ${telegramId}: Bot token not set.`);
      return;
    }
    try {
      await this.bot.api.sendMessage(telegramId, message, { parse_mode: 'Markdown' });
    } catch (err) {
      this.logger.error(`Failed to send Telegram message to ${telegramId}:`, err);
    }
  }

  @OnEvent('budget.alert')
  async handleBudgetAlertEvent(payload: { telegramId: string; categoryName: string; monthlyLimit: number; currentSpent: number; usedPercentage: number; remaining: number; isExceeded: boolean; currency: string }) {
    const icon = payload.isExceeded ? '🚨' : '⚠️';
    const statusText = payload.isExceeded ? 'BUDGET EXCEEDED' : 'NEAR BUDGET LIMIT';
    const alertMsg = `${icon} **${statusText}**\n\n📌 **Category:** ${payload.categoryName}\n💵 **Spent:** ${payload.currency}${payload.currentSpent.toLocaleString()} / ${payload.currency}${payload.monthlyLimit.toLocaleString()} (${payload.usedPercentage}%)\n${payload.isExceeded ? `⚠️ Over limit by ${payload.currency}${Math.abs(payload.remaining).toLocaleString()}` : `💡 Remaining: ${payload.currency}${payload.remaining.toLocaleString()}`}`;
    
    await this.sendMessage(payload.telegramId, alertMsg);
  }

  @OnEvent('recurring.auto_posted')
  async handleRecurringPostedEvent(payload: { telegramId: string; description: string; amount: number; categoryName: string; currency: string; type: string; nextRun: string }) {
    const typeEmoji = payload.type === 'INCOME' ? '💰' : '💸';
    const msg = `${typeEmoji} **Recurring Payment Auto-Recorded**\n\n📌 **${payload.description}**\n💵 **Amount:** ${payload.currency} ${payload.amount}\n🏷️ **Category:** ${payload.categoryName}\n🗓️ **Next Schedule:** ${payload.nextRun}`;
    await this.sendMessage(payload.telegramId, msg);
  }

  public getBot() {
    return this.bot;
  }
}


