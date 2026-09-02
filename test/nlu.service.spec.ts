import { Test, TestingModule } from '@nestjs/testing';
import { NluService } from '../src/nlu/nlu.service';
import { ConversationContextService } from '../src/nlu/services/conversation-context.service';
import { ToolDispatcherService } from '../src/nlu/services/tool-dispatcher.service';

describe('NluService (Unit)', () => {
  let service: NluService;
  let contextService: ConversationContextService;

  const mockToolDispatcher = {
    executeTool: jest.fn().mockImplementation((userId, toolCall) => {
      if (toolCall.tool === 'get_expense_summary') {
        return Promise.resolve({
          period: 'month',
          totalExpense: 14500,
          totalIncome: 65000,
          netSavings: 50500,
          transactionCount: 12,
        });
      }
      return Promise.resolve(null);
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NluService,
        ConversationContextService,
        { provide: ToolDispatcherService, useValue: mockToolDispatcher },
      ],
    }).compile();

    service = module.get<NluService>(NluService);
    contextService = module.get<ConversationContextService>(
      ConversationContextService,
    );
  });

  it('should parse deterministic simple transaction instantly without LLM', async () => {
    const result = await service.processUserInput('user_123', 'Coffee 180');
    expect(result.intent).toBe('CREATE_TRANSACTION');
    expect(result.transactions).toBeDefined();
    expect(result.transactions![0].amount).toBe(180);
    expect(result.transactions![0].type).toBe('EXPENSE');
    expect(result.transactions![0].category).toBe('Food & Dining');
  });

  it('should maintain short-term rolling conversation context', async () => {
    contextService.addMessage('user_123', 'user', 'Dinner 500');
    contextService.addMessage(
      'user_123',
      'assistant',
      'Recorded ₹500 under Food & Dining',
    );

    const history = contextService.getHistory('user_123');
    expect(history.length).toBe(2);
    expect(history[0].content).toBe('Dinner 500');
    expect(history[1].content).toBe('Recorded ₹500 under Food & Dining');
  });
});
