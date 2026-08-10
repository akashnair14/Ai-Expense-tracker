import { NluService } from '../src/nlu/nlu.service';

async function runTests() {
  const nlu = new NluService();

  const testCases = [
    'Paid ₹250 for lunch',
    'Lunch 250',
    'Uber ₹420',
    'Groceries 1850',
    'Salary +50000',
    'Received freelance payment 25000',
    'Electricity bill 1800',
    'Movie tickets 650',
    'Zomato 800 split with 4',
    'Paid rent 12000',
    'Coffee 180',
    'Petrol 1200',
    'Amazon order ₹950',
    'Movie yesterday 400',
  ];

  console.log('====================================================');
  console.log('🧪 RUNNING NLU HYBRID ENGINE ACCURACY TEST HARNESS');
  console.log('====================================================\n');

  for (const input of testCases) {
    const res = await nlu.parseText(input);
    console.log(`Input: "${input}"`);
    console.log(` -> Type: ${res.type}`);
    console.log(` -> Amount: ${res.amount}${res.originalAmount ? ` (Original ${res.originalAmount}, Split ${res.splitCount})` : ''}`);
    console.log(` -> Category: ${res.category}`);
    console.log(` -> Merchant: ${res.merchant || 'N/A'}`);
    console.log(` -> ParsedBy: ${res.parsedBy} (Confidence: ${res.confidence})`);
    console.log('----------------------------------------------------');
  }
}

runTests();
