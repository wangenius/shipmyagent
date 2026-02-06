/**
 * 多维度上下文搜索
 *
 * 支持基于关键词、主题、实体、时间范围等多个维度的搜索
 */

import type { ChatContextSnapshotV1 } from "../types/contexts.js";
import type { ChatContextMetadata, SearchIndex } from "../types/context-compression.js";

/**
 * 搜索过滤器
 */
export type SearchFilters = {
  /** 主题过滤 */
  topics?: string[];
  /** 实体过滤 */
  entities?: string[];
  /** 最小重要性评分 */
  minImportance?: number;
  /** 时间范围 */
  dateRange?: {
    start: number;
    end: number;
  };
  /** 用户意图过滤 */
  userIntents?: string[];
};

/**
 * 搜索结果
 */
export type SearchResult = {
  /** 上下文快照 */
  context: ChatContextSnapshotV1;
  /** 相关性评分 */
  score: number;
  /** 匹配的维度 */
  matchedDimensions: string[];
  /** 元数据（如果有） */
  metadata?: ChatContextMetadata;
  /** 搜索索引（如果有） */
  searchIndex?: SearchIndex;
};

/**
 * 分词并标准化查询
 */
function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * 计算文本相似度（基于关键词匹配）
 */
function calculateTextSimilarity(queryTokens: string[], text: string): number {
  if (queryTokens.length === 0) return 0;

  const lowerText = text.toLowerCase();
  let matchCount = 0;

  for (const token of queryTokens) {
    if (lowerText.includes(token)) {
      matchCount++;
    }
  }

  return matchCount / queryTokens.length;
}

/**
 * 计算关键词匹配分数
 */
function scoreKeywordMatch(
  queryTokens: string[],
  searchIndex?: SearchIndex
): { score: number; matched: boolean } {
  if (!searchIndex || queryTokens.length === 0) {
    return { score: 0, matched: false };
  }

  let matchCount = 0;

  // 检查关键词匹配
  for (const token of queryTokens) {
    if (searchIndex.keywords.some(k => k.includes(token) || token.includes(k))) {
      matchCount++;
    }
  }

  // 检查 N-gram 匹配
  const queryBigram = queryTokens.slice(0, 2).join(" ");
  if (queryBigram && searchIndex.ngrams.includes(queryBigram)) {
    matchCount += 0.5;
  }

  const score = matchCount / queryTokens.length;
  return { score, matched: score > 0 };
}

/**
 * 计算主题匹配分数
 */
function scoreTopicMatch(
  filters: SearchFilters,
  metadata?: ChatContextMetadata
): { score: number; matched: boolean } {
  if (!filters.topics || filters.topics.length === 0 || !metadata?.topics) {
    return { score: 0, matched: false };
  }

  const matchedTopics = filters.topics.filter(t =>
    metadata.topics?.includes(t)
  );

  const score = matchedTopics.length / filters.topics.length;
  return { score, matched: matchedTopics.length > 0 };
}

/**
 * 计算实体匹配分数
 */
function scoreEntityMatch(
  filters: SearchFilters,
  metadata?: ChatContextMetadata,
  searchIndex?: SearchIndex
): { score: number; matched: boolean } {
  if (!filters.entities || filters.entities.length === 0) {
    return { score: 0, matched: false };
  }

  const allEntities = [
    ...(metadata?.entities || []),
    ...(searchIndex?.entities || []),
  ];

  if (allEntities.length === 0) {
    return { score: 0, matched: false };
  }

  let matchCount = 0;
  for (const filterEntity of filters.entities) {
    const lowerFilterEntity = filterEntity.toLowerCase();
    if (allEntities.some(e => e.toLowerCase().includes(lowerFilterEntity))) {
      matchCount++;
    }
  }

  const score = matchCount / filters.entities.length;
  return { score, matched: matchCount > 0 };
}

/**
 * 计算时间相关性分数
 */
function scoreTimeRelevance(
  context: ChatContextSnapshotV1,
  filters?: SearchFilters
): { score: number; matched: boolean } {
  // 如果有时间范围过滤
  if (filters?.dateRange) {
    const contextTime = context.archivedAt || context.createdAt;
    if (contextTime < filters.dateRange.start || contextTime > filters.dateRange.end) {
      return { score: 0, matched: false };
    }
    return { score: 1, matched: true };
  }

  // 否则，越新的越相关
  const now = Date.now();
  const contextTime = context.archivedAt || context.createdAt;
  const ageInDays = (now - contextTime) / (1000 * 60 * 60 * 24);

  // 30 天内的得分较高
  const score = Math.max(0, 1 - ageInDays / 30);
  return { score, matched: true };
}

/**
 * 计算重要性分数
 */
function scoreImportance(
  metadata?: ChatContextMetadata,
  filters?: SearchFilters
): { score: number; matched: boolean } {
  const importance = metadata?.importance || 0;

  // 如果有最小重要性过滤
  if (filters?.minImportance !== undefined) {
    if (importance < filters.minImportance) {
      return { score: 0, matched: false };
    }
  }

  return { score: importance, matched: true };
}

/**
 * 计算用户意图匹配分数
 */
function scoreIntentMatch(
  filters: SearchFilters,
  metadata?: ChatContextMetadata
): { score: number; matched: boolean } {
  if (!filters.userIntents || filters.userIntents.length === 0 || !metadata?.userIntents) {
    return { score: 0, matched: false };
  }

  const matchedIntents = filters.userIntents.filter(i =>
    metadata.userIntents?.includes(i)
  );

  const score = matchedIntents.length / filters.userIntents.length;
  return { score, matched: matchedIntents.length > 0 };
}

/**
 * 多维度搜索上下文
 *
 * @param query 搜索查询
 * @param contexts 上下文列表（带元数据和索引）
 * @param filters 搜索过滤器
 * @param limit 返回结果数量限制
 * @returns 搜索结果列表
 */
export function searchContexts(
  query: string,
  contexts: Array<{
    context: ChatContextSnapshotV1;
    metadata?: ChatContextMetadata;
    searchIndex?: SearchIndex;
  }>,
  filters?: SearchFilters,
  limit: number = 10
): SearchResult[] {
  const queryTokens = tokenizeQuery(query);
  const results: SearchResult[] = [];

  for (const item of contexts) {
    const matchedDimensions: string[] = [];
    let totalScore = 0;
    let dimensionCount = 0;

    // 1. 关键词匹配（权重 30%）
    const keywordMatch = scoreKeywordMatch(queryTokens, item.searchIndex);
    if (keywordMatch.matched) {
      matchedDimensions.push("关键词");
      totalScore += keywordMatch.score * 0.3;
      dimensionCount++;
    }

    // 2. 文本相似度（权重 20%）
    const textSimilarity = calculateTextSimilarity(
      queryTokens,
      item.context.searchText || ""
    );
    if (textSimilarity > 0) {
      matchedDimensions.push("文本内容");
      totalScore += textSimilarity * 0.2;
      dimensionCount++;
    }

    // 3. 主题匹配（权重 15%）
    const topicMatch = scoreTopicMatch(filters || {}, item.metadata);
    if (topicMatch.matched) {
      matchedDimensions.push("主题");
      totalScore += topicMatch.score * 0.15;
      dimensionCount++;
    }

    // 4. 实体匹配（权重 15%）
    const entityMatch = scoreEntityMatch(filters || {}, item.metadata, item.searchIndex);
    if (entityMatch.matched) {
      matchedDimensions.push("实体");
      totalScore += entityMatch.score * 0.15;
      dimensionCount++;
    }

    // 5. 时间相关性（权重 10%）
    const timeRelevance = scoreTimeRelevance(item.context, filters);
    if (timeRelevance.matched) {
      matchedDimensions.push("时间");
      totalScore += timeRelevance.score * 0.1;
      dimensionCount++;
    }

    // 6. 重要性（权重 10%）
    const importanceScore = scoreImportance(item.metadata, filters);
    if (importanceScore.matched) {
      matchedDimensions.push("重要性");
      totalScore += importanceScore.score * 0.1;
      dimensionCount++;
    }

    // 7. 用户意图匹配（权重 10%，可选）
    if (filters?.userIntents && filters.userIntents.length > 0) {
      const intentMatch = scoreIntentMatch(filters, item.metadata);
      if (intentMatch.matched) {
        matchedDimensions.push("用户意图");
        totalScore += intentMatch.score * 0.1;
        dimensionCount++;
      }
    }

    // 只保留有匹配的结果
    if (dimensionCount > 0 && totalScore > 0) {
      results.push({
        context: item.context,
        score: totalScore,
        matchedDimensions,
        metadata: item.metadata,
        searchIndex: item.searchIndex,
      });
    }
  }

  // 按分数排序并限制数量
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * 简单搜索（只基于关键词）
 *
 * @param query 搜索查询
 * @param contexts 上下文列表
 * @param limit 返回结果数量限制
 * @returns 搜索结果列表
 */
export function simpleSearch(
  query: string,
  contexts: ChatContextSnapshotV1[],
  limit: number = 10
): SearchResult[] {
  const queryTokens = tokenizeQuery(query);
  const results: SearchResult[] = [];

  for (const context of contexts) {
    const textSimilarity = calculateTextSimilarity(
      queryTokens,
      (context.searchText || "") + " " + (context.title || "")
    );

    if (textSimilarity > 0) {
      results.push({
        context,
        score: textSimilarity,
        matchedDimensions: ["文本内容"],
      });
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * 按主题搜索
 *
 * @param topics 主题列表
 * @param contexts 上下文列表（带元数据）
 * @param limit 返回结果数量限制
 * @returns 搜索结果列表
 */
export function searchByTopics(
  topics: string[],
  contexts: Array<{
    context: ChatContextSnapshotV1;
    metadata: ChatContextMetadata;
  }>,
  limit: number = 10
): SearchResult[] {
  return searchContexts(
    "",
    contexts,
    { topics },
    limit
  );
}

/**
 * 按实体搜索
 *
 * @param entities 实体列表
 * @param contexts 上下文列表（带元数据）
 * @param limit 返回结果数量限制
 * @returns 搜索结果列表
 */
export function searchByEntities(
  entities: string[],
  contexts: Array<{
    context: ChatContextSnapshotV1;
    metadata: ChatContextMetadata;
  }>,
  limit: number = 10
): SearchResult[] {
  return searchContexts(
    "",
    contexts,
    { entities },
    limit
  );
}

/**
 * 按时间范围搜索
 *
 * @param startTime 开始时间戳
 * @param endTime 结束时间戳
 * @param contexts 上下文列表
 * @param limit 返回结果数量限制
 * @returns 搜索结果列表
 */
export function searchByTimeRange(
  startTime: number,
  endTime: number,
  contexts: ChatContextSnapshotV1[],
  limit: number = 10
): SearchResult[] {
  const filtered = contexts.filter(context => {
    const contextTime = context.archivedAt || context.createdAt;
    return contextTime >= startTime && contextTime <= endTime;
  });

  return filtered
    .map(context => ({
      context,
      score: 1,
      matchedDimensions: ["时间范围"],
    }))
    .slice(0, limit);
}
