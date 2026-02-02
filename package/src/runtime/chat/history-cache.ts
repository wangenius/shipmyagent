/**
 * 历史缓存层 - 使用 LRU 策略缓存聊天历史
 */

import type { ChatLogEntryV1 } from "./store.js";

interface CacheEntry {
  entries: ChatLogEntryV1[];
  timestamp: number;
}

export class HistoryCache {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly maxSize: number;
  private readonly ttl: number; // Time to live in milliseconds

  constructor(options?: { maxSize?: number; ttl?: number }) {
    this.maxSize = options?.maxSize ?? 100; // 默认缓存 100 个 chat
    this.ttl = options?.ttl ?? 15 * 60 * 1000; // 默认 15 分钟过期（优化：提高缓存命中率）
  }

  /**
   * 获取缓存的历史记录
   */
  get(chatKey: string): ChatLogEntryV1[] | null {
    const entry = this.cache.get(chatKey);
    if (!entry) {
      return null;
    }

    // 检查是否过期
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(chatKey);
      return null;
    }

    // LRU: 重新插入以更新顺序
    this.cache.delete(chatKey);
    this.cache.set(chatKey, entry);

    return entry.entries;
  }

  /**
   * 设置缓存
   */
  set(chatKey: string, entries: ChatLogEntryV1[]): void {
    // 如果缓存已满，删除最旧的条目（Map 的第一个元素）
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(chatKey, {
      entries,
      timestamp: Date.now(),
    });
  }

  /**
   * 使缓存失效
   */
  invalidate(chatKey: string): void {
    this.cache.delete(chatKey);
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): { size: number; maxSize: number; keys: string[] } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      keys: Array.from(this.cache.keys()),
    };
  }

  /**
   * 清理过期的缓存条目
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(key);
      }
    }
  }
}
