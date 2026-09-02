import { Test, TestingModule } from '@nestjs/testing';
import { ForexService } from './forex.service';

describe('ForexService', () => {
  let service: ForexService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ForexService],
    }).compile();

    service = module.get<ForexService>(ForexService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return 1.0 rate for same currency', async () => {
    const res = await service.convert(100, 'INR', 'INR');
    expect(res.convertedAmount).toBe(100);
    expect(res.exchangeRate).toBe(1.0);
  });

  it('should accurately convert USD to INR using rates table', async () => {
    const res = await service.convert(10, 'USD', 'INR');
    expect(res.convertedAmount).toBeGreaterThan(800);
    expect(res.fromCurrency).toBe('USD');
    expect(res.targetCurrency).toBe('INR');
  });

  it('should format dual currency strings cleanly', () => {
    const str = service.formatDualCurrency(25, 'USD', 2187.5, 'INR');
    expect(str).toContain('USD 25');
    expect(str).toContain('INR');
  });
});
