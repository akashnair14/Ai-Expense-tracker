import { RegexParser } from './regex.parser';

describe('RegexParser', () => {
  it('should parse standard expense text with amount and currency', () => {
    const res = RegexParser.parse('Paid ₹250 for lunch');
    expect(res).not.toBeNull();
    expect(res?.amount).toBe(250);
    expect(res?.type).toBe('EXPENSE');
    expect(res?.currency).toBe('INR');
    expect(res?.description).toBe('Lunch');
    expect(res?.merchant).toBeUndefined();
  });

  it('should parse "200 rupees for lunch" cleanly without setting rupees as merchant or in description', () => {
    const res = RegexParser.parse('200 rupees for lunch');
    expect(res).not.toBeNull();
    expect(res?.amount).toBe(200);
    expect(res?.currency).toBe('INR');
    expect(res?.description).toBe('Lunch');
    expect(res?.merchant).toBeUndefined();
  });

  it('should parse shorthand number multipliers correctly (k, lakh, cr)', () => {
    const kRes = RegexParser.parse('Rent 15k');
    expect(kRes).not.toBeNull();
    expect(kRes?.amount).toBe(15000);

    const decimalKRes = RegexParser.parse('Spent 2.5k on shopping');
    expect(decimalKRes).not.toBeNull();
    expect(decimalKRes?.amount).toBe(2500);

    const lakhRes = RegexParser.parse('Freelance income +1.5 lakhs');
    expect(lakhRes).not.toBeNull();
    expect(lakhRes?.amount).toBe(150000);
    expect(lakhRes?.type).toBe('INCOME');
  });

  it('should parse Bank & UPI SMS alerts', () => {
    const sms =
      'Dear UPI user A/C *1234 debited by Rs.450.00 on 16-Aug-26 to ZOMATO UPI Ref 123456';
    const res = RegexParser.parse(sms);
    expect(res).not.toBeNull();
    expect(res?.amount).toBe(450);
    expect(res?.type).toBe('EXPENSE');
    expect(res?.merchant).toBe('Zomato');
  });

  it('should parse multi-item batch lists', () => {
    const batch = 'Lunch 200, tea 40, cab 180';
    const res = RegexParser.parseBatch(batch);
    expect(res).not.toBeNull();
    expect(res?.length).toBe(3);
    expect(res![0].amount).toBe(200);
    expect(res![1].amount).toBe(40);
    expect(res![2].amount).toBe(180);
  });

  it('should detect income keywords correctly', () => {
    const res = RegexParser.parse('Salary +50000');
    expect(res).not.toBeNull();
    expect(res?.amount).toBe(50000);
    expect(res?.type).toBe('INCOME');
  });

  it('should detect "income 30000" as INCOME under Salary category', () => {
    const res = RegexParser.parse('income 30000');
    expect(res).not.toBeNull();
    expect(res?.amount).toBe(30000);
    expect(res?.type).toBe('INCOME');
    expect(res?.category).toBe('Salary');
  });

  it('should detect "income tax 5000" as EXPENSE under Bills category', () => {
    const res = RegexParser.parse('income tax 5000');
    expect(res).not.toBeNull();
    expect(res?.amount).toBe(5000);
    expect(res?.type).toBe('EXPENSE');
    expect(res?.category).toBe('Bills');
  });

  it('should detect "earned 25000" as INCOME under Salary category', () => {
    const res = RegexParser.parse('earned 25000');
    expect(res).not.toBeNull();
    expect(res?.amount).toBe(25000);
    expect(res?.type).toBe('INCOME');
    expect(res?.category).toBe('Salary');
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
    expect(res?.merchant).toBe('Zomato');
  });

  it('should return null when no amount is present', () => {
    const res = RegexParser.parse('Hello bot how are you');
    expect(res).toBeNull();
  });
});
