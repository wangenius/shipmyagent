import type { JsonObject } from "../../../types/Json.js";

/**
 * 记忆模块类型定义。
 *
 * 关键点（中文）
 * - 仅描述 memory service 需要的数据结构
 * - 抽离到 memory/types 便于 service/runtime 复用
 */

export interface MemoryEntry {
  timestamp: number;
  roundRange: [number, number];
  summary: string;
  keyFacts: string[];
  userPreferences?: JsonObject;
}

export interface MemoryConfig {
  autoExtractEnabled?: boolean;
  extractMinEntries?: number;
  maxPrimaryChars?: number;
  compressOnOverflow?: boolean;
  backupBeforeCompress?: boolean;
}

export interface MemoryExtractParams {
  contextId: string;
  entryRange: [number, number];
}

export interface MemoryCompressParams {
  contextId: string;
  currentContent: string;
  targetChars: number;
}
