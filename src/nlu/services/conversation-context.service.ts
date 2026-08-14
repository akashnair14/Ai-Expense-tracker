import { Injectable } from '@nestjs/common';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  metadata?: {
    lastTransactionId?: string;
    lastCategory?: string;
    lastAmount?: number;
  };
}

@Injectable()
export class ConversationContextService {
  // Key: userId or telegramId -> Array of last N messages
  private readonly history = new Map<string, ChatMessage[]>();
  private readonly MAX_HISTORY = 6;
  private readonly TTL_MS = 15 * 60 * 1000; // 15 minutes context TTL

  public addMessage(userId: string, role: 'user' | 'assistant', content: string, metadata?: ChatMessage['metadata']) {
    const list = this.getCleanHistory(userId);
    list.push({
      role,
      content,
      timestamp: Date.now(),
      metadata,
    });

    if (list.length > this.MAX_HISTORY) {
      list.shift();
    }

    this.history.set(userId, list);
  }

  public getHistory(userId: string): ChatMessage[] {
    return this.getCleanHistory(userId);
  }

  public getLastMetadata(userId: string): ChatMessage['metadata'] | undefined {
    const list = this.getCleanHistory(userId);
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].metadata) return list[i].metadata;
    }
    return undefined;
  }

  public clear(userId: string) {
    this.history.delete(userId);
  }

  private getCleanHistory(userId: string): ChatMessage[] {
    const now = Date.now();
    const existing = this.history.get(userId) || [];
    // Filter out messages older than TTL
    const valid = existing.filter((m) => now - m.timestamp < this.TTL_MS);
    this.history.set(userId, valid);
    return valid;
  }
}
