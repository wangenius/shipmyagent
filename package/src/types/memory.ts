/**
 * 记忆管理相关类型定义
 */

/**
 * 单条记忆条目
 */
export interface MemoryEntry {
  timestamp: number;
  roundRange: [number, number]; // 记录索引范围，例如 [0, 40] 表示第0-40条记录的摘要
  summary: string;
  keyFacts: string[];
  userPreferences?: Record<string, unknown>;
}

/**
 * 记忆配置
 */
export interface MemoryConfig {
  /** 是否启用自动记忆提取 */
  autoExtractEnabled?: boolean;
  /** 触发记忆提取的最小未记忆化记录数 */
  extractMinEntries?: number;
  /** Primary.md 最大字符数，超过时触发压缩 */
  maxPrimaryChars?: number;
  /** 超过阈值时是否自动压缩 */
  compressOnOverflow?: boolean;
  /** 压缩前是否备份 */
  backupBeforeCompress?: boolean;
}

/**
 * 记忆提取参数
 */
export interface MemoryExtractParams {
  sessionId: string;
  entryRange: [number, number];  // 记录索引范围而非轮次范围
}

/**
 * 记忆压缩参数
 */
export interface MemoryCompressParams {
  sessionId: string;
  currentContent: string;
  targetChars: number;
}
