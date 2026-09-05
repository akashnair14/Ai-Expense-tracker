import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ForexService } from './common/forex/forex.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const mockForexService = {
      refreshRates: jest.fn().mockResolvedValue(undefined),
      getAllRates: jest.fn().mockReturnValue({ USD: 1.0, INR: 87.5 }),
    };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: ForexService, useValue: mockForexService },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });
});
