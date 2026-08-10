import { RegexParser } from './regex.parser';

describe('RegexParser', () => {
  it('should parse standard expense text with amount and currency', () => {
    const res = RegexParser.parse('Paid ₹250 for lunch');
    expect(res).not.toBeNull();
    expect(res?.amount).toBe(250);
    expect(res?.type).toBe('EXPENSE');
    expect(res?.currency).toBe('INR');
  });

  it('should detect income keywords correctly', () => {
    const res = RegexParser.parse('Salary +50000');
    expect(res).not.toBeNull();
    expect(res?.amount).toBe(50000);
    expect(res?.type).toBe('INCOME');
  });

  it('should handle ordinal date expressions without over-matching day as amount', () => {
    const res = RegexParser.parse('Lunch on 25th 300');
    expect(res).not.toBeNull();
    expect(res?.amount).toBe(300);
    expect(res?.type).toBe('EXPENSE');
  });

  it('should correctly calculate split amounts', () => {
    const res = RegexParser.parse('Zomato 800 split with 4');
    expect(res).not.toBeNull();
    expect(res?.originalAmount).toBe(800);
    expect(res?.splitCount).toBe(4);
    expect(res?.amount).toBe(200);
  });

  it('should return null when no amount is present', () => {
    const res = RegexParser.parse('Hello bot how are you');
    expect(res).toBeNull();
  });
});
