import { Injectable, Logger } from '@nestjs/common';
import { ParsedTransaction } from './interfaces/nlu-parser.interface';
import { RegexParser } from './parsers/regex.parser';
import { CategoryDictionaryMapper } from './mappers/category-dictionary.mapper';
import { LlmIntentAdapter } from './adapters/llm-intent.adapter';
import { ConversationContextService } from './services/conversation-context.service';
import { ToolDispatcherService } from './services/tool-dispatcher.service';

export interface ProcessedIntentResult {
  intent: string;
  transactions?: ParsedTransaction[];
  toolResult?: any;
  replyText?: string;
  isCorrection?: boolean;
}

@Injectable()
export class NluService {
  private readonly logger = new Logger(NluService.name);

  constructor(
    private readonly contextService: ConversationContextService = new ConversationContextService(),
    private readonly toolDispatcher: ToolDispatcherService = null as any,
  ) {}

  public async processUserInput(
    userId: string,
    input: string,
  ): Promise<ProcessedIntentResult> {
    this.logger.log(`Processing input for user ${userId}: "${input}"`);

    // Level 1A: Batch Multi-Item Parser (e.g. "Lunch 200, tea 40, cab 180")
    const batchResult = RegexParser.parseBatch(input);
    if (batchResult && batchResult.length >= 2) {
      this.logger.log(
        `Parsed batch list of ${batchResult.length} items deterministically via Regex`,
      );
      this.contextService.addMessage(userId, 'user', input);
      return {
        intent: 'CREATE_TRANSACTION',
        transactions: batchResult,
      };
    }

    // Level 1B: Deterministic Fast Single Regex Parser / Bank SMS Parser
    const regexResult = RegexParser.parse(input);
    if (regexResult && regexResult.amount > 0) {
      if (regexResult.category === 'Others') {
        const dictCat = CategoryDictionaryMapper.categorize(input);
        regexResult.category = dictCat.category;
      }
      this.logger.log(
        `Parsed deterministically via Regex & Dict with confidence ${regexResult.confidence}`,
      );
      this.contextService.addMessage(userId, 'user', input);

      return {
        intent: 'CREATE_TRANSACTION',
        transactions: [regexResult],
      };
    }

    // Level 2: Gemini / LLM Intent & Tool Engine with Short-Term Context Memory
    this.logger.log(
      'Regex matched nothing, routing to LLM Intent & Tool Router...',
    );
    const history = this.contextService.getHistory(userId);
    const intentResponse = await LlmIntentAdapter.classifyAndDispatch(
      input,
      history,
    );

    this.contextService.addMessage(userId, 'user', input);

    if (!intentResponse) {
      return {
        intent: 'UNKNOWN',
        replyText: `🤔 I couldn't understand that. You can send an expense (e.g. "Coffee 180"), ask a question ("How much did I spend on food?"), or type /help.`,
      };
    }

    this.logger.log(
      `Classified intent as ${intentResponse.intent} (Confidence: ${intentResponse.confidence})`,
    );

    // Handle Transactions extracted by LLM
    if (intentResponse.transactions && intentResponse.transactions.length > 0) {
      const parsedTransactions: ParsedTransaction[] =
        intentResponse.transactions.map((tx) => ({
          type: tx.type,
          amount: tx.amount,
          originalAmount: tx.originalAmount || undefined,
          currency: tx.currency,
          merchant: tx.merchant || undefined,
          category: tx.category,
          description: tx.description,
          transactionDate: tx.transactionDateISO
            ? new Date(tx.transactionDateISO)
            : new Date(),
          splitCount: tx.splitCount,
          rawText: input,
          parsedBy: 'LLM',
          confidence: intentResponse.confidence,
        }));

      return {
        intent: intentResponse.intent,
        transactions: parsedTransactions,
        replyText: intentResponse.replyText,
      };
    }

    // Handle Tool Executions
    if (intentResponse.toolCalls && intentResponse.toolCalls.length > 0) {
      const toolCall = intentResponse.toolCalls[0];
      const toolResult = await this.toolDispatcher.executeTool(
        userId,
        toolCall,
      );

      let synthesizedReply = intentResponse.replyText;
      if (!synthesizedReply && toolResult) {
        if (toolCall.tool === 'get_category_spending' && toolResult.category) {
          const spent = Number(toolResult.spent || 0);
          const curr = toolResult.currency || '₹';
          const period = toolResult.period || 'month';
          synthesizedReply = spent > 0
            ? `You've spent **${curr}${spent.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}** on **${toolResult.category}** this ${period}.`
            : `You haven't recorded any expenses for **${toolResult.category}** this ${period}!`;
        } else if (toolCall.tool === 'get_expense_summary' && toolResult.totalExpense !== undefined) {
          synthesizedReply = `Here is your summary for this ${toolResult.period || 'month'}:\n• Total Expenses: **₹${Number(toolResult.totalExpense || 0).toLocaleString()}**\n• Total Income: **₹${Number(toolResult.totalIncome || 0).toLocaleString()}**\n• Net Savings: **₹${Number(toolResult.netSavings || 0).toLocaleString()}**`;
        } else if (toolCall.tool === 'get_top_expenses' && Array.isArray(toolResult)) {
          synthesizedReply = toolResult.length === 0
            ? "You don't have any expenses recorded yet for this month."
            : "Here are your biggest expenses this month:\n" + toolResult.map((t: any) => `• **${t.merchant || 'Expense'}**: ₹${Number(t.amount).toLocaleString()} (${t.category})`).join('\n');
        } else if (toolCall.tool === 'get_budget_status' && Array.isArray(toolResult)) {
          synthesizedReply = toolResult.length === 0
            ? "You don't have any category budgets set up yet. Try saying 'Set food budget to 5000'."
            : "Here is your budget status:\n" + toolResult.map((b: any) => `• **${b.category}**: ₹${Number(b.spent).toLocaleString()} / ₹${Number(b.limit).toLocaleString()} (${b.usedPercentage}%)`).join('\n');
        } else if (toolCall.tool === 'create_recurring' && toolResult.name) {
          synthesizedReply = `🔁 Recurring schedule created: **${toolResult.name}** of ₹${Number(toolResult.amount).toLocaleString()} on day ${toolResult.day} of every month.`;
        }
      }

      return {
        intent: intentResponse.intent,
        toolResult,
        replyText: synthesizedReply || undefined,
      };
    }

    // Handle Conversational Corrections
    if (intentResponse.intent === 'CONVERSATIONAL_CORRECTION') {
      return {
        intent: intentResponse.intent,
        isCorrection: true,
        replyText: intentResponse.replyText,
      };
    }

    return {
      intent: intentResponse.intent,
      replyText: intentResponse.replyText,
    };
  }

  // Compatibility helper for legacy single-string parsing
  public async parseText(input: string): Promise<ParsedTransaction> {
    const res = await this.processUserInput('system_legacy', input);
    if (res.transactions && res.transactions.length > 0) {
      return res.transactions[0];
    }
    return {
      type: 'EXPENSE',
      amount: 0,
      currency: 'INR',
      category: 'Others',
      description: input,
      transactionDate: new Date(),
      splitCount: 1,
      rawText: input,
      parsedBy: 'REGEX',
      confidence: 0.1,
    };
  }
}
