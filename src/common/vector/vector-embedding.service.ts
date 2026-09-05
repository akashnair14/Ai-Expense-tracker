import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export interface ScoredTransaction {
  transaction: any;
  similarity: number;
}

export interface SemanticSearchResult {
  matches: ScoredTransaction[];
  totalAmount: number;
  matchedCategories: string[];
}

@Injectable()
export class VectorEmbeddingService {
  private readonly logger = new Logger(VectorEmbeddingService.name);
  private readonly cache = new Map<string, number[]>();
  private readonly MAX_CACHE_SIZE = 1000;

  /**
   * Retrieves or computes the embedding vector for a given text.
   * Uses Gemini embedding API with in-memory caching and fallback.
   */
  public async getEmbedding(text: string): Promise<number[] | null> {
    const clean = (text || '').trim().toLowerCase();
    if (!clean) return null;

    if (this.cache.has(clean)) {
      return this.cache.get(clean)!;
    }

    const geminiKey =
      process.env.GEMINI_API_KEY ||
      (process.env.LLM_PROVIDER === 'gemini' ? process.env.LLM_API_KEY : null);

    if (geminiKey) {
      const models = ['gemini-embedding-001', 'gemini-embedding-2'];
      for (const model of models) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${geminiKey}`;
          const res = await axios.post(
            url,
            { content: { parts: [{ text: clean }] } },
            { timeout: 4000 },
          );
          const values: number[] = res.data?.embedding?.values;
          if (Array.isArray(values) && values.length > 0) {
            this.setCache(clean, values);
            return values;
          }
        } catch (err: any) {
          this.logger.debug(
            `Gemini model ${model} embedding failed: ${err?.response?.data?.error?.message || err?.message}`,
          );
        }
      }
    }

    // Fallback: Deterministic token frequency vector for graceful offline/test degradation
    const fallbackVec = this.generateTokenVector(clean);
    this.setCache(clean, fallbackVec);
    return fallbackVec;
  }

  /**
   * Computes standard cosine similarity between two vectors.
   */
  public computeCosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }

  /**
   * Semantically ranks transactions against a natural language query.
   */
  public async searchSimilarTransactions(
    query: string,
    transactions: any[],
    threshold = 0.52,
    topK = 8,
  ): Promise<SemanticSearchResult> {
    if (!query || !transactions || transactions.length === 0) {
      return { matches: [], totalAmount: 0, matchedCategories: [] };
    }

    const queryVec = await this.getEmbedding(query);
    if (!queryVec) {
      return { matches: [], totalAmount: 0, matchedCategories: [] };
    }

    const scored: ScoredTransaction[] = [];

    for (const tx of transactions) {
      const catName = tx.category?.name || tx.category || '';
      const textToEmbed = `${tx.merchant || ''} ${tx.description || ''} ${catName}`.trim();
      if (!textToEmbed) continue;

      const txVec = await this.getEmbedding(textToEmbed);
      if (!txVec) continue;

      const sim = this.computeCosineSimilarity(queryVec, txVec);
      if (sim >= threshold) {
        scored.push({ transaction: tx, similarity: sim });
      }
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    const topMatches = scored.slice(0, topK);
    const totalAmount = topMatches.reduce(
      (sum, m) => sum + Number(m.transaction.amount || 0),
      0,
    );

    const matchedCats = Array.from(
      new Set(
        topMatches
          .map((m) => m.transaction.category?.name || m.transaction.category)
          .filter(Boolean),
      ),
    );

    return {
      matches: topMatches,
      totalAmount,
      matchedCategories: matchedCats,
    };
  }

  private setCache(key: string, vec: number[]) {
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, vec);
  }

  /**
   * Fast deterministic hash/token vector used as an offline/unit-test fallback.
   */
  private generateTokenVector(text: string, dimensions = 64): number[] {
    const vec = new Array(dimensions).fill(0);
    const words = text.toLowerCase().split(/\W+/).filter(Boolean);
    for (const w of words) {
      let hash = 0;
      for (let i = 0; i < w.length; i++) {
        hash = (hash << 5) - hash + w.charCodeAt(i);
        hash |= 0;
      }
      const idx = Math.abs(hash) % dimensions;
      vec[idx] += 1;
    }
    return vec;
  }
}
