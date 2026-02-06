/**
 * 上下文压缩相关类型定义
 */

import type { ChatContextTurnV1 } from "./contexts.js";

/**
 * 压缩策略配置
 */
export type CompressionStrategy = {
  /** 保留最近 N 轮完整对话 */
  recentTurnsToKeep: number;
  /** 是否对更早的对话进行摘要 */
  summarizeOlderTurns: boolean;
  /** 是否提取关键信息（用户偏好、重要决策） */
  extractKeyFacts: boolean;
  /** 是否使用重要性评分 */
  useImportanceScoring: boolean;
};

/**
 * 压缩结果
 */
export type CompressionResult = {
  /** 压缩后的对话轮次 */
  compressed: ChatContextTurnV1[];
  /** 旧对话的摘要（如果启用） */
  summary?: string;
  /** 提取的关键事实（如果启用） */
  keyFacts?: string[];
  /** 压缩统计 */
  stats: {
    originalTurns: number;
    compressedTurns: number;
    originalChars: number;
    compressedChars: number;
    compressionRatio: number;
  };
};

/**
 * 重要性评分结果
 */
export type ImportanceScore = {
  turnIndex: number;
  score: number;
  reasons: string[];
};

/**
 * 扩展的上下文快照（包含元数据）
 */
export type ChatContextMetadata = {
  /** 主题标签（自动提取） */
  topics?: string[];
  /** 实体列表（人名、项目名） */
  entities?: string[];
  /** 用户意图（询问、请求、反馈） */
  userIntents?: string[];
  /** 关键决策点 */
  keyDecisions?: string[];
  /** 重要性评分 (0-1) */
  importance?: number;
  /** 压缩信息 */
  compression?: {
    applied: boolean;
    strategy: Partial<CompressionStrategy>;
    summary?: string;
    keyFacts?: string[];
  };
};

/**
 * 增强的搜索索引
 */
export type SearchIndex = {
  /** 关键词列表 */
  keywords: string[];
  /** 2-3 gram 短语 */
  ngrams: string[];
  /** 实体名称 */
  entities: string[];
};
