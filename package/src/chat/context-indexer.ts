/**
 * 上下文索引构建器
 *
 * 为归档的上下文构建多维度索引，支持快速检索
 */

import type { ChatContextTurnV1 } from "../types/contexts.js";
import type { SearchIndex } from "../types/context-compression.js";

/**
 * 生成 N-gram
 *
 * @param text 文本
 * @param n N-gram 大小 (2 或 3)
 * @returns N-gram 列表
 */
function generateNgrams(text: string, n: number): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length < n) {
    return [];
  }

  const ngrams: string[] = [];
  for (let i = 0; i <= words.length - n; i++) {
    const ngram = words.slice(i, i + n).join(" ");
    ngrams.push(ngram);
  }

  return ngrams;
}

/**
 * 提取关键词
 *
 * @param text 文本
 * @returns 关键词列表
 */
function extractKeywords(text: string): string[] {
  // 分词
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  // 停用词列表（简化版）
  const stopWords = new Set([
    "的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都", "一", "一个",
    "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好",
    "自己", "这", "那", "里", "就是", "可以", "这个", "能", "他", "她", "它",
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
    "been", "being", "have", "has", "had", "do", "does", "did", "will",
    "would", "should", "could", "may", "might", "can", "this", "that",
  ]);

  // 过滤停用词和短词
  const keywords = words.filter(
    word => !stopWords.has(word) && word.length > 2
  );

  // 统计词频
  const wordFreq = new Map<string, number>();
  for (const word of keywords) {
    wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
  }

  // 按频率排序，取前 50 个
  return Array.from(wordFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([word]) => word);
}

/**
 * 构建搜索索引
 *
 * @param turns 对话轮次列表
 * @param entities 实体列表（来自元数据提取）
 * @returns 搜索索引
 */
export function buildSearchIndex(
  turns: ChatContextTurnV1[],
  entities?: string[]
): SearchIndex {
  const allText = turns.map(t => String(t.text || "")).join("\n");

  // 1. 提取关键词
  const keywords = extractKeywords(allText);

  // 2. 生成 2-gram 和 3-gram
  const bigrams = generateNgrams(allText, 2);
  const trigrams = generateNgrams(allText, 3);

  // 合并并去重
  const ngrams = Array.from(new Set([...bigrams, ...trigrams])).slice(0, 100);

  // 3. 使用提供的实体列表，或者为空
  const indexEntities = entities || [];

  return {
    keywords,
    ngrams,
    entities: indexEntities,
  };
}

/**
 * 更新搜索索引（增量更新）
 *
 * @param existingIndex 现有索引
 * @param newTurns 新增的对话轮次
 * @param newEntities 新增的实体
 * @returns 更新后的索引
 */
export function updateSearchIndex(
  existingIndex: SearchIndex,
  newTurns: ChatContextTurnV1[],
  newEntities?: string[]
): SearchIndex {
  const newIndex = buildSearchIndex(newTurns, newEntities);

  // 合并关键词
  const mergedKeywords = Array.from(
    new Set([...existingIndex.keywords, ...newIndex.keywords])
  ).slice(0, 50);

  // 合并 N-grams
  const mergedNgrams = Array.from(
    new Set([...existingIndex.ngrams, ...newIndex.ngrams])
  ).slice(0, 100);

  // 合并实体
  const mergedEntities = Array.from(
    new Set([...existingIndex.entities, ...newIndex.entities])
  ).slice(0, 30);

  return {
    keywords: mergedKeywords,
    ngrams: mergedNgrams,
    entities: mergedEntities,
  };
}

/**
 * 计算索引质量评分
 *
 * @param index 搜索索引
 * @returns 质量评分 (0-1)
 */
export function calculateIndexQuality(index: SearchIndex): number {
  let score = 0;

  // 1. 关键词数量（越多越好，但有上限）
  const keywordScore = Math.min(index.keywords.length / 30, 1) * 0.4;
  score += keywordScore;

  // 2. N-gram 数量
  const ngramScore = Math.min(index.ngrams.length / 50, 1) * 0.3;
  score += ngramScore;

  // 3. 实体数量
  const entityScore = Math.min(index.entities.length / 10, 1) * 0.3;
  score += entityScore;

  return Math.min(Math.max(score, 0), 1);
}

/**
 * 优化索引（去除低质量项）
 *
 * @param index 搜索索引
 * @returns 优化后的索引
 */
export function optimizeIndex(index: SearchIndex): SearchIndex {
  // 过滤太短的关键词
  const optimizedKeywords = index.keywords.filter(k => k.length > 2);

  // 过滤太短的 N-grams
  const optimizedNgrams = index.ngrams.filter(n => n.length > 5);

  // 过滤太短的实体
  const optimizedEntities = index.entities.filter(e => e.length > 2);

  return {
    keywords: optimizedKeywords,
    ngrams: optimizedNgrams,
    entities: optimizedEntities,
  };
}

/**
 * 序列化索引（用于存储）
 *
 * @param index 搜索索引
 * @returns JSON 字符串
 */
export function serializeIndex(index: SearchIndex): string {
  return JSON.stringify(index);
}

/**
 * 反序列化索引（从存储加载）
 *
 * @param json JSON 字符串
 * @returns 搜索索引
 */
export function deserializeIndex(json: string): SearchIndex {
  try {
    const parsed = JSON.parse(json);
    return {
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      ngrams: Array.isArray(parsed.ngrams) ? parsed.ngrams : [],
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
    };
  } catch {
    return {
      keywords: [],
      ngrams: [],
      entities: [],
    };
  }
}
