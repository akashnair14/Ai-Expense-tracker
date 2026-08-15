import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Bot, InlineKeyboard } from 'grammy';
import axios from 'axios';
import { NluService } from '../nlu/nlu.service';
import { TransactionService } from '../transactions/transaction.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { ReceiptVisionService } from '../nlu/services/receipt-vision.service';

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
  ) {

    const token = process.env.TELEGRAM_BOT_TOKEN || 'MOCK_TELEGRAM_TOKEN';
    this.bot = new Bot(token);
  }

  async onModuleInit() {
    this.bot.catch((err) => {
      this.logger.error(`Telegram Bot Error: ${err.message}`, err.stack);
    });

    this.registerHandlers();
    
    // Set native Telegram Menu button commands
    if (process.env.TELEGRAM_BOT_TOKEN) {
      try {
        await this.bot.api.setMyCommands([
          { command: 'today', description: "📅 View today's financial summary" },
          { command: 'month', description: "🗓️ Current month breakdown" },
          { command: 'budget', description: "🎯 Interactive budget control center" },
          { command: 'recurring', description: "🔁 Scheduled & recurring expenses" },
          { command: 'dashboard', description: "💻 Open web dashboard & QR login" },
          { command: 'undo', description: "🗑️ Undo last recorded entry" },
          { command: 'help', description: "📘 Quick user guide & examples" },
        ]);
      } catch (e: any) {
        this.logger.warn(`Could not register Telegram bot menu commands: ${e.message}`);
      }
    }

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
    // /start command & QR scan deep-linking
    this.bot.command('start', async (ctx) => {
      const payload = ctx.match; // captures start parameter e.g. qr_xyz
      const name = ctx.from?.first_name || 'Friend';

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
          await ctx.reply(`✅ **Login Approved!**\n\nYour laptop/desktop browser has been instantly authenticated. You can now access your full dashboard on the big screen!`, { parse_mode: 'Markdown' });
          return;
        } else {
          await ctx.reply(`⚠️ This QR login session has expired or is invalid. Please refresh the QR code on your computer screen.`);
          return;
        }
      }

      const welcomeText = `👋 Hello **${name}**!\n\nWelcome to your **PulseAI Personal Finance Assistant**.\n\n💬 **Simply send any message:**\n• \`Coffee 180\`\n• \`Paid ₹1,200 for groceries\`\n• \`Salary +65000\`\n• \`Dinner 1800 split by 3\`\n\n⚡ **Quick Commands:**\n/today • Today's summary\n/month • Monthly overview\n/budget • Check & set budgets\n/recurring • Scheduled payments\n/dashboard • Web dashboard login link\n/undo • Remove last entry\n/help • Guide`;

      const appUrl = process.env.APP_URL;
      const quickKeyboard = new InlineKeyboard()
        .text('📅 Today', 'cmd_today')
        .text('🗓️ Month', 'cmd_month')
        .row()
        .text('📊 Budget', 'cmd_budget')
        .text('🔁 Recurring', 'cmd_recurring')
        .row();

      if (appUrl && appUrl.startsWith('https://')) {
        quickKeyboard.url('💻 Open Web Dashboard', appUrl);
      } else {
        quickKeyboard.text('💻 Web Dashboard', 'cmd_dashboard');
      }

      await ctx.reply(welcomeText, { parse_mode: 'Markdown', reply_markup: quickKeyboard });
    });

    // /dashboard command
    this.bot.command('dashboard', async (ctx) => {
      const appUrl = process.env.APP_URL || 'https://ai-expense-tracker-o5a3.onrender.com';
      const keyboard = new InlineKeyboard().url('🚀 Open Web Dashboard', appUrl);

      await ctx.reply(`💻 **Web Dashboard Access**\n\nOpen your financial dashboard on your browser or laptop:\n${appUrl}\n\nScan the on-screen QR code with your phone camera to log in instantly without passwords!`, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    });

    // /budget command with Interactive Visual Menu
    this.bot.command('budget', async (ctx) => {
      if (!ctx.from) return;
      const user = await this.transactionService.getOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name, ctx.from.last_name);
      const text = ctx.message?.text || '';
      const args = text.replace('/budget', '').trim();

      // If user provided quick inline args (e.g. /budget Food 8000), handle it directly
      if (args) {
        const match = args.match(/^(.+?)\s+(?:₹|Rs\.?)?\s*(\d+(?:\.\d+)?)$/i);
        if (match) {
          const catName = match[1].trim();
          const limit = parseFloat(match[2]);
          await this.transactionService.setBudgetLimit(user.id, catName, limit);
          await ctx.reply(`✅ **Budget Limit Set!**\n\n🎯 **${catName}**: ${user.currency} ${limit.toLocaleString()} / month\nYou'll receive proactive alerts at 80% and 100% capacity.`, { parse_mode: 'Markdown' });
          return;
        }
      }

      // Otherwise, show the Interactive Visual Budget Center
      await this.showInteractiveBudgetDashboard(ctx, user);
    });

    // Callback Query Handler for Interactive UI (Buttons / Adjusters / Toggles)
    this.bot.on('callback_query:data', async (ctx) => {
      const data = ctx.callbackQuery.data;
      if (!ctx.from) return;
      const user = await this.transactionService.getOrCreateUser(ctx.from.id);

      if (data === 'cmd_today') {
        const summary = await this.analyticsService.getSummaryReport(user.id, 'today');
        let text = `📅 **Today's Summary**\n\n💸 Expenses: ${user.currency} ${summary.totalExpense}\n💰 Income: ${user.currency} ${summary.totalIncome}\n📊 Net: ${user.currency} ${summary.netSavings}\n🔢 Transactions: ${summary.transactionCount}`;
        await ctx.answerCallbackQuery();
        await ctx.reply(text, { parse_mode: 'Markdown' });
      } else if (data === 'cmd_month') {
        const summary = await this.analyticsService.getSummaryReport(user.id, 'month');
        let text = `🗓️ **Monthly Overview**\n\n💸 Expenses: ${user.currency} ${summary.totalExpense}\n💰 Income: ${user.currency} ${summary.totalIncome}\n📊 Net Savings: ${user.currency} ${summary.netSavings}\n🔢 Count: ${summary.transactionCount}`;
        await ctx.answerCallbackQuery();
        await ctx.reply(text, { parse_mode: 'Markdown' });
      } else if (data === 'cmd_budget' || data === 'bgt_refresh') {
        await ctx.answerCallbackQuery();
        await this.showInteractiveBudgetDashboard(ctx, user, true);
      } else if (data === 'bgt_pick_cat') {
        await ctx.answerCallbackQuery();
        await this.showBudgetCategoryPicker(ctx, user);
      } else if (data.startsWith('bgt_edit_')) {
        const catName = data.replace('bgt_edit_', '');
        await ctx.answerCallbackQuery();
        await this.showBudgetAmountSelector(ctx, user, catName);
      } else if (data.startsWith('bgt_set_')) {
        // e.g. bgt_set_Food:5000
        const parts = data.replace('bgt_set_', '').split(':');
        const catName = parts[0];
        const amount = parseFloat(parts[1]);

        await this.transactionService.setBudgetLimit(user.id, catName, amount);
        await ctx.answerCallbackQuery({ text: `✅ ${catName} budget set to ${user.currency}${amount.toLocaleString()}` });
        await this.showInteractiveBudgetDashboard(ctx, user, true);
      } else if (data.startsWith('bgt_adj_')) {
        // e.g. bgt_adj_Food:+1000 or bgt_adj_Food:-1000
        const parts = data.replace('bgt_adj_', '').split(':');
        const catName = parts[0];
        const delta = parseFloat(parts[1]);

        const now = new Date();
        const existingBudget = await this.prisma.budget.findFirst({
          where: { userId: user.id, month: now.getMonth() + 1, year: now.getFullYear(), category: { name: { equals: catName, mode: 'insensitive' } } },
        });

        const currentLimit = existingBudget ? Number(existingBudget.monthlyLimit) : 5000;
        const newLimit = Math.max(500, currentLimit + delta);

        await this.transactionService.setBudgetLimit(user.id, catName, newLimit);
        await ctx.answerCallbackQuery({ text: `Updated to ${user.currency}${newLimit.toLocaleString()}` });
        await this.showBudgetAmountSelector(ctx, user, catName, true);
      } else if (data.startsWith('bgt_del_')) {
        const catName = data.replace('bgt_del_', '');
        const now = new Date();
        await this.prisma.budget.deleteMany({
          where: { userId: user.id, month: now.getMonth() + 1, year: now.getFullYear(), category: { name: { equals: catName, mode: 'insensitive' } } },
        });
        await ctx.answerCallbackQuery({ text: `Removed budget for ${catName}` });
        await this.showInteractiveBudgetDashboard(ctx, user, true);
      } else if (data === 'cmd_recurring') {
        await ctx.answerCallbackQuery();
        await ctx.reply(`🔁 **Manage Recurring Payments**\n\nTo schedule automatic income or expense, use:\n\`/recurring Rent 15000 on 1st\`\n\`/recurring Salary 65000 income on 30th\`\n\`/recurring SIP 5000 on 5th\``, { parse_mode: 'Markdown' });
      } else if (data === 'cmd_dashboard') {
        await ctx.answerCallbackQuery();
        const appUrl = process.env.APP_URL || 'https://ai-expense-tracker-o5a3.onrender.com';
        const keyboard = new InlineKeyboard().url('🚀 Open Web Dashboard', appUrl);
        await ctx.reply(`💻 **Web Dashboard Access**\n\nOpen your financial dashboard on your browser or laptop:\n${appUrl}\n\nScan the on-screen QR code to log in instantly without passwords!`, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
      } else if (data.startsWith('change_cat_')) {
        // change_cat_<txId>
        const txId = data.replace('change_cat_', '');
        const categories = await this.prisma.category.findMany({
          where: { userId: user.id },
          orderBy: { name: 'asc' },
        });

        let defaultCatNames = ['Food & Dining', 'Groceries', 'Shopping', 'Travel & Fuel', 'Bills & Utilities', 'Entertainment'];
        const existingNames = new Set(categories.map(c => c.name));
        const allNames = Array.from(new Set([...existingNames, ...defaultCatNames]));

        const keyboard = new InlineKeyboard();
        let count = 0;
        for (const name of allNames) {
          keyboard.text(name, `set_tx_cat_${txId}:${name}`);
          count++;
          if (count % 2 === 0) keyboard.row();
        }
        if (count % 2 !== 0) keyboard.row();
        keyboard.text('🔙 Cancel', `cancel_cat_${txId}`);

        await ctx.answerCallbackQuery();
        await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
      } else if (data.startsWith('set_tx_cat_')) {
        // set_tx_cat_<txId>:<catName>
        const rest = data.replace('set_tx_cat_', '');
        const parts = rest.split(':');
        const txId = parts[0];
        const newCatName = parts.slice(1).join(':');

        let category = await this.prisma.category.findFirst({
          where: { userId: user.id, name: { equals: newCatName, mode: 'insensitive' } },
        });

        if (!category) {
          category = await this.prisma.category.create({
            data: { userId: user.id, name: newCatName, type: 'EXPENSE' },
          });
        }

        await this.prisma.transaction.update({
          where: { id: txId },
          data: { categoryId: category.id },
        });

        await ctx.answerCallbackQuery({ text: `🏷️ Category changed to ${newCatName}` });

        const resetKeyboard = new InlineKeyboard()
          .text('🏷️ Change Category', `change_cat_${txId}`)
          .text('❌ Delete', `delete_${txId}`);

        try {
          await ctx.editMessageReplyMarkup({ reply_markup: resetKeyboard });
        } catch (_) {}
      } else if (data.startsWith('cancel_cat_')) {
        const txId = data.replace('cancel_cat_', '');
        const resetKeyboard = new InlineKeyboard()
          .text('🏷️ Change Category', `change_cat_${txId}`)
          .text('❌ Delete', `delete_${txId}`);

        await ctx.answerCallbackQuery();
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
          await ctx.answerCallbackQuery({ text: '🗑️ Transaction deleted' });
          await ctx.editMessageText(`🗑️ *This transaction has been deleted.*`, { parse_mode: 'Markdown' });
        } catch (err: any) {
          await ctx.answerCallbackQuery({ text: 'Could not delete entry' });
        }
      }
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


    // Main text message handler for natural language transactions & AI Intent Router
    this.bot.on('message:text', async (ctx) => {
      const text = ctx.message.text;
      if (text.startsWith('/')) return; // handled by commands

      const from = ctx.from;
      if (!from) return;

      try {
        const user = await this.transactionService.getOrCreateUser(from.id, from.username, from.first_name, from.last_name);
        
        // Step 1: Process input through Multi-Stage NLU & Intent/Tool Engine
        const intentResult = await this.nluService.processUserInput(user.id, text);

        // Case A: Transactions extracted (single or multi)
        if (intentResult.transactions && intentResult.transactions.length > 0) {
          for (const parsed of intentResult.transactions) {
            const isDuplicate = await this.analyticsService.detectDuplicate(user.id, parsed.amount, parsed.merchant || parsed.description);

            const { transaction, budgetAlert } = await this.transactionService.recordParsedTransaction(from.id, parsed);

            let responseText = `✅ **Recorded ${transaction.type === 'INCOME' ? 'Income' : 'Expense'}**\n\n`;
            if (isDuplicate) {
              responseText = `⚠️ **Possible Duplicate Transaction**\n*(Similar entry recorded within the last 30 minutes)*\n\n` + responseText;
            }

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
              .text('🏷️ Change Category', `change_cat_${transaction.id}`)
              .text('❌ Delete', `delete_${transaction.id}`);

            await ctx.reply(responseText, {
              parse_mode: 'Markdown',
              reply_markup: keyboard,
            });
          }
          return;
        }

        // Case B: Direct AI Query / Tool Result formatting
        if (intentResult.toolResult) {
          const tool = intentResult.toolResult;
          if (intentResult.intent === 'QUERY_EXPENSE_SUMMARY') {
            let msg = `📊 **Expense Summary (${tool.period})**\n\n`;
            msg += `💸 **Total Expenses:** ${user.currency} ${tool.totalExpense.toLocaleString()}\n`;
            msg += `💰 **Total Income:** ${user.currency} ${tool.totalIncome.toLocaleString()}\n`;
            msg += `📈 **Net Savings:** ${user.currency} ${tool.netSavings.toLocaleString()}\n`;
            msg += `🔢 **Count:** ${tool.transactionCount}`;
            await ctx.reply(msg, { parse_mode: 'Markdown' });
            return;
          }

          if (intentResult.intent === 'QUERY_CATEGORY_SPENDING') {
            await ctx.reply(`🏷️ **${tool.category} Spending (${tool.period}):**\n\n💸 Total Outlay: **${user.currency} ${tool.spent.toLocaleString()}**`, { parse_mode: 'Markdown' });
            return;
          }

          if (intentResult.intent === 'QUERY_TOP_EXPENSES') {
            let msg = `🏆 **Top Highest Expenses:**\n\n`;
            (tool as any[]).forEach((t, i) => {
              msg += `${i + 1}. **${t.merchant}** (${t.category}): ${user.currency} ${t.amount.toLocaleString()} on ${t.date}\n`;
            });
            await ctx.reply(msg, { parse_mode: 'Markdown' });
            return;
          }
        }

        // Case C: Conversational reply or correction
        if (intentResult.replyText) {
          await ctx.reply(intentResult.replyText, { parse_mode: 'Markdown' });
          return;
        }

        await ctx.reply(`🤔 Couldn't detect an amount or intent. Try: "Coffee 180" or "How much did I spend on food this month?"`);
      } catch (err: any) {
        this.logger.error(`Error processing message: ${err.message}`, err.stack);
        await ctx.reply(`⚠️ Could not process message: ${err.message}`);
      }
    });

    // Telegram Photo Receipt OCR Handler (Gemini Vision)
    this.bot.on('message:photo', async (ctx) => {
      const from = ctx.from;
      if (!from) return;

      const photos = ctx.message.photo;
      if (!photos || photos.length === 0) return;

      // Select highest resolution photo
      const photo = photos[photos.length - 1];

      await ctx.reply(`🔍 **Scanning receipt with AI Vision...**\nPlease hold on a moment.`);

      try {
        const file = await ctx.api.getFile(photo.file_id);
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const fileUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;

        // Fetch image as base64 buffer
        const imageRes = await axios.get(fileUrl, { responseType: 'arraybuffer' });
        const base64Image = Buffer.from(imageRes.data, 'binary').toString('base64');

        const scanned = await ReceiptVisionService.scanReceiptImage(base64Image);
        if (!scanned || scanned.amount <= 0) {
          await ctx.reply(`⚠️ Could not detect a clear receipt total or merchant. Please ensure the bill amount is clearly visible and try again.`);
          return;
        }

        const user = await this.transactionService.getOrCreateUser(from.id, from.username, from.first_name, from.last_name);

        let msg = `🧾 **Receipt Scanned Successfully!**\n\n`;
        msg += `🏪 **Merchant:** ${scanned.merchant}\n`;
        msg += `💵 **Total Amount:** ${user.currency} ${scanned.amount.toLocaleString()}\n`;
        msg += `🏷️ **Category:** ${scanned.category}\n`;
        msg += `🗓️ **Date:** ${scanned.transactionDate.toISOString().split('T')[0]}\n`;

        if (scanned.items && scanned.items.length > 0) {
          msg += `\n📦 **Items Detected:**\n`;
          scanned.items.slice(0, 5).forEach(item => {
            msg += `• ${item.name}: ${user.currency}${item.price}\n`;
          });
        }

        // Auto-record the verified receipt transaction
        const { transaction, budgetAlert } = await this.transactionService.recordParsedTransaction(from.id, {
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
          msg += `\n📊 **Budget Alert (${budgetAlert.categoryName}):** ${user.currency}${budgetAlert.currentSpent} / ${budgetAlert.monthlyLimit} (${budgetAlert.usedPercentage}%)`;
        }

        const keyboard = new InlineKeyboard()
          .text('🏷️ Change Category', `change_cat_${transaction.id}`)
          .text('❌ Delete', `delete_${transaction.id}`);

        await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: keyboard });
      } catch (err: any) {
        this.logger.error(`Error processing photo receipt: ${err.message}`, err.stack);
        await ctx.reply(`⚠️ Failed to process receipt image: ${err.message}`);
      }
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

  @OnEvent('weekly.digest.ready')
  async handleWeeklyDigestEvent(payload: { telegramId: string; message: string }) {
    await this.sendMessage(payload.telegramId, payload.message);
  }

  // --- INTERACTIVE VISUAL BUDGET DASHBOARD HELPERS ---

  private async showInteractiveBudgetDashboard(ctx: any, user: any, isEdit = false) {
    const now = new Date();
    const monthName = now.toLocaleString('en-US', { month: 'long' });
    const budgets = await this.prisma.budget.findMany({
      where: { userId: user.id, month: now.getMonth() + 1, year: now.getFullYear() },
      include: { category: true },
    });

    const summary = await this.analyticsService.getSummaryReport(user.id, 'month');

    let msg = `🎯 **Budget Control Center (${monthName} ${now.getFullYear()})**\n\n`;
    const keyboard = new InlineKeyboard();

    if (budgets.length === 0) {
      msg += `You haven't configured any category budgets yet.\nTap below to set your first limit:`;
      keyboard.text('➕ Set a Category Budget', 'bgt_pick_cat').row();
    } else {
      budgets.forEach((b) => {
        const spent = summary.categoryBreakdown[b.category.name] || 0;
        const limit = Number(b.monthlyLimit);
        const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
        const status = pct >= 100 ? '🚨 Over' : pct >= 80 ? '⚠️ Warning' : '✅ Good';

        // ASCII Progress bar (10 blocks)
        const filled = Math.min(10, Math.round(pct / 10));
        const empty = Math.max(0, 10 - filled);
        const bar = '■'.repeat(filled) + '□'.repeat(empty);

        msg += `🏷️ **${b.category.name}**\n   \`[${bar}]\` ${pct}%\n   ${user.currency}${spent.toLocaleString()} / ${user.currency}${limit.toLocaleString()} • ${status}\n\n`;

        keyboard.text(`⚙️ ${b.category.name} (${user.currency}${limit})`, `bgt_edit_${b.category.name}`).row();
      });

      keyboard.text('➕ Add Category Budget', 'bgt_pick_cat').text('🔄 Refresh', 'bgt_refresh').row();
    }

    if (isEdit) {
      try {
        await ctx.editMessageText(msg, { parse_mode: 'Markdown', reply_markup: keyboard });
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

    let defaultCatNames = ['Food & Dining', 'Groceries', 'Shopping', 'Travel & Fuel', 'Bills & Utilities', 'Entertainment'];
    const existingNames = new Set(categories.map(c => c.name));
    const allNames = Array.from(new Set([...existingNames, ...defaultCatNames]));

    const keyboard = new InlineKeyboard();
    let rowCount = 0;
    for (const name of allNames) {
      keyboard.text(name, `bgt_edit_${name}`);
      rowCount++;
      if (rowCount % 2 === 0) keyboard.row();
    }

    if (rowCount % 2 !== 0) keyboard.row();
    keyboard.text('🔙 Back to Budget Center', 'cmd_budget');

    const text = `🎯 **Select Category to Set / Edit Limit:**\nChoose one of the categories below:`;
    try {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    } catch (_) {
      await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
  }

  private async showBudgetAmountSelector(ctx: any, user: any, catName: string, isEdit = false) {
    const now = new Date();
    const existing = await this.prisma.budget.findFirst({
      where: { userId: user.id, month: now.getMonth() + 1, year: now.getFullYear(), category: { name: { equals: catName, mode: 'insensitive' } } },
    });

    const currentLimit = existing ? Number(existing.monthlyLimit) : 0;
    const summary = await this.analyticsService.getSummaryReport(user.id, 'month');
    const spent = summary.categoryBreakdown[catName] || 0;

    let text = `⚙️ **Budget Settings for ${catName}**\n\n`;
    text += `💵 **Current Limit:** ${currentLimit > 0 ? `${user.currency} ${currentLimit.toLocaleString()}` : 'Not set'}\n`;
    text += `💸 **Spent this Month:** ${user.currency} ${spent.toLocaleString()}\n\n`;
    text += `👇 **Tap quick amount or use adjusters:**`;

    const keyboard = new InlineKeyboard()
      // Quick preset buttons
      .text('₹2,000', `bgt_set_${catName}:2000`)
      .text('₹5,000', `bgt_set_${catName}:5000`)
      .text('₹10,000', `bgt_set_${catName}:10000`)
      .row()
      .text('₹15,000', `bgt_set_${catName}:15000`)
      .text('₹20,000', `bgt_set_${catName}:20000`)
      .text('₹30,000', `bgt_set_${catName}:30000`)
      .row()
      // Stepper adjusters (-1000, +1000, -500, +500)
      .text('➖ ₹1,000', `bgt_adj_${catName}:-1000`)
      .text('➕ ₹1,000', `bgt_adj_${catName}:1000`)
      .row();

    if (existing) {
      keyboard.text('🗑️ Remove Limit', `bgt_del_${catName}`).row();
    }
    keyboard.text('🔙 Back to Budgets', 'cmd_budget');

    if (isEdit) {
      try {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
        return;
      } catch (_) {}
    }
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }

  public getBot() {
    return this.bot;
  }
}


