import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { Bot, InlineKeyboard, Keyboard, InputFile } from 'grammy';
import axios from 'axios';
import { startOfDay, endOfDay, startOfMonth, endOfMonth } from 'date-fns';
import { NluService } from '../nlu/nlu.service';
import { TransactionService } from '../transactions/transaction.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { ReceiptVisionService } from '../nlu/services/receipt-vision.service';
import { AudioTranscriptionService } from '../nlu/services/audio-transcription.service';
import { TelegramIdempotencyService } from './telegram-idempotency.service';
import { GroupSplitService } from '../transactions/group-split.service';
import { ForexService } from '../common/forex/forex.service';

@Injectable()
export class TelegramBotService implements OnModuleInit {
  private readonly logger = new Logger(TelegramBotService.name);
  private bot: Bot;

  constructor(
    private readonly nluService: NluService,
    private readonly transactionService: TransactionService,
    private readonly analyticsService: AnalyticsService,
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly idempotencyService: TelegramIdempotencyService,
    private readonly groupSplitService: GroupSplitService,
    private readonly forexService: ForexService,
  ) {
    const token = process.env.TELEGRAM_BOT_TOKEN || 'MOCK_TELEGRAM_TOKEN';
    this.bot = new Bot(token);
  }

  async onModuleInit() {
    this.bot.catch((err) => {
      this.logger.error(`Telegram Bot Error: ${err.message}`, err.stack);
    });

    // Register Idempotency Middleware for all Telegram updates (Webhook & Polling)
    this.bot.use(async (ctx, next) => {
      const updateId = ctx.update?.update_id;
      if (updateId !== undefined && updateId !== null) {
        const lockDecision =
          await this.idempotencyService.acquireLock(updateId);
        if (!lockDecision.proceed) {
          this.logger.warn(
            `Skipping duplicate Telegram update ${updateId} (${lockDecision.reason}).`,
          );
          return;
        }

        try {
          await next();
          await this.idempotencyService.markCompleted(updateId);
        } catch (error) {
          await this.idempotencyService.markFailed(updateId);
          throw error;
        }
      } else {
        await next();
      }
    });

    this.registerHandlers();

    // Set native Telegram Menu button commands
    if (process.env.TELEGRAM_BOT_TOKEN) {
      try {
        await this.bot.api.setMyCommands([
          {
            command: 'today',
            description: "📅 View today's financial summary",
          },
          { command: 'month', description: '🗓️ Current month breakdown' },
          {
            command: 'report',
            description: '📊 Visual statement & health score',
          },
          {
            command: 'budget',
            description: '🎯 Interactive budget control center',
          },
          {
            command: 'recurring',
            description: '🔁 Scheduled & recurring expenses',
          },
          {
            command: 'export',
            description: '📥 Download transactions CSV report',
          },
          {
            command: 'dashboard',
            description: '💻 Open web dashboard & QR login',
          },
          { command: 'undo', description: '🗑️ Undo last recorded entry' },
          {
            command: 'help',
            description: '📘 Quick guide & instant AI query chips',
          },
        ]);
      } catch (e: any) {
        this.logger.warn(
          `Could not register Telegram bot menu commands: ${e.message}`,
        );
      }
    }

    // Only run long-polling when NOT in a serverless environment (e.g. Vercel)
    if (process.env.TELEGRAM_BOT_TOKEN && !process.env.VERCEL) {
      this.bot
        .start({
          onStart: (botInfo) => {
            this.logger.log(
              `🤖 Telegram Bot successfully connected & running as @${botInfo.username}`,
            );
          },
        })
        .catch((err) => {
          this.logger.warn(`Telegram Bot long polling notice: ${err.message}`);
        });
    }
  }

  // --- SAFE FORMATTING UTILITIES ---
  private readonly CATEGORY_EMOJIS: Record<string, string> = {
    'Food & Dining': '🍔',
    'Food': '🍔',
    'Groceries': '🛒',
    'Shopping': '🛍️',
    'Transport': '🚕',
    'Travel & Fuel': '🚗',
    'Fuel': '⛽',
    'Bills & Utilities': '💡',
    'Bills': '💡',
    'Rent': '🏠',
    'EMI': '💳',
    'Entertainment': '🎬',
    'Healthcare': '💊',
    'Education': '📚',
    'Investment': '📈',
    'Insurance': '🛡️',
    'Salary': '💰',
    'Freelance': '💻',
    'Business': '🏢',
    'Gift': '🎁',
    'Others': '📦',
  };

  private getCategoryEmoji(catName: string): string {
    for (const [key, emoji] of Object.entries(this.CATEGORY_EMOJIS)) {
      if (catName.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(catName.toLowerCase())) {
        return emoji;
      }
    }
    return '🏷️';
  }

  private renderProgressBar(percentage: number, length = 10): string {
    const filled = Math.min(length, Math.max(0, Math.round((percentage / 100) * length)));
    const empty = Math.max(0, length - filled);
    return '█'.repeat(filled) + '░'.repeat(empty);
  }


  private escapeMd(text: string | null | undefined): string {
    if (!text) return '';
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
  }

  private getPersistentKeyboard() {
    return new Keyboard()
      .text('📅 Today')
      .text('🗓️ Month')
      .text('💓 Pulse Score')
      .row()
      .text('📋 History')
      .text('🎯 Budget')
      .text('📊 Report')
      .row()
      .text('📱 Open Mini App')
      .text('📘 Help')
      .resized();
  }

  private getPersistentKeyboard_old() {
    return new Keyboard()
      .text('📅 Today')
      .text('🗓️ Month')
      .row()
      .text('🎯 Budget')
      .text('📊 Report')
      .row()
      .text('💻 Dashboard')
      .text('📘 Help')
      .resized();
  }

  // --- REUSABLE VIEW RENDERERS ---

  
  private async showPulseScore(ctx: any, user: any, isEdit = false) {
    const [pulse, dailyLimit, monthSummary] = await Promise.all([
      this.analyticsService.calculatePulseScore(user.id),
      this.analyticsService.calculateDailyDiscretionaryLimit(user.id),
      this.analyticsService.getSummaryReport(user.id, 'month'),
    ]);

    const gradeEmoji = pulse.pulseScore >= 80 ? '🟢' : pulse.pulseScore >= 60 ? '🟡' : '🔴';
    const bar = this.renderProgressBar(pulse.pulseScore, 10);

    let text = `💓 *Kinetiq Pulse Financial Health Score*\n\n`;
    text += `       ${gradeEmoji} *${pulse.pulseScore} / 100 — ${pulse.grade.toUpperCase()}*\n`;
    text += `       [${bar}]\n\n`;

    text += `📊 *Current Month Cash Flow:*\n`;
    text += `• 💰 Income: ${user.currency} ${monthSummary.totalIncome.toLocaleString()}\n`;
    text += `• 💸 Spent:  ${user.currency} ${monthSummary.totalExpense.toLocaleString()}\n`;
    text += `• 📈 Savings: ${user.currency} ${monthSummary.netSavings.toLocaleString()}\n\n`;

    text += `💡 *Safe Daily Spend Remaining:* ${user.currency} ${dailyLimit.recommendedDailyLimit.toLocaleString()} / day\n`;

    if (pulse.reasons && pulse.reasons.length > 0) {
      text += `\n🔍 *Key Drivers:*\n`;
      pulse.reasons.slice(0, 3).forEach((r: string) => {
        text += `• ${this.escapeMd(r)}\n`;
      });
    }

    const appUrl = process.env.APP_URL || 'https://ai-expense-tracker-o5a3.onrender.com';
    const keyboard = new InlineKeyboard()
      .text('🎯 Adjust Budget', 'cmd_budget')
      .webApp('📱 Mini App', appUrl)
      .row()
      .text('🗓️ Month View', 'cmd_month')
      .text('🔙 Main Menu', 'cmd_menu');

    if (isEdit) {
      try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
        return;
      } catch (_) {}
    }
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }

  private async showTransactionHistory(ctx: any, user: any, page = 1, isEdit = false) {
    const pageSize = 5;
    const skip = (page - 1) * pageSize;

    const [transactions, totalCount] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { userId: user.id, isDeleted: false },
        include: { category: true },
        orderBy: { transactionDate: 'desc' },
        take: pageSize,
        skip,
      }),
      this.prisma.transaction.count({
        where: { userId: user.id, isDeleted: false },
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const currentPage = Math.min(page, totalPages);

    let text = `📋 *Transaction History (Page ${currentPage}/${totalPages})*\n\n`;

    if (transactions.length === 0) {
      text += `No recorded transactions found yet.\nSend e.g. \`Coffee 180\` to record your first entry!`;
    } else {
      transactions.forEach((t, i) => {
        const catName = t.category?.name || 'Others';
        const emoji = this.getCategoryEmoji(catName);
        const typeSign = t.type === 'INCOME' ? '+' : '-';
        const dateStr = new Date(t.transactionDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        const desc = t.merchant || t.description || catName;
        text += `${skip + i + 1}. ${emoji} *${this.escapeMd(desc)}* — ${typeSign}${t.currency || user.currency} ${Number(t.amount).toLocaleString()}\n   🗓️ ${dateStr} • ${this.escapeMd(catName)}\n\n`;
      });
    }

    const keyboard = new InlineKeyboard();

    if (totalPages > 1) {
      if (currentPage > 1) {
        keyboard.text('◀️ Prev', `hist_page_${currentPage - 1}`);
      }
      keyboard.text(`${currentPage} / ${totalPages}`, 'noop');
      if (currentPage < totalPages) {
        keyboard.text('Next ▶️', `hist_page_${currentPage + 1}`);
      }
      keyboard.row();
    }

    keyboard
      .text('🗑️ Undo Last', 'cmd_undo')
      .text('📥 Export CSV', 'cmd_export')
      .row()
      .text('🔙 Back to Main Menu', 'cmd_menu');

    if (isEdit) {
      try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
        return;
      } catch (_) {}
    }
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }

  private async showCategoryGrid(ctx: any, user: any, txId: string) {
    const gridCategories = [
      ['Food & Dining', 'Groceries', 'Shopping'],
      ['Transport', 'Travel & Fuel', 'Bills'],
      ['Entertainment', 'Healthcare', 'Others'],
    ];

    const keyboard = new InlineKeyboard();

    gridCategories.forEach((row) => {
      row.forEach((cat) => {
        const emoji = this.getCategoryEmoji(cat);
        keyboard.text(`${emoji} ${cat}`, `set_tx_cat_${txId}:${cat}`);
      });
      keyboard.row();
    });

    keyboard.text('🔙 Cancel', 'cmd_menu');

    const text = '🏷️ *Select New Category for this Transaction:*';
    try {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
  }

  private async showMainMenu(ctx: any, user: any, isEdit = false) {
    const name = this.escapeMd(
      ctx.from?.first_name || user.firstName || 'Friend',
    );
    const now = new Date();
    const userBudgets = await this.prisma.budget.findMany({
      where: {
        userId: user.id,
        month: now.getMonth() + 1,
        year: now.getFullYear(),
      },
      include: { category: true },
    });

    const hasBudget = userBudgets.length > 0;

    let welcomeText = `👋 Hello *${name}*!\n\nWelcome to your *Kinetiq Money Finance Assistant*.\n\n💬 *Ways to Log:*
• Text: \`Coffee 180\` or \`Rent 15k\`
• Batch: \`Lunch 200, tea 40, cab 180\`
• Bank SMS: Paste any bank debit/credit alert
• 🎙️ Audio: Send voice note speaking your spend
• 📸 Photo: Send bill picture to scan receipt\n`;

    if (!hasBudget) {
      welcomeText += `\n🎯 *Monthly Budget Not Set!*
You haven't fixed a spending budget for this month yet. Setting monthly limits helps keep your finances in check.

👉 *Set your budget now:* Tap *🎯 Set Monthly Budget* below or type: \`/budget Food 5000\`\n`;
    }

    welcomeText += `\n⚡ *Quick Actions:*
/today • Today's summary
/month • Monthly overview
/budget • Check & set budgets
/recurring • Scheduled payments
/export • Download CSV report
/dashboard • Web dashboard link
/undo • Remove last entry
/help • Guide & AI Query Chips`;

    const appUrl = process.env.APP_URL;
    const quickKeyboard = new InlineKeyboard();

    if (!hasBudget) {
      quickKeyboard.text('🎯 Set Monthly Budget', 'bgt_pick_cat').row();
    }

    quickKeyboard
      .text('📅 Today', 'cmd_today')
      .text('🗓️ Month', 'cmd_month')
      .row()
      .text('🎯 Budget', 'cmd_budget')
      .text('🔁 Recurring', 'cmd_recurring')
      .row()
      .text('📥 Export CSV', 'cmd_export')
      .row();

    if (appUrl && appUrl.startsWith('https://')) {
      quickKeyboard.webApp('📱 Open Mini App', appUrl).url('🌐 Web Dashboard', appUrl);
    } else {
      quickKeyboard.webApp('📱 Open Mini App', appUrl || 'https://ai-expense-tracker-o5a3.onrender.com');
    }

    if (isEdit) {
      try {
        await ctx.editMessageText(welcomeText, {
          parse_mode: 'Markdown',
          reply_markup: quickKeyboard,
        });
        return;
      } catch (_) {}
    }
    await ctx.reply(welcomeText, {
      parse_mode: 'Markdown',
      reply_markup: quickKeyboard,
    });
  }

  private async showTodaySummary(ctx: any, user: any, isEdit = false) {
    const summary = await this.analyticsService.getSummaryReport(
      user.id,
      'today',
    );
    let text = `📅 *Today's Financial Summary*\n\n`;
    text += `💸 *Total Expenses:* ${user.currency} ${summary.totalExpense.toLocaleString()}\n`;
    text += `💰 *Total Income:* ${user.currency} ${summary.totalIncome.toLocaleString()}\n`;
    text += `📊 *Net Savings:* ${user.currency} ${summary.netSavings.toLocaleString()}\n`;
    text += `🔢 *Transactions Recorded:* ${summary.transactionCount}\n\n`;

    if (Object.keys(summary.categoryBreakdown).length > 0) {
      text += `🏷️ *Category Breakdown:*\n`;
      for (const [cat, amt] of Object.entries(summary.categoryBreakdown)) {
        text += `• ${this.escapeMd(cat)}: ${user.currency} ${amt.toLocaleString()}\n`;
      }
    }

    const keyboard = new InlineKeyboard()
      .text('🗓️ Month View', 'cmd_month')
      .text('🎯 Budget', 'cmd_budget')
      .row()
      .text('🔙 Back to Main Menu', 'cmd_menu');

    if (isEdit) {
      try {
        await ctx.editMessageText(text, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
        return;
      } catch (_) {}
    }
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }

  private async showMonthSummary(ctx: any, user: any, isEdit = false) {
    const summary = await this.analyticsService.getSummaryReport(
      user.id,
      'month',
    );
    let text = `🗓️ *Monthly Financial Overview*\n\n`;
    text += `💸 *Total Expenses:* ${user.currency} ${summary.totalExpense.toLocaleString()}\n`;
    text += `💰 *Total Income:* ${user.currency} ${summary.totalIncome.toLocaleString()}\n`;
    text += `📊 *Net Savings:* ${user.currency} ${summary.netSavings.toLocaleString()}\n`;
    text += `🔢 *Transactions Recorded:* ${summary.transactionCount}\n\n`;

    if (Object.keys(summary.categoryBreakdown).length > 0) {
      text += `🏷️ *Top Expense Categories:*\n`;
      for (const [cat, amt] of Object.entries(summary.categoryBreakdown)) {
        text += `• ${this.escapeMd(cat)}: ${user.currency} ${amt.toLocaleString()}\n`;
      }
    }

    const keyboard = new InlineKeyboard()
      .text('📅 Today', 'cmd_today')
      .text('📊 Report Card', 'cmd_report')
      .row()
      .text('🎯 Budget', 'cmd_budget')
      .text('🔙 Back to Main Menu', 'cmd_menu');

    if (isEdit) {
      try {
        await ctx.editMessageText(text, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
        return;
      } catch (_) {}
    }
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }

  private async showReportSummary(ctx: any, user: any, isEdit = false) {
    const monthSummary = await this.analyticsService.getSummaryReport(
      user.id,
      'month',
    );
    const pulseHealth = await this.analyticsService.calculatePulseScore(
      user.id,
    );
    const dailyLimit =
      await this.analyticsService.calculateDailyDiscretionaryLimit(user.id);

    const now = new Date();
    const monthName = now.toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
    });

    let card = `╔═══════════════════════════╗\n`;
    card += `   💳 *KINETIQ MONEY MONTHLY STATEMENT*\n`;
    card += `   🗓️ *${monthName.toUpperCase()}*\n`;
    card += `╚═══════════════════════════╝\n\n`;

    card += `💰 *Total Income:* ${user.currency} ${monthSummary.totalIncome.toLocaleString()}\n`;
    card += `💸 *Total Expenses:* ${user.currency} ${monthSummary.totalExpense.toLocaleString()}\n`;
    card += `📈 *Net Savings:* ${user.currency} ${monthSummary.netSavings.toLocaleString()}\n`;
    card += `🔢 *Transactions Logged:* ${monthSummary.transactionCount}\n\n`;

    card += `💓 *Pulse Health Score:* ${pulseHealth.pulseScore}/100 (${this.escapeMd(pulseHealth.grade)})\n`;
    card += `💡 *Safe Daily Spend:* ${user.currency} ${dailyLimit.recommendedDailyLimit.toLocaleString()} / day (${dailyLimit.daysRemaining} days left)\n\n`;

    const topCats = Object.entries(monthSummary.categoryBreakdown)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);

    if (topCats.length > 0) {
      card += `📊 *Top Spending Categories:*\n`;
      for (const [cat, amt] of topCats) {
        const pct =
          monthSummary.totalExpense > 0
            ? Math.round((amt / monthSummary.totalExpense) * 100)
            : 0;
        const barLength = Math.round(pct / 10);
        const bar =
          '■'.repeat(barLength) + '□'.repeat(Math.max(0, 10 - barLength));
        card += `• *${this.escapeMd(cat)}*: ${user.currency} ${amt.toLocaleString()} (${pct}%)\n  \`[${bar}]\`\n`;
      }
    }

    const appUrl =
      process.env.APP_URL || 'https://ai-expense-tracker-o5a3.onrender.com';
    const keyboard = new InlineKeyboard()
      .url('📊 Full Interactive Charts', appUrl)
      .row()
      .text('📥 Export CSV', 'cmd_export')
      .text('🎯 Adjust Budget', 'cmd_budget')
      .row()
      .text('🔙 Back to Main Menu', 'cmd_menu');

    if (isEdit) {
      try {
        await ctx.editMessageText(card, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
        return;
      } catch (_) {}
    }
    await ctx.reply(card, { parse_mode: 'Markdown', reply_markup: keyboard });
  }

  private async sendCsvExport(ctx: any, user: any) {
    await ctx.replyWithChatAction('upload_document').catch(() => {});

    const transactions = await this.prisma.transaction.findMany({
      where: { userId: user.id, isDeleted: false },
      include: { category: true },
      orderBy: { transactionDate: 'desc' },
    });

    if (transactions.length === 0) {
      const menuKeyboard = new InlineKeyboard().text(
        '🔙 Main Menu',
        'cmd_menu',
      );
      await ctx.reply('⚠️ No transactions found to export.', {
        reply_markup: menuKeyboard,
      });
      return;
    }

    let csv =
      'Date,Merchant/Description,Category,Type,Amount,Currency,ParsedBy\n';
    transactions.forEach((t) => {
      const d = new Date(t.transactionDate).toISOString().split('T')[0];
      let desc = (t.merchant || t.description || '').replace(/"/g, '""');
      if (['=', '+', '-', '@'].includes(desc.charAt(0))) desc = `'` + desc;

      let cat = (t.category?.name || 'Others').replace(/"/g, '""');
      if (['=', '+', '-', '@'].includes(cat.charAt(0))) cat = `'` + cat;

      csv += `${d},"${desc}","${cat}",${t.type},${Number(t.amount)},${t.currency || user.currency},${t.parsedBy}\n`;
    });

    const buffer = Buffer.from(csv, 'utf-8');
    const filename = `kinetiq_expenses_${new Date().toISOString().split('T')[0]}.csv`;

    const keyboard = new InlineKeyboard()
      .text('📊 Report Card', 'cmd_report')
      .text('🔙 Main Menu', 'cmd_menu');

    await ctx.replyWithDocument(new InputFile(buffer, filename), {
      caption: `📥 *Transactions Export (${transactions.length} entries)*\nExport generated on ${new Date().toLocaleDateString()}`,
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }

  private async showDashboard(ctx: any, isEdit = false) {
    const appUrl =
      process.env.APP_URL || 'https://ai-expense-tracker-o5a3.onrender.com';
    const keyboard = new InlineKeyboard()
      .webApp('📱 Open Mini App', appUrl).row().url('🌐 Open in Browser', appUrl)
      .row()
      .text('🔙 Back to Main Menu', 'cmd_menu');

    const text = `💻 *Web Dashboard Access*\n\nOpen your financial dashboard on your browser or laptop:\n${appUrl}\n\nScan the on-screen QR code with your phone camera to log in instantly without passwords!`;

    if (isEdit) {
      try {
        await ctx.editMessageText(text, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
        return;
      } catch (_) {}
    }
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }

  private async showHelp(ctx: any, isEdit = false) {
    const helpText = `📘 *Expense Tracker & AI Copilot Guide*\n\n💬 *Ways to Log:*
• Text: \`Zomato 450\` or \`Rent 15k\`
• Multipliers: \`2.5k\`, \`1.5 lakhs\`, \`50k\`
• Batch: \`Lunch 200, tea 40, cab 180\`
• Bank SMS: Paste bank debit/credit notifications
• Split: \`Dinner 1800 split with 3\`
• 🎙️ Audio: Send voice notes speaking your expense
• 📸 Photo: Send receipt/bill photos

💡 *Instant AI Queries (Tap any below):*`;

    const keyboard = new InlineKeyboard()
      .text('🏆 Top Expenses', 'ask_top_expenses')
      .text('🍔 Food Spend', 'ask_food_spend')
      .row()
      .text('🚗 Travel & Fuel', 'ask_travel_spend')
      .text('💡 Safe Daily Limit', 'ask_daily_limit')
      .row()
      .text('💓 Pulse Health Score', 'ask_pulse_score')
      .row()
      .text('📥 Export CSV', 'cmd_export')
      .text('🔙 Back to Main Menu', 'cmd_menu');

    if (isEdit) {
      try {
        await ctx.editMessageText(helpText, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
        return;
      } catch (_) {}
    }
    await ctx.reply(helpText, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }

  private async showRecurringList(ctx: any, user: any, isEdit = false) {
    const recurrings = await this.prisma.recurringTransaction.findMany({
      where: { userId: user.id },
      include: { category: true },
      orderBy: { createdAt: 'desc' },
    });

    const keyboard = new InlineKeyboard();

    let msg = `🔁 *Scheduled Recurring Commitments*\n\n`;

    if (recurrings.length === 0) {
      msg += `You have no active recurring commitments.\nTap a quick template below or type e.g.:\n\`/recurring Rent 15000 on 1st\`\n\`/recurring SIP 5000 on 5th\`\n\n`;
    } else {
      recurrings.forEach((r) => {
        const typeEmoji = r.type === 'INCOME' ? '💰' : '💸';
        const dateStr = new Date(r.nextRun).toISOString().split('T')[0];
        msg += `${typeEmoji} *${this.escapeMd(r.description)}*: ${user.currency} ${Number(r.amount).toLocaleString()} (${this.escapeMd(r.category?.name || 'General')})\n   🗓️ Day ${r.cronExpression.split(' ')[2]} of month • Next: ${dateStr}\n\n`;
        keyboard.text(`🗑️ Remove ${r.description}`, `rec_del_${r.id}`).row();
      });
    }

    keyboard
      .text('➕ Rent (₹15k)', 'rec_tpl_rent')
      .text('➕ SIP (₹5k)', 'rec_tpl_sip')
      .text('➕ Salary (₹60k)', 'rec_tpl_sal')
      .row()
      .text('🔄 Refresh', 'cmd_recurring')
      .text('🔙 Back to Main Menu', 'cmd_menu');

    if (isEdit) {
      try {
        await ctx.editMessageText(msg, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
        return;
      } catch (_) {}
    }
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: keyboard });
  }

  // --- BOT EVENT HANDLERS ---

  private registerHandlers() {
    // /start command & QR scan deep-linking
    
    // /split command for group and direct chats
    this.bot.command('split', async (ctx) => {
      if (!ctx.from) return;
      const user = await this.transactionService.getOrCreateUser(
        ctx.from.id,
        ctx.from.username,
        ctx.from.first_name,
        ctx.from.last_name,
      );

      const text = ctx.message?.text || '';
      const args = text.replace(/^\/split(@\w+)?/i, '').trim();

      if (!args) {
        await ctx.reply(
          `👥 *Group Expense Splitting*\n\n*Usage:*\n\`/split <amount> for <description> with @user1 @user2\`\n\n*Examples:*\n• \`/split 1200 for Dinner with @alice @bob\`\n• \`/split 450 Uber with @alex\`\n• \`/split 1800 3\` (Split 3 ways)`,
          { parse_mode: 'Markdown' },
        );
        return;
      }

      // Parse amount
      const amountMatch = args.match(/(?:₹|Rs\.?|\$|€|£)?\s*(\d+(?:\.\d+)?)/i);
      if (!amountMatch) {
        await ctx.reply('⚠️ Please provide a valid split amount. Example: `/split 1200 with @alice @bob`');
        return;
      }

      const totalAmount = parseFloat(amountMatch[1]);
      let remainder = args.replace(amountMatch[0], '').trim();

      // Extract tagged members
      const memberMatches = remainder.match(/@\w+/g) || [];
      const countMatch = remainder.match(/\b(\d+)\s*(?:ways|people|members|split)?\b/i);

      let members = ['Self'];
      if (memberMatches.length > 0) {
        members = ['Self', ...memberMatches];
      } else if (countMatch) {
        const count = parseInt(countMatch[1]);
        members = Array.from({ length: Math.max(2, count) }, (_, i) => i === 0 ? 'Self' : `Member ${i + 1}`);
      } else {
        members = ['Self', 'Friend 1'];
      }

      // Clean description
      let description = remainder
        .replace(/@\w+/g, '')
        .replace(/\b(?:for|with|split|ways|people)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim() || 'Shared Group Bill';

      await this.groupSplitService.createGroupExpense({
        chatId: String(ctx.chat.id),
        paidByUserId: user.id,
        totalAmount,
        currency: user.currency || 'INR',
        description,
        members,
      });

      const perPerson = (totalAmount / members.length).toFixed(2);
      let replyMsg = `🧾 *Group Expense Recorded!*\n\n📌 *Description:* ${this.escapeMd(description)}\n💰 *Total Paid:* ${user.currency} ${totalAmount.toLocaleString()} (by ${this.escapeMd(user.firstName || 'You')})\n👥 *Split (${members.length} members - ${user.currency} ${perPerson} each):*\n`;

      members.forEach((m) => {
        const isSelf = m === 'Self';
        replyMsg += `• ${this.escapeMd(isSelf ? (user.firstName || 'You') : m)}: ${user.currency} ${perPerson} (${isSelf ? '✅ Paid' : '⏳ Pending'})\n`;
      });

      replyMsg += `\n💡 *Check group ledger anytime with /balances*`;

      await ctx.reply(replyMsg, { parse_mode: 'Markdown' });
    });

    // /balances command
    this.bot.command('balances', async (ctx) => {
      const summary = await this.groupSplitService.getGroupBalances(String(ctx.chat.id));
      if (summary.balances.length === 0) {
        await ctx.reply('✨ *All settled up!* No outstanding balances in this group.');
        return;
      }

      let msg = `⚖️ *Group Balance Ledger*\n\n`;
      summary.balances.forEach((b) => {
        if (b.netBalance > 0) {
          msg += `🟢 *${this.escapeMd(b.userName)}* is owed: ` + b.netBalance.toLocaleString() + `\n`;
        } else if (b.netBalance < 0) {
          msg += `🔴 *${this.escapeMd(b.userName)}* owes: ` + Math.abs(b.netBalance).toLocaleString() + `\n`;
        } else {
          msg += `⚪ *${this.escapeMd(b.userName)}* is settled.\n`;
        }
      });

      msg += `\n💡 *To clear debts, type:* \`/settle\``;
      await ctx.reply(msg, { parse_mode: 'Markdown' });
    });

    // /settle command
    this.bot.command('settle', async (ctx) => {
      const res = await this.groupSplitService.settleGroupExpenses(String(ctx.chat.id));
      await ctx.reply(`🤝 *Group Debts Settled!*\n\nAll ${res.settledCount} outstanding expense splits have been marked as fully settled.`, { parse_mode: 'Markdown' });
    });

    this.bot.command('start', async (ctx) => {
      const payload = ctx.match;

      if (payload && payload.startsWith('qr_')) {
        if (!ctx.from) {
          await ctx.reply(`⚠️ User context not found.`);
          return;
        }

        const approved = await this.authService.approveQrSession(
          payload,
          ctx.from.id,
          ctx.from.first_name,
          ctx.from.username,
          ctx.from.last_name,
        );

        if (approved) {
          await ctx.reply(
            `✅ *Login Approved!*\n\nYour laptop/desktop browser has been instantly authenticated. You can now access your full dashboard on the big screen!`,
            { parse_mode: 'Markdown' },
          );
          return;
        } else {
          await ctx.reply(
            `⚠️ This QR login session has expired or is invalid. Please refresh the QR code on your computer screen.`,
          );
          return;
        }
      }

      if (!ctx.from) return;
      const user = await this.transactionService.getOrCreateUser(
        ctx.from.id,
        ctx.from.username,
        ctx.from.first_name,
        ctx.from.last_name,
      );

      // Send persistent keyboard on start
      try {
        await ctx.reply(
          '✨ *Welcome to Kinetiq Money! Quick menu loaded below.*',
          {
            parse_mode: 'Markdown',
            reply_markup: this.getPersistentKeyboard(),
          },
        );
      } catch (_) {}

      await this.showMainMenu(ctx, user);
    });

    // /export command
    this.bot.command('export', async (ctx) => {
      if (!ctx.from) return;
      const user = await this.transactionService.getOrCreateUser(
        ctx.from.id,
        ctx.from.username,
        ctx.from.first_name,
        ctx.from.last_name,
      );
      await this.sendCsvExport(ctx, user);
    });

    // /dashboard command
    this.bot.command('dashboard', async (ctx) => {
      await this.showDashboard(ctx);
    });

    // /report command
    this.bot.command('report', async (ctx) => {
      if (!ctx.from) return;
      const user = await this.transactionService.getOrCreateUser(
        ctx.from.id,
        ctx.from.username,
        ctx.from.first_name,
        ctx.from.last_name,
      );
      await this.showReportSummary(ctx, user);
    });

    // /budget command
    this.bot.command('budget', async (ctx) => {
      if (!ctx.from) return;
      const user = await this.transactionService.getOrCreateUser(
        ctx.from.id,
        ctx.from.username,
        ctx.from.first_name,
        ctx.from.last_name,
      );
      const text = ctx.message?.text || '';
      const args = text.replace('/budget', '').trim();

      if (args) {
        const match = args.match(/^(.+?)\s+(?:₹|Rs\.?)?\s*(\d+(?:\.\d+)?)$/i);
        if (match) {
          const catName = match[1].trim();
          const limit = parseFloat(match[2]);
          await this.transactionService.setBudgetLimit(user.id, catName, limit);
          const keyboard = new InlineKeyboard()
            .text('🎯 View Budgets', 'cmd_budget')
            .text('🔙 Main Menu', 'cmd_menu');
          await ctx.reply(
            `✅ *Budget Limit Set!*\n\n🎯 *${this.escapeMd(catName)}*: ${user.currency} ${limit.toLocaleString()} / month\nYou'll receive proactive alerts at 80% and 100% capacity.`,
            { parse_mode: 'Markdown', reply_markup: keyboard },
          );
          return;
        }
      }

      await this.showInteractiveBudgetDashboard(ctx, user);
    });

    // /today command
    
    // /pulse command
    this.bot.command('pulse', async (ctx) => {
      if (!ctx.from) return;
      const user = await this.transactionService.getOrCreateUser(ctx.from.id);
      await this.showPulseScore(ctx, user);
    });

    // /history command
    this.bot.command('history', async (ctx) => {
      if (!ctx.from) return;
      const user = await this.transactionService.getOrCreateUser(ctx.from.id);
      await this.showTransactionHistory(ctx, user, 1);
    });

    this.bot.command('today', async (ctx) => {
      if (!ctx.from) return;
      const user = await this.transactionService.getOrCreateUser(ctx.from.id);
      await this.showTodaySummary(ctx, user);
    });

    // /month command
    this.bot.command('month', async (ctx) => {
      if (!ctx.from) return;
      const user = await this.transactionService.getOrCreateUser(ctx.from.id);
      await this.showMonthSummary(ctx, user);
    });

    // /undo command
    this.bot.command('undo', async (ctx) => {
      if (!ctx.from) return;
      const deleted = await this.transactionService.deleteLastTransaction(
        ctx.from.id,
      );
      const keyboard = new InlineKeyboard().text(
        '🔙 Back to Main Menu',
        'cmd_menu',
      );
      if (deleted) {
        await ctx.reply(
          `🗑️ Undone last transaction: *${this.escapeMd(deleted.description || 'Transaction')}* (${deleted.currency} ${Number(deleted.amount).toLocaleString()})`,
          {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          },
        );
      } else {
        await ctx.reply('No active transaction found to undo.', {
          reply_markup: keyboard,
        });
      }
    });

    // /help command
    this.bot.command('help', async (ctx) => {
      await this.showHelp(ctx);
    });

    // /recurring command
    this.bot.command('recurring', async (ctx) => {
      if (!ctx.from) return;
      const user = await this.transactionService.getOrCreateUser(ctx.from.id);
      const text = ctx.message?.text || '';
      const args = text.replace('/recurring', '').trim();

      if (!args) {
        await this.showRecurringList(ctx, user);
        return;
      }

      const match = args.match(
        /(.+?)\s+(?:₹|Rs\.?)?\s*(\d+(?:\.\d+)?)(?:\s+(income|expense))?\s+(?:on|every)?\s*(\d+)(?:st|nd|rd|th)?/i,
      );
      if (!match) {
        await ctx.reply(
          `⚠️ *Invalid Format*. Example format:\n\`/recurring Rent 15000 on 1st\`\n\`/recurring Zerodha SIP 5000 on 5th\``,
          { parse_mode: 'Markdown' },
        );
        return;
      }

      const name = match[1].trim();
      const amount = parseFloat(match[2]);
      const isIncome =
        (match[3] || '').toLowerCase() === 'income' ||
        name.toLowerCase().includes('salary');
      const type = isIncome ? 'INCOME' : 'EXPENSE';
      const day = parseInt(match[4]);

      const now = new Date();
      let nextRun = new Date(now.getFullYear(), now.getMonth(), day);
      if (nextRun <= now) {
        nextRun = new Date(now.getFullYear(), now.getMonth() + 1, day);
      }

      let category = await this.prisma.category.findFirst({
        where: { userId: user.id, name: { equals: name, mode: 'insensitive' } },
      });

      if (!category) {
        category = await this.prisma.category.create({
          data: { userId: user.id, name, type },
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
          isActive: true,
        },
      });

      const recurringCreatedKeyboard = new InlineKeyboard()
        .text('🔁 View Recurring', 'cmd_recurring')
        .text('🔙 Main Menu', 'cmd_menu');

      await ctx.reply(
        `✅ *Recurring Schedule Created!*\n\n📌 *${this.escapeMd(name)}*: ${user.currency} ${amount.toLocaleString()}\n🗓️ *Scheduled Day:* Every ${day}th of the month\n🗓️ *Next Auto-Run:* ${nextRun.toISOString().split('T')[0]}`,
        { parse_mode: 'Markdown', reply_markup: recurringCreatedKeyboard },
      );
    });

    // Callback Query Handler for Interactive UI
    this.bot.on('callback_query:data', async (ctx) => {
      const data = ctx.callbackQuery.data;
      if (!ctx.from) return;

      await ctx.answerCallbackQuery().catch(() => {});

      const user = await this.transactionService.getOrCreateUser(ctx.from.id);

      if (data === 'cmd_menu' || data === 'cmd_start') {
        await this.showMainMenu(ctx, user, true);
      } else if (data === 'cmd_today') {
        await this.showTodaySummary(ctx, user, true);
      } else if (data === 'cmd_month') {
        await this.showMonthSummary(ctx, user, true);
      
      } else if (data === 'cmd_pulse' || data === 'ask_pulse_score') {
        await this.showPulseScore(ctx, user, true);
      } else if (data === 'cmd_history') {
        await this.showTransactionHistory(ctx, user, 1, true);
      } else if (data.startsWith('hist_page_')) {
        const pageNum = parseInt(data.replace('hist_page_', ''), 10) || 1;
        await this.showTransactionHistory(ctx, user, pageNum, true);
      } else if (data.startsWith('change_cat_')) {
        const txId = data.replace('change_cat_', '');
        await this.showCategoryGrid(ctx, user, txId);
      } else if (data.startsWith('set_tx_cat_')) {
        const parts = data.replace('set_tx_cat_', '').split(':');
        const txId = parts[0];
        const newCategory = parts[1];
        if (txId && newCategory) {
          await this.transactionService.updateTransactionCategory(user.id, txId, newCategory);
          await ctx.reply(`✅ *Category Updated!* Transaction reclassified to *${this.escapeMd(newCategory)}*.`, { parse_mode: 'Markdown' });
        }
      } else if (data === 'cmd_report') {
        await this.showReportSummary(ctx, user, true);
      } else if (data === 'cmd_export') {
        await this.sendCsvExport(ctx, user);
      } else if (data === 'cmd_recurring') {
        await this.showRecurringList(ctx, user, true);
      } else if (data === 'cmd_dashboard') {
        await this.showDashboard(ctx, true);
      } else if (data === 'cmd_budget' || data === 'bgt_refresh') {
        await this.showInteractiveBudgetDashboard(ctx, user, true);
      } else if (data === 'bgt_pick_cat') {
        await this.showBudgetCategoryPicker(ctx, user);
      } else if (data.startsWith('bgt_edit_')) {
        const catName = data.replace('bgt_edit_', '');
        await this.showBudgetAmountSelector(ctx, user, catName);
      } else if (data.startsWith('bgt_set_')) {
        const parts = data.replace('bgt_set_', '').split(':');
        const catName = parts[0]?.trim();
        const rawAmount = parts[1];
        const parsedAmount = parseFloat(rawAmount);

        if (
          catName &&
          !isNaN(parsedAmount) &&
          isFinite(parsedAmount) &&
          parsedAmount > 0
        ) {
          await this.transactionService.setBudgetLimit(
            user.id,
            catName,
            parsedAmount,
          );
          await this.showInteractiveBudgetDashboard(ctx, user, true);
        } else {
          this.logger.warn(`Invalid bgt_set payload received: ${data}`);
        }
      } else if (data.startsWith('bgt_adj_')) {
        const parts = data.replace('bgt_adj_', '').split(':');
        const catName = parts[0]?.trim();
        const rawDelta = parts[1];
        const delta = parseFloat(rawDelta);

        if (catName && !isNaN(delta) && isFinite(delta)) {
          const now = new Date();
          const existingBudget = await this.prisma.budget.findFirst({
            where: {
              userId: user.id,
              month: now.getMonth() + 1,
              year: now.getFullYear(),
              category: { name: { equals: catName, mode: 'insensitive' } },
            },
          });

          const currentLimit = existingBudget
            ? Number(existingBudget.monthlyLimit)
            : 5000;
          const newLimit = Math.max(500, currentLimit + delta);

          await this.transactionService.setBudgetLimit(
            user.id,
            catName,
            newLimit,
          );
          await this.showBudgetAmountSelector(ctx, user, catName, true);
        }
      } else if (data.startsWith('bgt_del_')) {
        const catName = data.replace('bgt_del_', '');
        const now = new Date();
        await this.prisma.budget.deleteMany({
          where: {
            userId: user.id,
            month: now.getMonth() + 1,
            year: now.getFullYear(),
            category: { name: { equals: catName, mode: 'insensitive' } },
          },
        });
        await this.showInteractiveBudgetDashboard(ctx, user, true);
      } else if (data.startsWith('rec_del_')) {
        const recId = data.replace('rec_del_', '');
        await this.prisma.recurringTransaction.deleteMany({
          where: { id: recId, userId: user.id },
        });
        await this.showRecurringList(ctx, user, true);
      } else if (data.startsWith('rec_tpl_')) {
        const tpl = data.replace('rec_tpl_', '');
        const now = new Date();
        if (tpl === 'rent') {
          await this.transactionService.createManualTransaction(user.id, {
            amount: 15000,
            categoryName: 'Rent',
            merchant: 'Monthly House Rent',
          });
          const nextRun = new Date(now.getFullYear(), now.getMonth() + 1, 1);
          await this.prisma.recurringTransaction.create({
            data: {
              userId: user.id,
              type: 'EXPENSE',
              amount: 15000,
              description: 'House Rent',
              cronExpression: '0 0 1 * *',
              nextRun,
              isActive: true,
            },
          });
        } else if (tpl === 'sip') {
          const nextRun = new Date(now.getFullYear(), now.getMonth() + 1, 5);
          await this.prisma.recurringTransaction.create({
            data: {
              userId: user.id,
              type: 'EXPENSE',
              amount: 5000,
              description: 'Mutual Fund SIP',
              cronExpression: '0 0 5 * *',
              nextRun,
              isActive: true,
            },
          });
        } else if (tpl === 'sal') {
          const nextRun = new Date(now.getFullYear(), now.getMonth() + 1, 30);
          await this.prisma.recurringTransaction.create({
            data: {
              userId: user.id,
              type: 'INCOME',
              amount: 60000,
              description: 'Monthly Salary',
              cronExpression: '0 0 30 * *',
              nextRun,
              isActive: true,
            },
          });
        }
        await this.showRecurringList(ctx, user, true);
      } else if (data === 'ask_top_expenses') {
        const txs = await this.prisma.transaction.findMany({
          where: { userId: user.id, isDeleted: false, type: 'EXPENSE' },
          orderBy: { amount: 'desc' },
          take: 5,
          include: { category: true },
        });
        let msg = `🏆 *Top Highest Expenses:*\n\n`;
        if (txs.length === 0) {
          msg += `No expense records found yet.\n`;
        } else {
          txs.forEach((t, i) => {
            const dateStr = t.transactionDate.toISOString().split('T')[0];
            msg += `${i + 1}. *${this.escapeMd(t.merchant || t.description)}*: ${user.currency} ${Number(t.amount).toLocaleString()} (${this.escapeMd(t.category?.name || 'General')}) • ${dateStr}\n`;
          });
        }
        const keyboard = new InlineKeyboard()
          .text('🗓️ Month Overview', 'cmd_month')
          .text('🔙 Help Menu', 'cmd_menu');
        try {
          await ctx.editMessageText(msg, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          });
        } catch (_) {
          await ctx.reply(msg, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          });
        }
      } else if (data === 'ask_food_spend') {
        const summary = await this.analyticsService.getSummaryReport(
          user.id,
          'month',
        );
        const foodAmt =
          summary.categoryBreakdown['Food & Dining'] ||
          summary.categoryBreakdown['Food'] ||
          summary.categoryBreakdown['Groceries'] ||
          0;
        const msg = `🍔 *Food & Dining Spending (This Month):*\n\n💸 Total Outlay: *${user.currency} ${foodAmt.toLocaleString()}*\n\n💡 _Tip: Set a budget for Food to get auto pace warnings!_`;
        const keyboard = new InlineKeyboard()
          .text('🎯 Set Food Budget', 'bgt_edit_Food & Dining')
          .row()
          .text('🔙 Back to Main Menu', 'cmd_menu');
        try {
          await ctx.editMessageText(msg, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          });
        } catch (_) {
          await ctx.reply(msg, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          });
        }
      } else if (data === 'ask_travel_spend') {
        const summary = await this.analyticsService.getSummaryReport(
          user.id,
          'month',
        );
        const travelAmt =
          (summary.categoryBreakdown['Travel & Fuel'] || 0) +
          (summary.categoryBreakdown['Transport'] || 0) +
          (summary.categoryBreakdown['Fuel'] || 0);
        const msg = `🚗 *Travel & Fuel Spending (This Month):*\n\n💸 Total Outlay: *${user.currency} ${travelAmt.toLocaleString()}*`;
        const keyboard = new InlineKeyboard()
          .text('🎯 Adjust Budget', 'cmd_budget')
          .text('🔙 Back to Main Menu', 'cmd_menu');
        try {
          await ctx.editMessageText(msg, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          });
        } catch (_) {
          await ctx.reply(msg, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          });
        }
      } else if (data === 'ask_daily_limit') {
        const dailyLimit =
          await this.analyticsService.calculateDailyDiscretionaryLimit(user.id);
        let msg = `💡 *Safe Daily Discretionary Spend*\n\n`;
        msg += `🛡️ *Safe Daily Limit:* **${user.currency} ${dailyLimit.recommendedDailyLimit.toLocaleString()} / day**\n`;
        msg += `🗓️ *Days Remaining:* ${dailyLimit.daysRemaining} days in this month\n`;
        msg += `💸 *Spent So Far:* ${user.currency} ${dailyLimit.spentSoFar.toLocaleString()}\n`;
        msg += `📌 *Fixed Commitments:* ${user.currency} ${dailyLimit.fixedCommitments.toLocaleString()}\n\n`;
        msg += `_Spending below this threshold guarantees you hit your target 20% savings retention._`;
        const keyboard = new InlineKeyboard()
          .text('📊 Full Report', 'cmd_report')
          .text('🔙 Back to Main Menu', 'cmd_menu');
        try {
          await ctx.editMessageText(msg, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          });
        } catch (_) {
          await ctx.reply(msg, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          });
        }
      } else if (data === 'ask_pulse_score') {
        const pulse = await this.analyticsService.calculatePulseScore(user.id);
        let msg = `💓 *Pulse Financial Health Score*\n\n`;
        msg += `🏆 *Score:* **${pulse.pulseScore} / 100** (${this.escapeMd(pulse.grade)})\n\n`;
        if (pulse.reasons && pulse.reasons.length > 0) {
          msg += `📋 *Score Breakdown:*\n`;
          pulse.reasons.forEach((r) => {
            msg += `• ${this.escapeMd(r)}\n`;
          });
        }
        const keyboard = new InlineKeyboard()
          .text('📊 View Statement', 'cmd_report')
          .text('🔙 Back to Main Menu', 'cmd_menu');
        try {
          await ctx.editMessageText(msg, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          });
        } catch (_) {
          await ctx.reply(msg, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          });
        }
      } else if (data.startsWith('change_cat_')) {
        const txId = data.replace('change_cat_', '');
        const categories = await this.prisma.category.findMany({
          where: { userId: user.id },
          orderBy: { name: 'asc' },
        });

        const defaultCatNames = [
          'Food & Dining',
          'Groceries',
          'Shopping',
          'Travel & Fuel',
          'Bills & Utilities',
          'Entertainment',
        ];
        const existingNames = new Set(categories.map((c) => c.name));
        const allNames = Array.from(
          new Set([...existingNames, ...defaultCatNames]),
        );

        const keyboard = new InlineKeyboard();
        let count = 0;
        for (const name of allNames) {
          keyboard.text(name, `set_tx_cat_${txId}:${name}`);
          count++;
          if (count % 2 === 0) keyboard.row();
        }
        if (count % 2 !== 0) keyboard.row();
        keyboard.text('🔙 Cancel', `cancel_cat_${txId}`);

        try {
          await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
        } catch (_) {}
      } else if (data.startsWith('set_tx_cat_')) {
        const rest = data.replace('set_tx_cat_', '');
        const parts = rest.split(':');
        const txId = parts[0]?.trim();
        const newCatName = parts.slice(1).join(':')?.trim();

        if (txId && newCatName) {
          const existingTx = await this.prisma.transaction.findFirst({
            where: { id: txId, userId: user.id, isDeleted: false },
          });

          if (existingTx) {
            let category = await this.prisma.category.findFirst({
              where: {
                userId: user.id,
                name: { equals: newCatName, mode: 'insensitive' },
              },
            });

            if (!category) {
              category = await this.prisma.category.create({
                data: { userId: user.id, name: newCatName, type: 'EXPENSE' },
              });
            }

            await this.prisma.transaction.update({
              where: { id: existingTx.id },
              data: { categoryId: category.id },
            });
          }
        }

        const resetKeyboard = new InlineKeyboard()
          .text('🏷️ Change Category', `change_cat_${txId}`)
          .text('❌ Delete', `delete_${txId}`)
          .row()
          .text('🔙 Main Menu', 'cmd_menu');

        try {
          await ctx.editMessageReplyMarkup({ reply_markup: resetKeyboard });
        } catch (_) {}
      } else if (data.startsWith('cancel_cat_')) {
        const txId = data.replace('cancel_cat_', '');
        const resetKeyboard = new InlineKeyboard()
          .text('🏷️ Change Category', `change_cat_${txId}`)
          .text('❌ Delete', `delete_${txId}`)
          .row()
          .text('🔙 Main Menu', 'cmd_menu');

        try {
          await ctx.editMessageReplyMarkup({ reply_markup: resetKeyboard });
        } catch (_) {}
      } else if (data.startsWith('delete_')) {
        const txId = data.replace('delete_', '');
        try {
          await this.prisma.transaction.updateMany({
            where: { id: txId, userId: user.id },
            data: { isDeleted: true },
          });
          const menuKeyboard = new InlineKeyboard().text(
            '🔙 Back to Main Menu',
            'cmd_menu',
          );
          await ctx.editMessageText(`🗑️ *This transaction has been deleted.*`, {
            parse_mode: 'Markdown',
            reply_markup: menuKeyboard,
          });
        } catch (err: any) {
          this.logger.warn(
            `Could not delete transaction ${txId}: ${err.message}`,
          );
        }
      }
    });

    // Voice Message & Audio Note OCR/Transcribe Handler (Multi-Model Cascading AI)
    this.bot.on(['message:voice', 'message:audio'], async (ctx) => {
      const from = ctx.from;
      if (!from) return;

      const voice = ctx.message.voice || ctx.message.audio;
      if (!voice) return;

      await ctx.replyWithChatAction('typing').catch(() => {});
      await ctx.reply(`🎙️ *Listening to your voice note...*`, {
        parse_mode: 'Markdown',
      });

      try {
        const file = await ctx.api.getFile(voice.file_id);
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const fileUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;

        const audioRes = await axios.get(fileUrl, {
          responseType: 'arraybuffer',
          timeout: 15000,
        });
        const audioBuffer = Buffer.from(audioRes.data);

        // Determine mime type and filename from Telegram file extension
        const filePath = file.file_path || 'voice.oga';
        const ext = filePath.split('.').pop()?.toLowerCase() || 'oga';
        let mimeType = 'audio/ogg';
        const filename = `voice.${ext}`;
        if (ext === 'mp3') mimeType = 'audio/mpeg';
        else if (ext === 'm4a') mimeType = 'audio/mp4';
        else if (ext === 'wav') mimeType = 'audio/wav';
        else if (ext === 'oga' || ext === 'ogg') mimeType = 'audio/ogg';

        const transcribedText = await AudioTranscriptionService.transcribeAudio(
          audioBuffer,
          filename,
          mimeType,
        );

        if (!transcribedText) {
          const failKeyboard = new InlineKeyboard().text(
            '🔙 Main Menu',
            'cmd_menu',
          );
          await ctx.reply(
            `⚠️ *Could not recognize any spoken text in voice note.* Please try speaking clearly closer to the mic (e.g. \`Coffee 180\` or \`Petrol 500\`).`,
            { parse_mode: 'Markdown', reply_markup: failKeyboard },
          );
          return;
        }

        await ctx.reply(
          `🎙️ *Heard:* "${this.escapeMd(transcribedText)}"\n⚡ *Processing...*`,
          { parse_mode: 'Markdown' },
        );

        await this.processTextMessage(ctx, transcribedText);
      } catch (err: any) {
        this.logger.error(
          `Error transcribing voice note: ${err.message}`,
          err.stack,
        );
        const failKeyboard = new InlineKeyboard().text(
          '🔙 Main Menu',
          'cmd_menu',
        );
        await ctx.reply(
          `⚠️ *Could not process voice note:* ${this.escapeMd(err.message)}`,
          { parse_mode: 'Markdown', reply_markup: failKeyboard },
        );
      }
    });

    // Main text message handler
    this.bot.on('message:text', async (ctx) => {
      const text = ctx.message.text?.trim();
      if (!text) return;
      if (text.startsWith('/')) return;

      const from = ctx.from;
      if (!from) return;

      const user = await this.transactionService.getOrCreateUser(
        from.id,
        from.username,
        from.first_name,
        from.last_name,
      );

      const cleanText = text.trim();

      if (cleanText === '📅 Today' || cleanText.toLowerCase() === 'today') {
        await this.showTodaySummary(ctx, user);
        return;
      }
      if (cleanText === '🗓️ Month' || cleanText.toLowerCase() === 'month') {
        await this.showMonthSummary(ctx, user);
        return;
      }
      if (cleanText.includes('Pulse') || cleanText.toLowerCase() === 'pulse') {
        await this.showPulseScore(ctx, user);
        return;
      }
      if (cleanText.includes('History') || cleanText.toLowerCase() === 'history') {
        await this.showTransactionHistory(ctx, user, 1);
        return;
      }
      if (cleanText === '🎯 Budget' || cleanText.toLowerCase() === 'budget') {
        await this.showInteractiveBudgetDashboard(ctx, user);
        return;
      }
      if (cleanText === '📊 Report' || cleanText.toLowerCase() === 'report') {
        await this.showReportSummary(ctx, user);
        return;
      }
      if (cleanText.includes('Mini App') || cleanText.includes('Dashboard') || cleanText.toLowerCase() === 'dashboard') {
        await this.showDashboard(ctx);
        return;
      }
      if (cleanText === '📘 Help' || cleanText.toLowerCase() === 'help') {
        await this.showHelp(ctx);
        return;
      }

      await this.processTextMessage(ctx, text);
    });

    // Telegram Photo Receipt OCR Handler (Gemini Vision)
    this.bot.on('message:photo', async (ctx) => {
      const from = ctx.from;
      if (!from) return;

      const photos = ctx.message.photo;
      if (!photos || photos.length === 0) return;

      const photo = photos[photos.length - 1];

      await ctx.replyWithChatAction('upload_photo').catch(() => {});
      await ctx.reply(
        `🔍 *Scanning receipt with AI Vision...*\nPlease hold on a moment.`,
        { parse_mode: 'Markdown' },
      );

      try {
        const file = await ctx.api.getFile(photo.file_id);
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const fileUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;

        const imageRes = await axios.get(fileUrl, {
          responseType: 'arraybuffer',
        });
        const base64Image = Buffer.from(imageRes.data, 'binary').toString(
          'base64',
        );

        const scanned =
          await ReceiptVisionService.scanReceiptImage(base64Image);
        if (!scanned || scanned.amount <= 0) {
          const failKeyboard = new InlineKeyboard().text(
            '🔙 Back to Main Menu',
            'cmd_menu',
          );
          await ctx.reply(
            `⚠️ Could not detect a clear receipt total or merchant. Please ensure the bill amount is clearly visible and try again.`,
            { reply_markup: failKeyboard },
          );
          return;
        }

        const user = await this.transactionService.getOrCreateUser(
          from.id,
          from.username,
          from.first_name,
          from.last_name,
        );

        let msg = `🧾 *Receipt Scanned Successfully!*\n\n`;
        msg += `🏪 *Merchant:* ${this.escapeMd(scanned.merchant)}\n`;
        msg += `💵 *Total Amount:* ${user.currency} ${scanned.amount.toLocaleString()}\n`;
        msg += `🏷️ *Category:* ${this.escapeMd(scanned.category)}\n`;
        msg += `🗓️ *Date:* ${scanned.transactionDate.toISOString().split('T')[0]}\n`;

        if (scanned.items && scanned.items.length > 0) {
          msg += `\n📦 *Items Detected:*\n`;
          scanned.items.slice(0, 5).forEach((item) => {
            msg += `• ${this.escapeMd(item.name)}: ${user.currency}${item.price}\n`;
          });
        }

        const { transaction, budgetAlert } =
          await this.transactionService.recordParsedTransaction(from.id, {
            type: 'EXPENSE',
            amount: scanned.amount,
            currency: scanned.currency,
            merchant: scanned.merchant,
            category: scanned.category,
            description: scanned.description,
            transactionDate: scanned.transactionDate,
            splitCount: 1,
            rawText: `Scanned receipt: ${scanned.merchant} ${scanned.amount}`,
            parsedBy: 'LLM',
            confidence: 0.95,
          });

        if (budgetAlert) {
          msg += `\n📊 *Budget Alert (${this.escapeMd(budgetAlert.categoryName)}):* ${user.currency}${budgetAlert.currentSpent.toLocaleString()} / ${budgetAlert.monthlyLimit.toLocaleString()} (${budgetAlert.usedPercentage}%)`;
        }

        const keyboard = new InlineKeyboard()
          .text('🏷️ Change Category', `change_cat_${transaction.id}`)
          .text('❌ Delete', `delete_${transaction.id}`)
          .row()
          .text('🔙 Back to Main Menu', 'cmd_menu');

        await ctx.reply(msg, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
      } catch (err: any) {
        this.logger.error(
          `Error processing photo receipt: ${err.message}`,
          err.stack,
        );
        const errorKeyboard = new InlineKeyboard().text(
          '🔙 Back to Main Menu',
          'cmd_menu',
        );
        await ctx.reply(
          `⚠️ Failed to process receipt image: ${this.escapeMd(err.message)}`,
          { reply_markup: errorKeyboard },
        );
      }
    });
  }

  // --- CORE NLU TEXT / AUDIO PROCESSOR ---

    private async processTextMessage(ctx: any, text: string) {
    const from = ctx.from;
    if (!from) return;

    const user = await this.transactionService.getOrCreateUser(
      from.id,
      from.username,
      from.first_name,
      from.last_name,
    );

    await ctx.replyWithChatAction('typing').catch(() => {});

    try {
      const intentResult = await this.nluService.processUserInput(
        user.id,
        text,
      );

      // Case A: Batch / Multiple Transactions (e.g. "Lunch 200, tea 40, cab 180")
      if (intentResult.transactions && intentResult.transactions.length > 1) {
        let totalBatchSpend = 0;
        let batchMsg = `🧾 *Recorded ${intentResult.transactions.length} Expenses in Batch:*\n\n`;

        for (let i = 0; i < intentResult.transactions.length; i++) {
          const parsed = intentResult.transactions[i];
          const { transaction } =
            await this.transactionService.recordParsedTransaction(
              from.id,
              parsed,
            );
          const typeEmoji = transaction.type === 'INCOME' ? '🟢' : '💸';
          const amt = Number(transaction.amount);
          if (transaction.type === 'EXPENSE') totalBatchSpend += amt;

          batchMsg += `${i + 1}. ${typeEmoji} *${this.escapeMd(transaction.description || transaction.merchant || 'Expense')}*: ${user.currency} ${amt.toLocaleString()} (${this.escapeMd(parsed.category)})\n`;
        }

        batchMsg += `\n💰 *Total Batch Outlay:* ${user.currency} ${totalBatchSpend.toLocaleString()}\n⚡ *Parsed By:* REGEX BATCH`;

        const batchKeyboard = new InlineKeyboard()
          .text('📅 Today Summary', 'cmd_today')
          .text('🗓️ Month View', 'cmd_month')
          .row()
          .text('🔙 Back to Main Menu', 'cmd_menu');

        await ctx.reply(batchMsg, {
          parse_mode: 'Markdown',
          reply_markup: batchKeyboard,
        });
        return;
      }

      // Case B: Single Transaction extracted
      if (intentResult.transactions && intentResult.transactions.length === 1) {
        const parsed = intentResult.transactions[0];
        const isDuplicate = await this.analyticsService.detectDuplicate(
          user.id,
          parsed.amount,
          parsed.merchant || parsed.description,
        );

        const { transaction, budgetAlert } =
          await this.transactionService.recordParsedTransaction(
            from.id,
            parsed,
          );

        const typeEmoji = transaction.type === 'INCOME' ? '🟢' : '💸';
        const catEmoji = this.getCategoryEmoji(parsed.category);
        let responseText = `${typeEmoji} *Recorded ${transaction.type === 'INCOME' ? 'Income' : 'Expense'}*\n\n`;
        if (isDuplicate) {
          responseText =
            `⚠️ *Possible Duplicate Transaction*\n*(Similar entry recorded within the last 30 minutes)*\n\n` +
            responseText;
        }

        responseText += `💰 *Amount:* ${transaction.currency} ${Number(transaction.amount).toLocaleString()}`;
        if (transaction.originalAmount && transaction.currency !== user.currency) {
          responseText += ` *(Original: ${parsed.currency} ${Number(transaction.originalAmount).toLocaleString()})*`;
        }
        responseText += `\n${catEmoji} *Category:* ${this.escapeMd(parsed.category)}`;
        if (transaction.merchant)
          responseText += `\n🏪 *Merchant:* ${this.escapeMd(transaction.merchant)}`;
        if (transaction.description)
          responseText += `\n📝 *Description:* ${this.escapeMd(transaction.description)}`;
        responseText += `\n⚡ *Parsed By:* ${transaction.parsedBy}`;

        // Check if category has an active monthly budget and render visual gauge
        const now = new Date();
        const existingCatBudget = await this.prisma.budget.findFirst({
          where: {
            userId: user.id,
            month: now.getMonth() + 1,
            year: now.getFullYear(),
            category: { name: { equals: parsed.category, mode: 'insensitive' } },
          },
        });

        if (existingCatBudget) {
          const limit = Number(existingCatBudget.monthlyLimit);
          const spentRes = await this.prisma.transaction.aggregate({
            where: {
              userId: user.id,
              isDeleted: false,
              type: 'EXPENSE',
              categoryId: existingCatBudget.categoryId,
              transactionDate: { gte: startOfMonth(now), lte: endOfMonth(now) },
            },
            _sum: { amount: true },
          });
          const catSpent = Number(spentRes._sum.amount || 0);
          const pct = Math.round((catSpent / limit) * 100);
          const bar = this.renderProgressBar(pct, 10);
          responseText += `\n\n━━━━━━━━━━━━━━━━━━━━\n🎯 *${this.escapeMd(parsed.category)} Budget:* ${user.currency} ${catSpent.toLocaleString()} / ${user.currency} ${limit.toLocaleString()} (${pct}%)\n[${bar}]`;
          const remaining = limit - catSpent;
          if (remaining > 0) {
            responseText += `\n💡 ${user.currency} ${remaining.toLocaleString()} left this month`;
          } else {
            responseText += `\n🚨 *Limit exceeded by ${user.currency} ${Math.abs(remaining).toLocaleString()}!*`;
          }
        } else if (budgetAlert) {
          responseText += `\n\n📊 *Budget Update (${this.escapeMd(budgetAlert.categoryName)}):* ${user.currency} ${budgetAlert.currentSpent.toLocaleString()} / ${user.currency} ${budgetAlert.monthlyLimit.toLocaleString()} (${budgetAlert.usedPercentage}%)`;
        }

        const keyboard = new InlineKeyboard();
        keyboard
          .text('🏷️ Change Category', `change_cat_${transaction.id}`)
          .text('🗑️ Delete', `delete_${transaction.id}`)
          .row()
          .text('💓 Pulse Score', 'cmd_pulse')
          .text('🔙 Main Menu', 'cmd_menu');

        await ctx.reply(responseText, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
        return;
      }

      // Case C: Direct AI Query / Tool Result formatting
      if (intentResult.toolResult) {
        const tool = intentResult.toolResult;
        if (intentResult.intent === 'QUERY_EXPENSE_SUMMARY') {
          let msg = `📊 *Expense Summary (${this.escapeMd(tool.period)})*\n\n`;
          msg += `💸 *Total Expenses:* ${user.currency} ${tool.totalExpense.toLocaleString()}\n`;
          msg += `💰 *Total Income:* ${user.currency} ${tool.totalIncome.toLocaleString()}\n`;
          msg += `📈 *Net Savings:* ${user.currency} ${tool.netSavings.toLocaleString()}\n`;
          msg += `🔢 *Count:* ${tool.transactionCount}`;
          const keyboard = new InlineKeyboard()
            .text('📅 Today', 'cmd_today')
            .text('🗓️ Month', 'cmd_month')
            .row()
            .text('🔙 Back to Main Menu', 'cmd_menu');
          await ctx.reply(msg, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          });
          return;
        }

        if (intentResult.intent === 'QUERY_CATEGORY_SPENDING') {
          const keyboard = new InlineKeyboard()
            .text('🎯 Check Budget', 'cmd_budget')
            .text('🔙 Back to Main Menu', 'cmd_menu');
          await ctx.reply(
            `🏷️ *${this.escapeMd(tool.category)} Spending (${this.escapeMd(tool.period)}):*\n\n💸 Total Outlay: *${user.currency} ${tool.spent.toLocaleString()}*`,
            { parse_mode: 'Markdown', reply_markup: keyboard },
          );
          return;
        }

        if (intentResult.intent === 'QUERY_TOP_EXPENSES') {
          let msg = `🏆 *Top Highest Expenses:*\n\n`;
          (tool as any[]).forEach((t, i) => {
            msg += `${i + 1}. *${this.escapeMd(t.merchant)}* (${this.escapeMd(t.category)}): ${user.currency} ${Number(t.amount).toLocaleString()} on ${t.date}\n`;
          });
          const keyboard = new InlineKeyboard()
            .text('🗓️ Month Overview', 'cmd_month')
            .text('🔙 Back to Main Menu', 'cmd_menu');
          await ctx.reply(msg, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          });
          return;
        }

        if (intentResult.intent === 'CREATE_RECURRING' || tool.recurring) {
          const keyboard = new InlineKeyboard()
            .text('🔁 View Recurring', 'cmd_recurring')
            .text('🔙 Back to Main Menu', 'cmd_menu');
          await ctx.reply(
            `🔁 *Recurring Schedule Created!*\n\n📌 *${this.escapeMd(tool.name)}*: ${user.currency} ${Number(tool.amount).toLocaleString()}\n🗓️ *Scheduled Day:* Every ${tool.day}th of the month\n🗓️ *Next Auto-Run:* ${tool.nextRun}`,
            { parse_mode: 'Markdown', reply_markup: keyboard },
          );
          return;
        }
      }

      // Case D: Conversational reply
      if (intentResult.replyText) {
        const keyboard = new InlineKeyboard()
          .text('📅 Today', 'cmd_today')
          .text('🗓️ Month', 'cmd_month')
          .row()
          .text('🎯 Budget', 'cmd_budget')
          .text('🔙 Back to Main Menu', 'cmd_menu');
        await ctx.reply(intentResult.replyText, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
        return;
      }

      const fallbackKeyboard = new InlineKeyboard()
        .text('📅 Today', 'cmd_today')
        .text('🗓️ Month', 'cmd_month')
        .row()
        .text('🎯 Budget', 'cmd_budget')
        .text('🔙 Back to Main Menu', 'cmd_menu');
      await ctx.reply(
        `🤔 Couldn't detect an amount or intent. Try: "Coffee 180" or "How much did I spend on food this month?"`,
        { reply_markup: fallbackKeyboard },
      );
    } catch (err: any) {
      this.logger.error(`Error processing message: ${err.message}`, err.stack);
      const errorKeyboard = new InlineKeyboard().text(
        '🔙 Back to Main Menu',
        'cmd_menu',
      );
      await ctx.reply(
        `⚠️ Could not process message: ${this.escapeMd(err.message)}`,
        { reply_markup: errorKeyboard },
      );
    }
  }

  public async sendMessage(telegramId: number | string, message: string) {
    if (!this.bot || !process.env.TELEGRAM_BOT_TOKEN) {
      this.logger.warn(
        `Skipping Telegram message to ${telegramId}: Bot token not set.`,
      );
      return;
    }
    try {
      await this.bot.api.sendMessage(telegramId, message, {
        parse_mode: 'Markdown',
      });
    } catch (err) {
      this.logger.error(
        `Failed to send Telegram message to ${telegramId}:`,
        err,
      );
    }
  }

  @OnEvent('budget.alert')
  async handleBudgetAlertEvent(payload: {
    telegramId: string;
    categoryName: string;
    monthlyLimit: number;
    currentSpent: number;
    usedPercentage: number;
    remaining: number;
    isExceeded: boolean;
    currency: string;
  }) {
    const icon = payload.isExceeded ? '🚨' : '⚠️';
    const statusText = payload.isExceeded
      ? 'BUDGET EXCEEDED'
      : 'NEAR BUDGET LIMIT';
    const alertMsg = `${icon} *${statusText}*\n\n📌 *Category:* ${this.escapeMd(payload.categoryName)}\n💵 *Spent:* ${payload.currency}${payload.currentSpent.toLocaleString()} / ${payload.currency}${payload.monthlyLimit.toLocaleString()} (${payload.usedPercentage}%)\n${payload.isExceeded ? `⚠️ Over limit by ${payload.currency}${Math.abs(payload.remaining).toLocaleString()}` : `💡 Remaining: ${payload.currency}${payload.remaining.toLocaleString()}`}`;

    await this.sendMessage(payload.telegramId, alertMsg);
  }

  @OnEvent('recurring.auto_posted')
  async handleRecurringPostedEvent(payload: {
    telegramId: string;
    description: string;
    amount: number;
    categoryName: string;
    currency: string;
    type: string;
    nextRun: string;
  }) {
    const typeEmoji = payload.type === 'INCOME' ? '💰' : '💸';
    const msg = `${typeEmoji} *Recurring Payment Auto-Recorded*\n\n📌 *${this.escapeMd(payload.description)}*\n💵 *Amount:* ${payload.currency} ${payload.amount.toLocaleString()}\n🏷️ *Category:* ${this.escapeMd(payload.categoryName)}\n🗓️ *Next Schedule:* ${payload.nextRun}`;
    await this.sendMessage(payload.telegramId, msg);
  }

  @OnEvent('weekly.digest.ready')
  async handleWeeklyDigestEvent(payload: {
    telegramId: string;
    message: string;
  }) {
    await this.sendMessage(payload.telegramId, payload.message);
  }

  // --- AUTOMATED 9:00 PM DAILY EVENING CHECK-IN CRON ---
  @Cron('0 21 * * *')
  async handleDailyEveningCheckIn() {
    this.logger.log('Running 9:00 PM Evening Check-In Cron...');
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);

    const usersWithTelegram = await this.prisma.user.findMany({
      where: { telegramId: { not: null } },
      select: { id: true, telegramId: true, firstName: true },
    });

    for (const u of usersWithTelegram) {
      if (!u.telegramId) continue;
      const countToday = await this.prisma.transaction.count({
        where: {
          userId: u.id,
          isDeleted: false,
          transactionDate: { gte: todayStart, lte: todayEnd },
        },
      });

      // If user has not logged any transaction today, send gentle reminder
      if (countToday === 0) {
        const name = this.escapeMd(u.firstName || 'there');
        const reminder = `🌙 *Daily Evening Check-in*\n\nHey ${name}! You haven't recorded any expenses today.\n\nDid you spend on anything today (food, groceries, commute, tea, shopping)?\n\n💬 *Just send a quick text or voice note:* e.g. \`Tea 20\` or \`Dinner 250\``;
        await this.sendMessage(u.telegramId, reminder);
      }
    }
  }

  // --- INTERACTIVE VISUAL BUDGET DASHBOARD HELPERS ---

  private async showInteractiveBudgetDashboard(
    ctx: any,
    user: any,
    isEdit = false,
  ) {
    const now = new Date();
    const monthName = now.toLocaleString('en-US', { month: 'long' });
    const budgets = await this.prisma.budget.findMany({
      where: {
        userId: user.id,
        month: now.getMonth() + 1,
        year: now.getFullYear(),
      },
      include: { category: true },
    });

    const summary = await this.analyticsService.getSummaryReport(
      user.id,
      'month',
    );

    let msg = `🎯 *Budget Control Center (${monthName} ${now.getFullYear()})*\n\n`;
    const keyboard = new InlineKeyboard();

    if (budgets.length === 0) {
      msg += `You haven't configured any category budgets yet.\nTap below to set your first limit:`;
      keyboard.text('➕ Set a Category Budget', 'bgt_pick_cat').row();
    } else {
      budgets.forEach((b) => {
        const spent = summary.categoryBreakdown[b.category.name] || 0;
        const limit = Number(b.monthlyLimit);
        const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
        const status =
          pct >= 100 ? '🚨 Over' : pct >= 80 ? '⚠️ Warning' : '✅ Good';

        const filled = Math.min(10, Math.round(pct / 10));
        const empty = Math.max(0, 10 - filled);
        const bar = '■'.repeat(filled) + '□'.repeat(empty);

        msg += `🏷️ *${this.escapeMd(b.category.name)}*\n   \`[${bar}]\` ${pct}%\n   ${user.currency}${spent.toLocaleString()} / ${user.currency}${limit.toLocaleString()} • ${status}\n\n`;

        keyboard
          .text(
            `⚙️ ${b.category.name} (${user.currency}${limit.toLocaleString()})`,
            `bgt_edit_${b.category.name}`,
          )
          .row();
      });

      keyboard
        .text('➕ Add Category Budget', 'bgt_pick_cat')
        .text('🔄 Refresh', 'bgt_refresh')
        .row();
    }

    keyboard.text('🔙 Back to Main Menu', 'cmd_menu');

    if (isEdit) {
      try {
        await ctx.editMessageText(msg, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
        return;
      } catch (_) {}
    }
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: keyboard });
  }

  private async showBudgetCategoryPicker(ctx: any, user: any) {
    const categories = await this.prisma.category.findMany({
      where: { userId: user.id },
      orderBy: { name: 'asc' },
    });

    const defaultCatNames = [
      'Food & Dining',
      'Groceries',
      'Shopping',
      'Travel & Fuel',
      'Bills & Utilities',
      'Entertainment',
    ];
    const existingNames = new Set(categories.map((c) => c.name));
    const allNames = Array.from(
      new Set([...existingNames, ...defaultCatNames]),
    );

    const keyboard = new InlineKeyboard();
    let rowCount = 0;
    for (const name of allNames) {
      keyboard.text(name, `bgt_edit_${name}`);
      rowCount++;
      if (rowCount % 2 === 0) keyboard.row();
    }

    if (rowCount % 2 !== 0) keyboard.row();
    keyboard
      .text('🔙 Back to Budgets', 'cmd_budget')
      .text('🏠 Main Menu', 'cmd_menu');

    const text = `🎯 *Select Category to Set / Edit Limit:*\nChoose one of the categories below:`;
    try {
      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
  }

  private async showBudgetAmountSelector(
    ctx: any,
    user: any,
    catName: string,
    isEdit = false,
  ) {
    const now = new Date();
    const existing = await this.prisma.budget.findFirst({
      where: {
        userId: user.id,
        month: now.getMonth() + 1,
        year: now.getFullYear(),
        category: { name: { equals: catName, mode: 'insensitive' } },
      },
    });

    const currentLimit = existing ? Number(existing.monthlyLimit) : 0;
    const summary = await this.analyticsService.getSummaryReport(
      user.id,
      'month',
    );
    const spent = summary.categoryBreakdown[catName] || 0;

    let text = `⚙️ *Budget Settings for ${this.escapeMd(catName)}*\n\n`;
    text += `💵 *Current Limit:* ${currentLimit > 0 ? `${user.currency} ${currentLimit.toLocaleString()}` : 'Not set'}\n`;
    text += `💸 *Spent this Month:* ${user.currency} ${spent.toLocaleString()}\n\n`;
    text += `👇 *Tap quick amount or use adjusters:*`;

    const keyboard = new InlineKeyboard()
      .text('₹2,000', `bgt_set_${catName}:2000`)
      .text('₹5,000', `bgt_set_${catName}:5000`)
      .text('₹10,000', `bgt_set_${catName}:10000`)
      .row()
      .text('₹15,000', `bgt_set_${catName}:15000`)
      .text('₹20,000', `bgt_set_${catName}:20000`)
      .text('₹30,000', `bgt_set_${catName}:30000`)
      .row()
      .text('➖ ₹1,000', `bgt_adj_${catName}:-1000`)
      .text('➕ ₹1,000', `bgt_adj_${catName}:1000`)
      .row();

    if (existing) {
      keyboard.text('🗑️ Remove Limit', `bgt_del_${catName}`).row();
    }
    keyboard
      .text('🔙 Back to Budgets', 'cmd_budget')
      .text('🏠 Main Menu', 'cmd_menu');

    if (isEdit) {
      try {
        await ctx.editMessageText(text, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
        return;
      } catch (_) {}
    }
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }

  public getBot() {
    return this.bot;
  }
}
