import { RegexParser } from '../parsers/regex.parser';
import { CategoryDictionaryMapper } from '../mappers/category-dictionary.mapper';

export interface EvalCase {
  input: string;
  expectedAmount: number;
  expectedType: 'EXPENSE' | 'INCOME';
  expectedCategory?: string;
  expectedSplitCount?: number;
}

export const EVALUATION_DATASET: EvalCase[] = [
  // Simple Food & Dining
  {
    input: 'Coffee 180',
    expectedAmount: 180,
    expectedType: 'EXPENSE',
    expectedCategory: 'Food',
  },
  {
    input: 'Tea 20',
    expectedAmount: 20,
    expectedType: 'EXPENSE',
    expectedCategory: 'Food',
  },
  {
    input: 'Lunch 350',
    expectedAmount: 350,
    expectedType: 'EXPENSE',
    expectedCategory: 'Food',
  },
  {
    input: 'Dinner 650',
    expectedAmount: 650,
    expectedType: 'EXPENSE',
    expectedCategory: 'Food',
  },
  {
    input: 'Breakfast at cafe 240',
    expectedAmount: 240,
    expectedType: 'EXPENSE',
    expectedCategory: 'Food',
  },
  {
    input: 'Swiggy order 420',
    expectedAmount: 420,
    expectedType: 'EXPENSE',
    expectedCategory: 'Food',
  },
  {
    input: 'Zomato pizza 890',
    expectedAmount: 890,
    expectedType: 'EXPENSE',
    expectedCategory: 'Food',
  },
  {
    input: 'McDonalds burger 320',
    expectedAmount: 320,
    expectedType: 'EXPENSE',
    expectedCategory: 'Food',
  },
  {
    input: 'Starbucks latte 390',
    expectedAmount: 390,
    expectedType: 'EXPENSE',
    expectedCategory: 'Food',
  },
  {
    input: 'Dominos 750',
    expectedAmount: 750,
    expectedType: 'EXPENSE',
    expectedCategory: 'Food',
  },
  {
    input: 'KFC chicken bucket 650',
    expectedAmount: 650,
    expectedType: 'EXPENSE',
    expectedCategory: 'Food',
  },
  {
    input: 'Subway sandwich 280',
    expectedAmount: 280,
    expectedType: 'EXPENSE',
    expectedCategory: 'Food',
  },
  {
    input: 'Burger King meal 340',
    expectedAmount: 340,
    expectedType: 'EXPENSE',
    expectedCategory: 'Food',
  },
  {
    input: 'Ice cream 120',
    expectedAmount: 120,
    expectedType: 'EXPENSE',
    expectedCategory: 'Food',
  },
  {
    input: 'Bakery pastries 210',
    expectedAmount: 210,
    expectedType: 'EXPENSE',
    expectedCategory: 'Food',
  },
  {
    input: 'Shawarma 140',
    expectedAmount: 140,
    expectedType: 'EXPENSE',
    expectedCategory: 'Food',
  },
  {
    input: 'Biryani with team 1200',
    expectedAmount: 1200,
    expectedType: 'EXPENSE',
    expectedCategory: 'Food',
  },
  {
    input: 'Snacks 80',
    expectedAmount: 80,
    expectedType: 'EXPENSE',
    expectedCategory: 'Food',
  },
  {
    input: 'Juice bar 90',
    expectedAmount: 90,
    expectedType: 'EXPENSE',
    expectedCategory: 'Food',
  },
  {
    input: 'Barbeque Nation buffet 1800',
    expectedAmount: 1800,
    expectedType: 'EXPENSE',
    expectedCategory: 'Food',
  },

  // Groceries & Supermarket
  {
    input: 'Milk 60',
    expectedAmount: 60,
    expectedType: 'EXPENSE',
    expectedCategory: 'Groceries',
  },
  {
    input: 'Eggs and bread 110',
    expectedAmount: 110,
    expectedType: 'EXPENSE',
    expectedCategory: 'Groceries',
  },
  {
    input: 'Blinkit groceries 640',
    expectedAmount: 640,
    expectedType: 'EXPENSE',
    expectedCategory: 'Groceries',
  },
  {
    input: 'Zepto instant order 320',
    expectedAmount: 320,
    expectedType: 'EXPENSE',
    expectedCategory: 'Groceries',
  },
  {
    input: 'Instamart fruits 450',
    expectedAmount: 450,
    expectedType: 'EXPENSE',
    expectedCategory: 'Groceries',
  },
  {
    input: 'Vegetables market 230',
    expectedAmount: 230,
    expectedType: 'EXPENSE',
    expectedCategory: 'Groceries',
  },
  {
    input: 'Supermarket shopping 2150',
    expectedAmount: 2150,
    expectedType: 'EXPENSE',
    expectedCategory: 'Groceries',
  },
  {
    input: 'Rice bag 1200',
    expectedAmount: 1200,
    expectedType: 'EXPENSE',
    expectedCategory: 'Groceries',
  },
  {
    input: 'Cooking oil 380',
    expectedAmount: 380,
    expectedType: 'EXPENSE',
    expectedCategory: 'Groceries',
  },
  {
    input: 'BigBasket monthly provisions 3400',
    expectedAmount: 3400,
    expectedType: 'EXPENSE',
    expectedCategory: 'Groceries',
  },

  // Travel & Commute
  {
    input: 'Uber ride 420',
    expectedAmount: 420,
    expectedType: 'EXPENSE',
    expectedCategory: 'Transport',
  },
  {
    input: 'Ola cab 310',
    expectedAmount: 310,
    expectedType: 'EXPENSE',
    expectedCategory: 'Transport',
  },
  {
    input: 'Rapido bike 65',
    expectedAmount: 65,
    expectedType: 'EXPENSE',
    expectedCategory: 'Transport',
  },
  {
    input: 'Auto rickshaw 150',
    expectedAmount: 150,
    expectedType: 'EXPENSE',
    expectedCategory: 'Transport',
  },
  {
    input: 'Metro card recharge 500',
    expectedAmount: 500,
    expectedType: 'EXPENSE',
    expectedCategory: 'Transport',
  },
  {
    input: 'Bus ticket 45',
    expectedAmount: 45,
    expectedType: 'EXPENSE',
    expectedCategory: 'Transport',
  },
  {
    input: 'Petrol fuel 2000',
    expectedAmount: 2000,
    expectedType: 'EXPENSE',
    expectedCategory: 'Fuel',
  },
  {
    input: 'Diesel fuel refill 3500',
    expectedAmount: 3500,
    expectedType: 'EXPENSE',
    expectedCategory: 'Fuel',
  },
  {
    input: 'Flight booking MakeMyTrip 5400',
    expectedAmount: 5400,
    expectedType: 'EXPENSE',
    expectedCategory: 'Travel',
  },
  {
    input: 'Train ticket IRCTC 850',
    expectedAmount: 850,
    expectedType: 'EXPENSE',
    expectedCategory: 'Travel',
  },

  // Shopping & Lifestyle
  {
    input: 'Amazon order 1499',
    expectedAmount: 1499,
    expectedType: 'EXPENSE',
    expectedCategory: 'Shopping',
  },
  {
    input: 'Flipkart headphones 2200',
    expectedAmount: 2200,
    expectedType: 'EXPENSE',
    expectedCategory: 'Shopping',
  },
  {
    input: 'Myntra t-shirt 899',
    expectedAmount: 899,
    expectedType: 'EXPENSE',
    expectedCategory: 'Shopping',
  },
  {
    input: 'Zara jeans 2990',
    expectedAmount: 2990,
    expectedType: 'EXPENSE',
    expectedCategory: 'Shopping',
  },
  {
    input: 'Nike shoes 4500',
    expectedAmount: 4500,
    expectedType: 'EXPENSE',
    expectedCategory: 'Shopping',
  },
  {
    input: 'Decathlon gym wear 1600',
    expectedAmount: 1600,
    expectedType: 'EXPENSE',
    expectedCategory: 'Shopping',
  },
  {
    input: 'H&M shirt 1299',
    expectedAmount: 1299,
    expectedType: 'EXPENSE',
    expectedCategory: 'Shopping',
  },
  {
    input: 'Apple AirPods case 1900',
    expectedAmount: 1900,
    expectedType: 'EXPENSE',
    expectedCategory: 'Shopping',
  },
  {
    input: 'Book from bookstore 450',
    expectedAmount: 450,
    expectedType: 'EXPENSE',
    expectedCategory: 'Shopping',
  },
  {
    input: 'Watch strap 650',
    expectedAmount: 650,
    expectedType: 'EXPENSE',
    expectedCategory: 'Shopping',
  },

  // Bills, Utilities & Subscriptions
  {
    input: 'Electricity bill 2400',
    expectedAmount: 2400,
    expectedType: 'EXPENSE',
    expectedCategory: 'Bills',
  },
  {
    input: 'Wifi broadband bill 999',
    expectedAmount: 999,
    expectedType: 'EXPENSE',
    expectedCategory: 'Bills',
  },
  {
    input: 'Mobile recharge Jio 666',
    expectedAmount: 666,
    expectedType: 'EXPENSE',
    expectedCategory: 'Bills',
  },
  {
    input: 'Airtel postpaid 499',
    expectedAmount: 499,
    expectedType: 'EXPENSE',
    expectedCategory: 'Bills',
  },
  {
    input: 'Water bill 350',
    expectedAmount: 350,
    expectedType: 'EXPENSE',
    expectedCategory: 'Bills',
  },
  {
    input: 'Piped gas bill 720',
    expectedAmount: 720,
    expectedType: 'EXPENSE',
    expectedCategory: 'Bills',
  },
  {
    input: 'Netflix subscription 649',
    expectedAmount: 649,
    expectedType: 'EXPENSE',
    expectedCategory: 'Bills',
  },
  {
    input: 'Spotify premium 119',
    expectedAmount: 119,
    expectedType: 'EXPENSE',
    expectedCategory: 'Bills',
  },
  {
    input: 'YouTube Premium 149',
    expectedAmount: 149,
    expectedType: 'EXPENSE',
    expectedCategory: 'Bills',
  },
  {
    input: 'Gym membership monthly 2000',
    expectedAmount: 2000,
    expectedType: 'EXPENSE',
    expectedCategory: 'Healthcare',
  },

  // Rent & EMI
  {
    input: 'Apartment Rent 18000',
    expectedAmount: 18000,
    expectedType: 'EXPENSE',
    expectedCategory: 'Rent',
  },
  {
    input: 'House rent paid 22000',
    expectedAmount: 22000,
    expectedType: 'EXPENSE',
    expectedCategory: 'Rent',
  },
  {
    input: 'Car loan EMI 14500',
    expectedAmount: 14500,
    expectedType: 'EXPENSE',
    expectedCategory: 'EMI',
  },
  {
    input: 'Home loan EMI 32000',
    expectedAmount: 32000,
    expectedType: 'EXPENSE',
    expectedCategory: 'EMI',
  },
  {
    input: 'Credit card bill payment 8900',
    expectedAmount: 8900,
    expectedType: 'EXPENSE',
    expectedCategory: 'Bills',
  },

  // Healthcare & Pharmacy
  {
    input: 'Pharmacy medicines Apollo 450',
    expectedAmount: 450,
    expectedType: 'EXPENSE',
    expectedCategory: 'Healthcare',
  },
  {
    input: 'Doctor consultation fee 800',
    expectedAmount: 800,
    expectedType: 'EXPENSE',
    expectedCategory: 'Healthcare',
  },
  {
    input: 'Dental checkup 1500',
    expectedAmount: 1500,
    expectedType: 'EXPENSE',
    expectedCategory: 'Healthcare',
  },
  {
    input: 'Eye test and drops 600',
    expectedAmount: 600,
    expectedType: 'EXPENSE',
    expectedCategory: 'Healthcare',
  },
  {
    input: 'Health insurance premium 12000',
    expectedAmount: 12000,
    expectedType: 'EXPENSE',
    expectedCategory: 'Insurance',
  },

  // Income & Earnings
  {
    input: 'Received salary 65000',
    expectedAmount: 65000,
    expectedType: 'INCOME',
    expectedCategory: 'Salary',
  },
  {
    input: 'Salary credited 75000',
    expectedAmount: 75000,
    expectedType: 'INCOME',
    expectedCategory: 'Salary',
  },
  {
    input: 'Freelance project payment 15000',
    expectedAmount: 15000,
    expectedType: 'INCOME',
    expectedCategory: 'Freelance',
  },
  {
    input: 'Client consulting payout 25000',
    expectedAmount: 25000,
    expectedType: 'INCOME',
    expectedCategory: 'Freelance',
  },
  {
    input: 'Upwork payout 8000',
    expectedAmount: 8000,
    expectedType: 'INCOME',
    expectedCategory: 'Freelance',
  },
  {
    input: 'Cashback received 250',
    expectedAmount: 250,
    expectedType: 'INCOME',
    expectedCategory: 'Gift',
  },
  {
    input: 'Dividend income 1800',
    expectedAmount: 1800,
    expectedType: 'INCOME',
    expectedCategory: 'Investment',
  },
  {
    input: 'Stock profit payout 4500',
    expectedAmount: 4500,
    expectedType: 'INCOME',
    expectedCategory: 'Investment',
  },
  {
    input: 'Refund received from Amazon 899',
    expectedAmount: 899,
    expectedType: 'INCOME',
    expectedCategory: 'Shopping',
  },
  {
    input: 'Sold old cycle 3000',
    expectedAmount: 3000,
    expectedType: 'INCOME',
    expectedCategory: 'Business',
  },

  // Currency Formats & Symbols
  {
    input: 'Paid ₹450 for lunch',
    expectedAmount: 450,
    expectedType: 'EXPENSE',
    expectedCategory: 'Food',
  },
  {
    input: 'Rs. 1200 grocery shopping',
    expectedAmount: 1200,
    expectedType: 'EXPENSE',
    expectedCategory: 'Groceries',
  },
  {
    input: 'Rs 600 petrol',
    expectedAmount: 600,
    expectedType: 'EXPENSE',
    expectedCategory: 'Fuel',
  },
  {
    input: 'INR 2500 electricity',
    expectedAmount: 2500,
    expectedType: 'EXPENSE',
    expectedCategory: 'Bills',
  },
  { input: '$50 domain renewal', expectedAmount: 50, expectedType: 'EXPENSE' },
  { input: '€30 software tool', expectedAmount: 30, expectedType: 'EXPENSE' },
  {
    input: '1500.50 repair cost',
    expectedAmount: 1500.5,
    expectedType: 'EXPENSE',
  },
  {
    input: 'Paid ₹ 950 for medicine',
    expectedAmount: 950,
    expectedType: 'EXPENSE',
    expectedCategory: 'Healthcare',
  },
  {
    input: 'Transferred 5000 to brother',
    expectedAmount: 5000,
    expectedType: 'EXPENSE',
  },
  { input: 'Donation 1000', expectedAmount: 1000, expectedType: 'EXPENSE' },

  // Bill Splitting
  {
    input: 'Zomato dinner 1200 split with 3',
    expectedAmount: 400,
    expectedType: 'EXPENSE',
    expectedSplitCount: 3,
  },
  {
    input: 'Cab fare 600 split by 2',
    expectedAmount: 300,
    expectedType: 'EXPENSE',
    expectedSplitCount: 2,
  },
  {
    input: 'Pizza party 1600 split by 4',
    expectedAmount: 400,
    expectedType: 'EXPENSE',
    expectedSplitCount: 4,
  },
  {
    input: 'Airbnb 10000 split between 5',
    expectedAmount: 2000,
    expectedType: 'EXPENSE',
    expectedSplitCount: 5,
  },
  {
    input: 'Groceries 1500 split by 3',
    expectedAmount: 500,
    expectedType: 'EXPENSE',
    expectedSplitCount: 3,
  },

  // Colloquial & Multi-word
  {
    input: 'Chai and biscuits with team 140',
    expectedAmount: 140,
    expectedType: 'EXPENSE',
    expectedCategory: 'Food',
  },
  {
    input: 'Got haircut at salon 350',
    expectedAmount: 350,
    expectedType: 'EXPENSE',
  },
  {
    input: 'Bought birthday cake 850',
    expectedAmount: 850,
    expectedType: 'EXPENSE',
    expectedCategory: 'Food',
  },
  {
    input: 'Paid laundry dry cleaning 420',
    expectedAmount: 420,
    expectedType: 'EXPENSE',
  },
  {
    input: 'Movie popcorn combo 550',
    expectedAmount: 550,
    expectedType: 'EXPENSE',
    expectedCategory: 'Entertainment',
  },
  {
    input: 'Bought flowers for mom 300',
    expectedAmount: 300,
    expectedType: 'EXPENSE',
    expectedCategory: 'Gift',
  },
  {
    input: 'Parking fee 50',
    expectedAmount: 50,
    expectedType: 'EXPENSE',
    expectedCategory: 'Transport',
  },
  {
    input: 'Toll plaza fastag 120',
    expectedAmount: 120,
    expectedType: 'EXPENSE',
    expectedCategory: 'Transport',
  },
  {
    input: 'Water bottle 20',
    expectedAmount: 20,
    expectedType: 'EXPENSE',
    expectedCategory: 'Food',
  },
  {
    input: 'Car wash 400',
    expectedAmount: 400,
    expectedType: 'EXPENSE',
    expectedCategory: 'Transport',
  },
  {
    input: 'Office stationery notebook 180',
    expectedAmount: 180,
    expectedType: 'EXPENSE',
    expectedCategory: 'Shopping',
  },
  {
    input: 'Bought milk and curd 95',
    expectedAmount: 95,
    expectedType: 'EXPENSE',
    expectedCategory: 'Groceries',
  },
  {
    input: 'Dinner buffet 1100',
    expectedAmount: 1100,
    expectedType: 'EXPENSE',
    expectedCategory: 'Food',
  },
  {
    input: 'Purchased shoes 3200',
    expectedAmount: 3200,
    expectedType: 'EXPENSE',
    expectedCategory: 'Shopping',
  },
  {
    input: 'Paid house maid salary 4000',
    expectedAmount: 4000,
    expectedType: 'EXPENSE',
  },
];
