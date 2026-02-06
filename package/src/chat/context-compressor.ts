/**
 * 智能上下文压缩器
 *
 * 核心功能：
 * 1. 保留最近 N 轮完整对话
 * 2. 对更早的对话进行摘要
 * 3. 提取关键事实
 * 4. 基于重要性评分保留关键对话
 */

import type { ChatContextTurnV1 } from "../types/contexts.js";
import type {
  CompressionStrategy,
  CompressionResult,
} from "../types/context-compression.js";
import { calculateImportanceScores, filterByImportance } from "./importance-scorer.js";
import { summarizeTurns } from "./summarizer.js";

/**
 * 默认压缩策略
 */
export const DEFAULT_COMPRESSION_STRATEGY: CompressionStrategy = {
  recentTurnsToKeep: 10,
  summarizeOlderTurns: true,
  extractKeyFacts: true,
  useImportanceScoring: true,
};

/**
 * 计算文本总字符数
 */
function countTotalChars(turns: ChatContextTurnV1[]): number {
  return turns.reduce((sum, turn) => sum + String(turn.text || "").length, 0);
}

/**
 * 创建摘要轮次
 */
function createSummaryTurn(summary: string, timestamp: number): ChatContextTurnV1 {
  return {
    v: 1,
    ts: timestamp,
    role: "assistant",
    text: `[历史对话摘要]\n${summary}`,
    meta: { type: "summary", generated: true },
  };
}

/**
 * 创建关键事实轮次
 */
function createKeyFactsTurn(facts: string[], timestamp: number): ChatContextTurnV1 {
  const factsText = facts.map((fact, i) => `${i + 1}. ${fact}`).join("\n");
  return {
    v: 1,
    ts: timestamp,
    role: "assistant",
    text: `[提取的关键信息]\n${factsText}`,
    meta: { type: "key_facts", generated: true },
  };
}

/**
 * 智能压缩对话上下文
 *
 * @param turns 原始对话轮次
 * @param strategy 压缩策略
 * @returns 压缩结果
 */
export async function compressContext(
  turns: ChatContextTurnV1[],
  strategy: Partial<CompressionStrategy> = {}
): Promise<CompressionResult> {
  const config = { ...DEFAULT_COMPRESSION_STRATEGY, ...strategy };
  const originalTurns = turns.length;
  const originalChars = countTotalChars(turns);

  // 如果对话很短，不需要压缩
  if (turns.length <= config.recentTurnsToKeep) {
    return {
      compressed: turns,
      stats: {
        originalTurns,
        compressedTurns: turns.length,
        originalChars,
        compressedChars: originalChars,
        compressionRatio: 1,
      },
    };
  }

  // 1. 分离最近的对话和旧对话
  const recentTurns = turns.slice(-config.recentTurnsToKeep);
  const olderTurns = turns.slice(0, -config.recentTurnsToKeep);

  const compressed: ChatContextTurnV1[] = [];
  let summary: string | undefined;
  let keyFacts: string[] | undefined;

  // 2. 处理旧对话
  if (olderTurns.length > 0) {
    // 2.1 使用重要性评分筛选关键对话
    if (config.useImportanceScoring) {
      const importantTurns = filterByImportance(
        olderTurns,
        Math.min(5, Math.floor(olderTurns.length * 0.3)), // 保留最多 30% 的重要对话
        0.5 // 最低评分阈值
      );

      if (importantTurns.length > 0) {
        compressed.push(...importantTurns);
      }
    }

    // 2.2 生成摘要
    if (config.summarizeOlderTurns) {
      const summaryResult = await summarizeTurns(olderTurns, {
        maxLength: 500,
        extractKeyFacts: config.extractKeyFacts,
      });

      summary = summaryResult.summary;
      keyFacts = summaryResult.keyFacts;

      // 将摘要作为一个特殊的 turn 插入
      if (summary) {
        const summaryTurn = createSummaryTurn(
          summary,
          olderTurns[0]?.ts || Date.now()
        );
        compressed.unshift(summaryTurn);
      }

      // 将关键事实作为一个特殊的 turn 插入
      if (keyFacts && keyFacts.length > 0) {
        const factsTurn = createKeyFactsTurn(
          keyFacts,
          olderTurns[0]?.ts || Date.now()
        );
        compressed.push(factsTurn);
      }
    }
  }

  // 3. 添加最近的完整对话
  compressed.push(...recentTurns);

  // 4. 计算压缩统计
  const compressedChars = countTotalChars(compressed);
  const compressionRatio = originalChars > 0 ? compressedChars / originalChars : 1;

  return {
    compressed,
    summary,
    keyFacts,
    stats: {
      originalTurns,
      compressedTurns: compressed.length,
      originalChars,
      compressedChars,
      compressionRatio,
    },
  };
}

/**
 * 智能压缩并限制字符数
 *
 * 在压缩的基础上，进一步确保不超过字符限制
 *
 * @param turns 原始对话轮次
 * @param maxChars 最大字符数
 * @param strategy 压缩策略
 * @returns 压缩结果
 */
export async function compressContextWithLimit(
  turns: ChatContextTurnV1[],
  maxChars: number,
  strategy: Partial<CompressionStrategy> = {}
): Promise<CompressionResult> {
  // 首先进行智能压缩
  const result = await compressContext(turns, strategy);

  // 如果压缩后仍然超过限制，进一步裁剪
  if (result.stats.compressedChars > maxChars) {
    const trimmed: ChatContextTurnV1[] = [];
    let currentChars = 0;

    // 从后往前添加（优先保留最近的对话）
    for (let i = result.compressed.length - 1; i >= 0; i--) {
      const turn = result.compressed[i];
      const turnChars = String(turn.text || "").length;

      if (currentChars + turnChars <= maxChars) {
        trimmed.unshift(turn);
        currentChars += turnChars;
      } else {
        // 如果是摘要或关键事实，尝试保留
        if (turn.meta?.type === "summary" || turn.meta?.type === "key_facts") {
          // 截断文本以适应限制
          const availableChars = maxChars - currentChars;
          if (availableChars > 100) {
            const truncatedText = String(turn.text || "").slice(0, availableChars - 20) + "\n...(已截断)";
            trimmed.unshift({
              ...turn,
              text: truncatedText,
            });
            currentChars += truncatedText.length;
          }
        }
        break;
      }
    }

    return {
      ...result,
      compressed: trimmed,
      stats: {
        ...result.stats,
        compressedTurns: trimmed.length,
        compressedChars: currentChars,
        compressionRatio: result.stats.originalChars > 0 ? currentChars / result.stats.originalChars : 1,
      },
    };
  }

  return result;
}

/**
 * 检查是否需要压缩
 *
 * @param turns 对话轮次
 * @param maxTurns 最大轮次数
 * @param maxChars 最大字符数
 * @returns 是否需要压缩
 */
export function shouldCompress(
  turns: ChatContextTurnV1[],
  maxTurns: number,
  maxChars: number
): boolean {
  if (turns.length > maxTurns) {
    return true;
  }

  const totalChars = countTotalChars(turns);
  if (totalChars > maxChars) {
    return true;
  }

  return false;
}

/**
 * 获取压缩建议
 *
 * @param turns 对话轮次
 * @param maxTurns 最大轮次数
 * @param maxChars 最大字符数
 * @returns 压缩建议信息
 */
export function getCompressionAdvice(
  turns: ChatContextTurnV1[],
  maxTurns: number,
  maxChars: number
): {
  shouldCompress: boolean;
  reason: string;
  estimatedSavings: number;
} {
  const totalChars = countTotalChars(turns);
  const turnsOverLimit = turns.length - maxTurns;
  const charsOverLimit = totalChars - maxChars;

  if (turnsOverLimit > 0 && charsOverLimit > 0) {
    return {
      shouldCompress: true,
      reason: `对话轮次超出 ${turnsOverLimit} 轮，字符数超出 ${charsOverLimit} 个`,
      estimatedSavings: Math.max(turnsOverLimit, Math.floor(charsOverLimit * 0.5)),
    };
  }

  if (turnsOverLimit > 0) {
    return {
      shouldCompress: true,
      reason: `对话轮次超出 ${turnsOverLimit} 轮`,
      estimatedSavings: turnsOverLimit,
    };
  }

  if (charsOverLimit > 0) {
    return {
      shouldCompress: true,
      reason: `字符数超出 ${charsOverLimit} 个`,
      estimatedSavings: Math.floor(charsOverLimit * 0.5),
    };
  }

  return {
    shouldCompress: false,
    reason: "对话在限制范围内，无需压缩",
    estimatedSavings: 0,
  };
}
