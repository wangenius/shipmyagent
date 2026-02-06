/**
 * 相关性排序算法
 *
 * 用于对搜索结果进行相关性排序，支持多种排序策略
 */

import type { ChatContextSnapshotV1 } from "../types/contexts.js";
import type { ChatContextMetadata } from "../types/context-compression.js";

/**
 * 排序策略
 */
export type RankingStrategy = "relevance" | "recency" | "importance" | "hybrid";

/**
 * 排序项
 */
export type RankingItem<T = any> = {
  item: T;
  score: number;
  metadata?: ChatContextMetadata;
};

/**
 * TF-IDF 计算
 */
class TFIDFCalculator {
  private documentFrequency: Map<string, number> = new Map();
  private totalDocuments: number = 0;

  /**
   * 构建文档频率索引
   */
  buildIndex(documents: string[]): void {
    this.totalDocuments = documents.length;
    this.documentFrequency.clear();

    for (const doc of documents) {
      const terms = this.tokenize(doc);
      const uniqueTerms = new Set(terms);

      for (const term of uniqueTerms) {
        this.documentFrequency.set(
          term,
          (this.documentFrequency.get(term) || 0) + 1
        );
      }
    }
  }

  /**
   * 分词
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  /**
   * 计算词频 (TF)
   */
  private calculateTF(term: string, document: string): number {
    const terms = this.tokenize(document);
    const termCount = terms.filter(t => t === term).length;
    return terms.length > 0 ? termCount / terms.length : 0;
  }

  /**
   * 计算逆文档频率 (IDF)
   */
  private calculateIDF(term: string): number {
    const df = this.documentFrequency.get(term) || 0;
    if (df === 0) return 0;
    return Math.log(this.totalDocuments / df);
  }

  /**
   * 计算 TF-IDF 分数
   */
  calculateScore(query: string, document: string): number {
    const queryTerms = this.tokenize(query);
    let score = 0;

    for (const term of queryTerms) {
      const tf = this.calculateTF(term, document);
      const idf = this.calculateIDF(term);
      score += tf * idf;
    }

    return score;
  }
}

/**
 * BM25 算法实现
 */
class BM25Calculator {
  private k1: number = 1.5;
  private b: number = 0.75;
  private avgDocLength: number = 0;
  private documentFrequency: Map<string, number> = new Map();
  private totalDocuments: number = 0;

  /**
   * 构建索引
   */
  buildIndex(documents: string[]): void {
    this.totalDocuments = documents.length;
    this.documentFrequency.clear();

    // 计算平均文档长度
    let totalLength = 0;
    for (const doc of documents) {
      const terms = this.tokenize(doc);
      totalLength += terms.length;

      const uniqueTerms = new Set(terms);
      for (const term of uniqueTerms) {
        this.documentFrequency.set(
          term,
          (this.documentFrequency.get(term) || 0) + 1
        );
      }
    }

    this.avgDocLength = totalLength / documents.length;
  }

  /**
   * 分词
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  /**
   * 计算 IDF
   */
  private calculateIDF(term: string): number {
    const df = this.documentFrequency.get(term) || 0;
    if (df === 0) return 0;
    return Math.log((this.totalDocuments - df + 0.5) / (df + 0.5) + 1);
  }

  /**
   * 计算 BM25 分数
   */
  calculateScore(query: string, document: string): number {
    const queryTerms = this.tokenize(query);
    const docTerms = this.tokenize(document);
    const docLength = docTerms.length;

    let score = 0;

    for (const term of queryTerms) {
      const termFreq = docTerms.filter(t => t === term).length;
      const idf = this.calculateIDF(term);

      const numerator = termFreq * (this.k1 + 1);
      const denominator =
        termFreq + this.k1 * (1 - this.b + this.b * (docLength / this.avgDocLength));

      score += idf * (numerator / denominator);
    }

    return score;
  }
}

/**
 * 基于相关性排序
 */
export function rankByRelevance<T extends { text: string }>(
  query: string,
  items: T[],
  limit?: number
): RankingItem<T>[] {
  const calculator = new BM25Calculator();
  const documents = items.map(item => item.text);
  calculator.buildIndex(documents);

  const scored = items.map(item => ({
    item,
    score: calculator.calculateScore(query, item.text),
  }));

  const sorted = scored.sort((a, b) => b.score - a.score);
  return limit ? sorted.slice(0, limit) : sorted;
}

/**
 * 基于时间排序（最近的优先）
 */
export function rankByRecency<T extends { timestamp: number }>(
  items: T[],
  limit?: number
): RankingItem<T>[] {
  const now = Date.now();

  const scored = items.map(item => {
    const ageInDays = (now - item.timestamp) / (1000 * 60 * 60 * 24);
    const score = Math.max(0, 1 - ageInDays / 30); // 30 天内的得分较高
    return { item, score };
  });

  const sorted = scored.sort((a, b) => b.score - a.score);
  return limit ? sorted.slice(0, limit) : sorted;
}

/**
 * 基于重要性排序
 */
export function rankByImportance<T>(
  items: T[],
  getImportance: (item: T) => number,
  limit?: number
): RankingItem<T>[] {
  const scored = items.map(item => ({
    item,
    score: getImportance(item),
  }));

  const sorted = scored.sort((a, b) => b.score - a.score);
  return limit ? sorted.slice(0, limit) : sorted;
}

/**
 * 混合排序（相关性 + 时间 + 重要性）
 */
export function rankHybrid<T extends { text: string; timestamp: number }>(
  query: string,
  items: T[],
  options: {
    getImportance?: (item: T) => number;
    weights?: {
      relevance?: number;
      recency?: number;
      importance?: number;
    };
    limit?: number;
  } = {}
): RankingItem<T>[] {
  const weights = {
    relevance: options.weights?.relevance ?? 0.5,
    recency: options.weights?.recency ?? 0.3,
    importance: options.weights?.importance ?? 0.2,
  };

  // 计算相关性分数
  const relevanceScores = rankByRelevance(query, items);
  const relevanceMap = new Map(
    relevanceScores.map(r => [r.item, r.score])
  );

  // 计算时间分数
  const recencyScores = rankByRecency(items);
  const recencyMap = new Map(
    recencyScores.map(r => [r.item, r.score])
  );

  // 计算重要性分数
  const importanceMap = new Map<T, number>();
  if (options.getImportance) {
    for (const item of items) {
      importanceMap.set(item, options.getImportance(item));
    }
  }

  // 归一化并加权
  const maxRelevance = Math.max(...Array.from(relevanceMap.values()), 1);
  const maxRecency = Math.max(...Array.from(recencyMap.values()), 1);
  const maxImportance = Math.max(...Array.from(importanceMap.values()), 1);

  const scored = items.map(item => {
    const relevance = (relevanceMap.get(item) || 0) / maxRelevance;
    const recency = (recencyMap.get(item) || 0) / maxRecency;
    const importance = (importanceMap.get(item) || 0) / maxImportance;

    const score =
      relevance * weights.relevance +
      recency * weights.recency +
      importance * weights.importance;

    return { item, score };
  });

  const sorted = scored.sort((a, b) => b.score - a.score);
  return options.limit ? sorted.slice(0, options.limit) : sorted;
}

/**
 * 对上下文进行排序
 */
export function rankContexts(
  query: string,
  contexts: Array<{
    context: ChatContextSnapshotV1;
    metadata?: ChatContextMetadata;
  }>,
  strategy: RankingStrategy = "hybrid",
  limit?: number
): RankingItem<ChatContextSnapshotV1>[] {
  const items = contexts.map(c => ({
    text: c.context.searchText || "",
    timestamp: c.context.archivedAt || c.context.createdAt,
    context: c.context,
    metadata: c.metadata,
  }));

  let ranked: RankingItem<any>[];

  switch (strategy) {
    case "relevance":
      ranked = rankByRelevance(query, items, limit);
      break;

    case "recency":
      ranked = rankByRecency(items, limit);
      break;

    case "importance":
      ranked = rankByImportance(
        items,
        item => item.metadata?.importance || 0,
        limit
      );
      break;

    case "hybrid":
    default:
      ranked = rankHybrid(query, items, {
        getImportance: item => item.metadata?.importance || 0,
        limit,
      });
      break;
  }

  return ranked.map(r => ({
    item: r.item.context,
    score: r.score,
    metadata: r.item.metadata,
  }));
}

/**
 * 重新排序（基于用户反馈）
 */
export function rerank<T>(
  items: RankingItem<T>[],
  feedback: Map<T, number> // 用户反馈分数 (-1 到 1)
): RankingItem<T>[] {
  const reranked = items.map(item => {
    const feedbackScore = feedback.get(item.item) || 0;
    const adjustedScore = item.score * (1 + feedbackScore * 0.5);
    return { ...item, score: adjustedScore };
  });

  return reranked.sort((a, b) => b.score - a.score);
}
