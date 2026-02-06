/**
 * 记忆提取引擎
 *
 * 从对话中自动提取结构化记忆：
 * - 用户偏好
 * - 事实知识
 * - 重要决策
 * - 约束条件
 */

import type { ChatContextTurnV1 } from "../types/contexts.js";

/**
 * 记忆类型
 */
export type MemoryType = "preference" | "fact" | "decision" | "constraint";

/**
 * 提取的记忆
 */
export type ExtractedMemory = {
  type: MemoryType;
  content: string;
  confidence: number; // 0-1
  source: {
    turnIndex: number;
    timestamp: number;
  };
  metadata?: {
    category?: string;
    entities?: string[];
  };
};

/**
 * 记忆提取规则
 */
const MEMORY_PATTERNS = {
  preference: [
    { pattern: /(?:我|用户)?(?:喜欢|偏好|习惯|倾向于|更喜欢)(.{1,50})/g, confidence: 0.8 },
    { pattern: /(?:我|用户)?(?:不喜欢|不习惯|不倾向于)(.{1,50})/g, confidence: 0.8 },
    { pattern: /(?:prefer|like|love|enjoy)\s+(.{1,50})/gi, confidence: 0.7 },
  ],
  fact: [
    { pattern: /(?:我|用户)?(?:是|在|从事|工作于)(.{1,50})/g, confidence: 0.7 },
    { pattern: /(?:项目|系统|应用)(?:使用|采用|基于)(.{1,50})/g, confidence: 0.8 },
    { pattern: /(?:技术栈|框架|语言)(?:是|为|包括)(.{1,50})/g, confidence: 0.8 },
  ],
  decision: [
    { pattern: /(?:决定|选择|确定)(?:使用|采用|不用|放弃)(.{1,50})/g, confidence: 0.9 },
    { pattern: /(?:最终|最后)(?:选择|决定|采用)(.{1,50})/g, confidence: 0.85 },
    { pattern: /(?:改为|换成|迁移到)(.{1,50})/g, confidence: 0.8 },
  ],
  constraint: [
    { pattern: /(?:不能|不要|禁止|不允许)(.{1,50})/g, confidence: 0.9 },
    { pattern: /(?:必须|一定要|务必|需要)(.{1,50})/g, confidence: 0.85 },
    { pattern: /(?:限制|约束|要求)(?:是|为)(.{1,50})/g, confidence: 0.8 },
  ],
};

/**
 * 清理提取的文本
 */
function cleanExtractedText(text: string): string {
  return text
    .trim()
    .replace(/^[，。、：；！？,.;:!?]+/, "")
    .replace(/[，。、：；！？,.;:!?]+$/, "")
    .trim();
}

/**
 * 从单个对话轮次提取记忆
 */
function extractFromTurn(
  turn: ChatContextTurnV1,
  turnIndex: number
): ExtractedMemory[] {
  const memories: ExtractedMemory[] = [];
  const text = String(turn.text || "");

  for (const [type, patterns] of Object.entries(MEMORY_PATTERNS)) {
    for (const { pattern, confidence } of patterns) {
      const matches = text.matchAll(pattern);

      for (const match of matches) {
        const content = match[1] ? cleanExtractedText(match[1]) : "";

        if (content.length > 5 && content.length < 200) {
          memories.push({
            type: type as MemoryType,
            content,
            confidence,
            source: {
              turnIndex,
              timestamp: turn.ts,
            },
          });
        }
      }
    }
  }

  return memories;
}

/**
 * 去重和合并相似记忆
 */
function deduplicateMemories(memories: ExtractedMemory[]): ExtractedMemory[] {
  const uniqueMemories: ExtractedMemory[] = [];
  const seen = new Set<string>();

  for (const memory of memories) {
    // 创建唯一键
    const key = `${memory.type}:${memory.content.toLowerCase().slice(0, 50)}`;

    if (!seen.has(key)) {
      seen.add(key);
      uniqueMemories.push(memory);
    } else {
      // 如果已存在，更新置信度（取最高值）
      const existing = uniqueMemories.find(m =>
        m.type === memory.type &&
        m.content.toLowerCase().slice(0, 50) === memory.content.toLowerCase().slice(0, 50)
      );

      if (existing && memory.confidence > existing.confidence) {
        existing.confidence = memory.confidence;
      }
    }
  }

  return uniqueMemories;
}

/**
 * 按置信度过滤记忆
 */
function filterByConfidence(
  memories: ExtractedMemory[],
  minConfidence: number = 0.7
): ExtractedMemory[] {
  return memories.filter(m => m.confidence >= minConfidence);
}

/**
 * 从对话中提取记忆
 *
 * @param turns 对话轮次列表
 * @param options 提取选项
 * @returns 提取的记忆列表
 */
export function extractMemories(
  turns: ChatContextTurnV1[],
  options: {
    minConfidence?: number;
    maxMemories?: number;
    types?: MemoryType[];
  } = {}
): ExtractedMemory[] {
  const minConfidence = options.minConfidence ?? 0.7;
  const maxMemories = options.maxMemories ?? 50;
  const allowedTypes = options.types;

  let allMemories: ExtractedMemory[] = [];

  // 从每个对话轮次提取记忆
  for (let i = 0; i < turns.length; i++) {
    const memories = extractFromTurn(turns[i], i);
    allMemories.push(...memories);
  }

  // 过滤类型
  if (allowedTypes && allowedTypes.length > 0) {
    allMemories = allMemories.filter(m => allowedTypes.includes(m.type));
  }

  // 去重
  allMemories = deduplicateMemories(allMemories);

  // 按置信度过滤
  allMemories = filterByConfidence(allMemories, minConfidence);

  // 按置信度排序
  allMemories.sort((a, b) => b.confidence - a.confidence);

  // 限制数量
  return allMemories.slice(0, maxMemories);
}

/**
 * 按类型分组记忆
 */
export function groupMemoriesByType(
  memories: ExtractedMemory[]
): Record<MemoryType, ExtractedMemory[]> {
  const grouped: Record<MemoryType, ExtractedMemory[]> = {
    preference: [],
    fact: [],
    decision: [],
    constraint: [],
  };

  for (const memory of memories) {
    grouped[memory.type].push(memory);
  }

  return grouped;
}

/**
 * 格式化记忆为文本
 */
export function formatMemories(memories: ExtractedMemory[]): string {
  const grouped = groupMemoriesByType(memories);
  const sections: string[] = [];

  const typeLabels: Record<MemoryType, string> = {
    preference: "用户偏好",
    fact: "事实知识",
    decision: "重要决策",
    constraint: "约束条件",
  };

  for (const [type, items] of Object.entries(grouped) as [MemoryType, ExtractedMemory[]][]) {
    if (items.length > 0) {
      sections.push(`## ${typeLabels[type]}`);
      for (const item of items) {
        sections.push(`- ${item.content} (置信度: ${Math.round(item.confidence * 100)}%)`);
      }
      sections.push("");
    }
  }

  return sections.join("\n");
}

/**
 * 提取记忆摘要
 */
export function extractMemorySummary(memories: ExtractedMemory[]): {
  total: number;
  byType: Record<MemoryType, number>;
  highConfidence: number;
} {
  const byType: Record<MemoryType, number> = {
    preference: 0,
    fact: 0,
    decision: 0,
    constraint: 0,
  };

  let highConfidence = 0;

  for (const memory of memories) {
    byType[memory.type]++;
    if (memory.confidence >= 0.8) {
      highConfidence++;
    }
  }

  return {
    total: memories.length,
    byType,
    highConfidence,
  };
}

/**
 * 合并多个记忆提取结果
 */
export function mergeMemories(
  memoryLists: ExtractedMemory[][]
): ExtractedMemory[] {
  const allMemories = memoryLists.flat();
  return deduplicateMemories(allMemories);
}
