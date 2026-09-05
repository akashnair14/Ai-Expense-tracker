import { VectorEmbeddingService } from './vector-embedding.service';

describe('VectorEmbeddingService', () => {
  let service: VectorEmbeddingService;

  beforeEach(() => {
    service = new VectorEmbeddingService();
  });

  it('should generate an embedding vector for text', async () => {
    const vec = await service.getEmbedding('lunch fast food');
    expect(vec).not.toBeNull();
    expect(Array.isArray(vec)).toBe(true);
    expect(vec!.length).toBeGreaterThan(0);
  });

  it('should compute cosine similarity correctly', () => {
    const a = [1, 0, 0];
    const b = [1, 0, 0];
    const c = [0, 1, 0];

    expect(service.computeCosineSimilarity(a, b)).toBeCloseTo(1.0);
    expect(service.computeCosineSimilarity(a, c)).toBeCloseTo(0.0);
  });

  it('should rank similar transactions higher than dissimilar ones', async () => {
    const transactions = [
      { id: '1', merchant: 'McDonalds', description: 'Fast food burger', category: { name: 'Food' }, amount: 350 },
      { id: '2', merchant: 'Shell', description: 'Petrol fuel fill', category: { name: 'Fuel' }, amount: 1200 },
      { id: '3', merchant: 'Burger King', description: 'Whopper meal', category: { name: 'Food' }, amount: 450 },
    ];

    const result = await service.searchSimilarTransactions('fast food burger meal', transactions, 0.2);
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.totalAmount).toBeGreaterThan(0);
    expect(['McDonalds', 'Burger King']).toContain(result.matches[0].transaction.merchant);
  });
});
