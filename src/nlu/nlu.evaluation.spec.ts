import { RegexParser } from './parsers/regex.parser';
import { CategoryDictionaryMapper } from './mappers/category-dictionary.mapper';
import { EVALUATION_DATASET } from './evaluation/eval-dataset';

describe('NLU AI Engine 100-Case Evaluation Benchmark', () => {
  let passedAmount = 0;
  let passedType = 0;
  let passedCategory = 0;
  let passedSplits = 0;
  const totalCases = EVALUATION_DATASET.length;

  beforeAll(() => {
    EVALUATION_DATASET.forEach((testCase) => {
      const parsed = RegexParser.parse(testCase.input);
      let category = parsed.category;
      if (category === 'Others') {
        category = CategoryDictionaryMapper.categorize(testCase.input).category;
      }

      // Check Amount
      if (Math.abs(parsed.amount - testCase.expectedAmount) < 0.01) {
        passedAmount++;
      }

      // Check Type
      if (parsed.type === testCase.expectedType) {
        passedType++;
      }

      // Check Category
      if (!testCase.expectedCategory || category.toLowerCase().includes(testCase.expectedCategory.toLowerCase())) {
        passedCategory++;
      }

      // Check Bill Splits
      if (!testCase.expectedSplitCount || parsed.splitCount === testCase.expectedSplitCount) {
        passedSplits++;
      }
    });
  });

  it(`should achieve >= 95% Amount Extraction Accuracy across ${totalCases} test cases`, () => {
    const amountAccuracy = (passedAmount / totalCases) * 100;
    console.log(`📊 Amount Extraction Accuracy: ${amountAccuracy.toFixed(1)}% (${passedAmount}/${totalCases})`);
    expect(amountAccuracy).toBeGreaterThanOrEqual(95);
  });

  it(`should achieve >= 95% Type (Income/Expense) Classification Accuracy`, () => {
    const typeAccuracy = (passedType / totalCases) * 100;
    console.log(`📊 Type Classification Accuracy: ${typeAccuracy.toFixed(1)}% (${passedType}/${totalCases})`);
    expect(typeAccuracy).toBeGreaterThanOrEqual(95);
  });

  it(`should achieve >= 90% Category Mapping Accuracy`, () => {
    const catAccuracy = (passedCategory / totalCases) * 100;
    console.log(`📊 Category Mapping Accuracy: ${catAccuracy.toFixed(1)}% (${passedCategory}/${totalCases})`);
    expect(catAccuracy).toBeGreaterThanOrEqual(90);
  });

  it(`should achieve 100% Bill-Splitting Math Precision`, () => {
    const splitAccuracy = (passedSplits / totalCases) * 100;
    console.log(`📊 Bill-Splitting Math Accuracy: ${splitAccuracy.toFixed(1)}% (${passedSplits}/${totalCases})`);
    expect(splitAccuracy).toBe(100);
  });
});
