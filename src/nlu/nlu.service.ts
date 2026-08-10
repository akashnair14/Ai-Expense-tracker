import { Injectable, Logger } from '@nestjs/common';
import { ParsedTransaction } from './interfaces/nlu-parser.interface';
import { RegexParser } from './parsers/regex.parser';
import { CategoryDictionaryMapper } from './mappers/category-dictionary.mapper';
import { LlmFallbackAdapter } from './adapters/llm-fallback.adapter';

@Injectable()
export class NluService {
  private readonly logger = new Logger(NluService.name);

  public async parseText(input: string): Promise<ParsedTransaction> {
    this.logger.log(`Parsing input text: "${input}"`);

    // Level 1 & Level 2: Fast Regex & Rule Engine
    const regexResult = RegexParser.parse(input);
    if (regexResult && regexResult.amount > 0) {
      // Enrich Category via Dictionary Engine if default
      if (regexResult.category === 'Others') {
        const dictCat = CategoryDictionaryMapper.categorize(input);
        regexResult.category = dictCat.category;
      }
      this.logger.log(`Parsed via Regex & Dictionary with confidence ${regexResult.confidence}`);
      return regexResult;
    }

    // Level 4: LLM Fallback for ambiguous / low-confidence complex inputs
    this.logger.log('Regex confidence low, attempting LLM Fallback Parser...');
    const llmResult = await LlmFallbackAdapter.parseWithLLM(input);
    if (llmResult && llmResult.amount > 0) {
      this.logger.log(`Parsed via LLM Fallback with confidence ${llmResult.confidence}`);
      return llmResult;
    }

    // Fallback default structure if totally unrecognizable
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
