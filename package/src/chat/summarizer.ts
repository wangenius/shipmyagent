/**
 * 对话摘要生成器
 *
 * 用于将较长的对话历史压缩为简洁的摘要
 */

import type { ChatContextTurnV1 } from "../types/contexts.js";

/**
 * 摘要生成选项
 */
export type SummarizerOptions = {
  /** 最大摘要长度（字符数） */
  maxLength?: number;
  /** 是否提取关键事实 */
  extractKeyFacts?: boolean;
  /** 语言模型（用于生成摘要，暂未实现） */
  model?: any;
};

/**
 * 摘要结果
 */
export type SummaryResult = {
  /** 摘要文本 */
  summary: string;
  /** 提取的关键事实 */
  keyFacts?: string[];
  /** 原始对话轮次数 */
  originalTurns: number;
  /** 原始字符数 */
  originalChars: number;
};

/**
 * 格式化对话为文本（用于摘要）
 */
function formatTurnsForSummary(turns: ChatContextTurnV1[]): string {
  const lines: string[] = [];
  for (const turn of turns) {
    const role = turn.role === "user" ? "用户" : "助手";
    const text = String(turn.text || "").trim();
    if (text) {
      lines.push(`${role}: ${text}`);
    }
  }
  return lines.join("\n\n");
}

/**
 * 计算文本字符数
 */
function countChars(turns: ChatContextTurnV1[]): number {
  return turns.reduce((sum, turn) => sum + String(turn.text || "").length, 0);
}

/**
 * 简单的基于规则的摘要（不依赖 LLM）
 *
 * 策略：
 * 1. 提取每轮对话的第一句话
 * 2. 保留关键信息（决策、约束、问题）
 * 3. 去除冗余和重复
 */
function generateRuleBasedSummary(
  turns: ChatContextTurnV1[],
  maxLength: number
): string {
  const summaryParts: string[] = [];
  let currentLength = 0;

  for (const turn of turns) {
    const text = String(turn.text || "").trim();
    if (!text) continue;

    // 提取第一句话或前 100 个字符
    const sentences = text.split(/[。！？.!?]/);
    const firstSentence = sentences[0]?.trim() || text.slice(0, 100);

    // 检查是否包含关键信息
    const hasKeyInfo =
      /决定|选择|采用|不能|不要|必须|问题|错误|重要/.test(text);

    if (hasKeyInfo || summaryParts.length < 3) {
      const role = turn.role === "user" ? "用户" : "助手";
      const part = `${role}: ${firstSentence}`;

      if (currentLength + part.length <= maxLength) {
        summaryParts.push(part);
        currentLength += part.length;
      } else {
        break;
      }
    }
  }

  return summaryParts.join("\n");
}

/**
 * 提取关键事实（基于规则）
 */
function extractKeyFactsRuleBased(turns: ChatContextTurnV1[]): string[] {
  const facts: string[] = [];
  const factPatterns = [
    /决定使用?(.{1,50})/,
    /采用了?(.{1,50})/,
    /不能(.{1,50})/,
    /必须(.{1,50})/,
    /偏好(.{1,50})/,
    /喜欢(.{1,50})/,
  ];

  for (const turn of turns) {
    const text = String(turn.text || "");

    for (const pattern of factPatterns) {
      const match = text.match(pattern);
      if (match && match[0]) {
        const fact = match[0].trim();
        if (fact.length > 5 && fact.length < 100) {
          facts.push(fact);
        }
      }
    }
  }

  // 去重
  return Array.from(new Set(facts)).slice(0, 10);
}

/**
 * 使用 LLM 生成摘要
 */
async function generateLLMSummary(
  turns: ChatContextTurnV1[],
  model: any,
  maxLength: number,
  extractKeyFacts: boolean
): Promise<SummaryResult> {
  const conversationText = formatTurnsForSummary(turns);

  const prompt = extractKeyFacts
    ? `请总结以下对话，并提取关键事实（用户偏好、重要决策、约束条件）。

对话内容：
${conversationText}

请按以下格式输出：

## 摘要
[简洁的对话摘要，不超过 ${maxLength} 字符]

## 关键事实
- [事实1]
- [事实2]
- [事实3]
...`
    : `请用简洁的语言总结以下对话（不超过 ${maxLength} 字符）：

${conversationText}`;

  try {
    // 注意：这里需要实际调用 LLM，但为了避免循环依赖，
    // 我们暂时返回基于规则的摘要
    // 实际使用时，应该通过 runtime context 获取 LLM 实例
    throw new Error("LLM summarization not implemented yet");
  } catch {
    // 降级到基于规则的摘要
    const summary = generateRuleBasedSummary(turns, maxLength);
    const keyFacts = extractKeyFacts ? extractKeyFactsRuleBased(turns) : undefined;

    return {
      summary,
      keyFacts,
      originalTurns: turns.length,
      originalChars: countChars(turns),
    };
  }
}

/**
 * 生成对话摘要
 *
 * @param turns 对话轮次列表
 * @param options 摘要选项
 * @returns 摘要结果
 */
export async function summarizeTurns(
  turns: ChatContextTurnV1[],
  options: SummarizerOptions = {}
): Promise<SummaryResult> {
  const maxLength = options.maxLength || 500;
  const extractKeyFacts = options.extractKeyFacts ?? true;

  // 如果对话很短，直接返回原文
  const totalChars = countChars(turns);
  if (totalChars <= maxLength) {
    return {
      summary: formatTurnsForSummary(turns),
      keyFacts: extractKeyFacts ? extractKeyFactsRuleBased(turns) : undefined,
      originalTurns: turns.length,
      originalChars: totalChars,
    };
  }

  // 如果提供了 LLM 模型，使用 LLM 生成摘要
  if (options.model) {
    return await generateLLMSummary(turns, options.model, maxLength, extractKeyFacts);
  }

  // 否则使用基于规则的摘要
  const summary = generateRuleBasedSummary(turns, maxLength);
  const keyFacts = extractKeyFacts ? extractKeyFactsRuleBased(turns) : undefined;

  return {
    summary,
    keyFacts,
    originalTurns: turns.length,
    originalChars: totalChars,
  };
}

/**
 * 批量摘要：将对话分段摘要
 *
 * 适用于超长对话，先分段摘要，再合并
 */
export async function summarizeTurnsInChunks(
  turns: ChatContextTurnV1[],
  chunkSize: number = 20,
  options: SummarizerOptions = {}
): Promise<SummaryResult> {
  if (turns.length <= chunkSize) {
    return await summarizeTurns(turns, options);
  }

  const chunks: ChatContextTurnV1[][] = [];
  for (let i = 0; i < turns.length; i += chunkSize) {
    chunks.push(turns.slice(i, i + chunkSize));
  }

  const chunkSummaries: string[] = [];
  const allKeyFacts: string[] = [];

  for (const chunk of chunks) {
    const result = await summarizeTurns(chunk, {
      ...options,
      maxLength: Math.floor((options.maxLength || 500) / chunks.length),
    });
    chunkSummaries.push(result.summary);
    if (result.keyFacts) {
      allKeyFacts.push(...result.keyFacts);
    }
  }

  // 合并分段摘要
  const finalSummary = chunkSummaries.join("\n\n");

  return {
    summary: finalSummary,
    keyFacts: options.extractKeyFacts ? Array.from(new Set(allKeyFacts)) : undefined,
    originalTurns: turns.length,
    originalChars: countChars(turns),
  };
}
