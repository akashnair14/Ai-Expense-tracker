export interface ParsedTransaction {
  type: 'EXPENSE' | 'INCOME';
  amount: number;
  originalAmount?: number;
  currency: string;
  merchant?: string;
  category: string;
  description: string;
  transactionDate: Date;
  splitCount: number;
  rawText: string;
  parsedBy: 'REGEX' | 'DICTIONARY' | 'ML' | 'LLM';
  confidence: number;
}

export abstract class NluParserProvider {
  abstract name: string;
  abstract parse(input: string): Promise<ParsedTransaction | null>;
}
