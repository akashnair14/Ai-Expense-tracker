export class CategoryDictionaryMapper {
  private static MAPPINGS: Record<string, string[]> = {
    'Food': ['lunch', 'dinner', 'breakfast', 'zomato', 'swiggy', 'burger', 'pizza', 'restaurant', 'cafe', 'coffee', 'starbucks', 'mcdonalds', 'kfc', 'food', 'snack', 'tea', 'chai'],
    'Groceries': ['groceries', 'supermarket', 'blinkit', 'zepto', 'instamart', 'bigbasket', 'milk', 'vegetables', 'fruits', 'mart'],
    'Transport': ['uber', 'ola', 'rapido', 'cab', 'taxi', 'auto', 'metro', 'bus', 'train', 'flight'],
    'Fuel': ['petrol', 'diesel', 'cng', 'fuel', 'gas station', 'shell', 'hpcl', 'bpcl', 'iocl'],
    'Bills': ['electricity', 'water', 'wifi', 'internet', 'broadband', 'recharge', 'mobile', 'bill', 'utility'],
    'Rent': ['rent', 'house rent', 'flat rent'],
    'Entertainment': ['movie', 'cinema', 'tickets', 'netflix', 'spotify', 'prime', 'youtube', 'gaming', 'concert', 'bookmyshow'],
    'Shopping': ['amazon', 'flipkart', 'myntra', 'clothes', 'shoes', 'electronics', 'shopping', 'mall'],
    'Salary': ['salary', 'paycheck', 'payroll'],
    'Freelance': ['freelance', 'client payment', 'upwork', 'fiverr', 'contract'],
    'Healthcare': ['pharmacy', 'medicine', 'hospital', 'doctor', 'clinic', 'lab test'],
    'Investment': ['stocks', 'mutual fund', 'crypto', 'sip', 'zerodha', 'groww'],
  };

  public static categorize(text: string): { category: string; confidence: number } {
    const lower = text.toLowerCase();

    for (const [category, keywords] of Object.entries(this.MAPPINGS)) {
      for (const kw of keywords) {
        if (lower.includes(kw)) {
          return { category, confidence: 0.9 };
        }
      }
    }

    return { category: 'Others', confidence: 0.5 };
  }
}
