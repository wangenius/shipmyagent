/**
 * Memory 信息提取器 - 使用 LLM 从对话中提取关键信息
 */

import { generateText } from 'ai';
import type { LanguageModel } from 'ai';
import type { ChatLogEntryV1 } from './chat-store.js';
import type { MemoryEntry, MemoryType } from './memory-store.js';

export interface ExtractionResult {
  memories: Array<Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>>;
  confidence: number; // 0-1
}

export class MemoryExtractor {
  private model: LanguageModel;

  constructor(model: LanguageModel) {
    this.model = model;
  }

  /**
   * 从对话历史中提取 Memory
   */
  async extractFromHistory(entries: ChatLogEntryV1[]): Promise<ExtractionResult> {
    if (entries.length === 0) {
      return { memories: [], confidence: 0 };
    }

    // 构建对话文本（限制长度）
    const maxContentLength = 2000;
    let conversationText = '';
    let currentLength = 0;
    let truncatedCount = 0;

    for (const e of entries) {
      const role = e.role === 'user' ? '用户' : '助手';
      const truncatedText = e.text.slice(0, 150);
      const line = `${role}: ${truncatedText}${e.text.length > 150 ? '...' : ''}\n\n`;

      if (currentLength + line.length > maxContentLength) {
        truncatedCount = entries.length - entries.indexOf(e);
        break;
      }

      conversationText += line;
      currentLength += line.length;
    }

    if (truncatedCount > 0) {
      conversationText += `...(还有 ${truncatedCount} 条消息未显示)\n`;
    }

    // 使用 LLM 提取关键信息
    const prompt = `你是一个信息提取助手。请从以下对话中提取关键信息，包括：

1. **用户偏好**（preference）：用户的语言偏好、回复风格、常用命令等
2. **重要事实**（fact）：项目信息、重要约定、关键决策等
3. **实体和关系**（entity）：人物、项目、组织及其关系
4. **任务和待办**（task）：未完成的任务、提醒事项等

对话内容（共 ${entries.length} 条消息）：
${conversationText}

请以 JSON 格式返回提取的信息，格式如下：
{
  "memories": [
    {
      "type": "preference|fact|entity|task",
      "content": "简洁描述",
      "importance": 1-10,
      "tags": ["标签1", "标签2"],
      "metadata": { /* 额外信息 */ }
    }
  ],
  "confidence": 0.0-1.0
}

注意：
- 只提取真正重要的信息，不要提取琐碎内容
- importance 评分要合理，1-3为低，4-7为中，8-10为高
- 如果没有值得提取的信息，返回空数组
- 必须返回有效的 JSON 格式`;

    try {
      const result = await generateText({
        model: this.model,
        prompt,
        temperature: 0.3, // 较低的温度以获得更稳定的输出
      });

      // 解析 LLM 返回的 JSON
      const parsed = this.parseExtractionResult(result.text);
      return parsed;
    } catch (error) {
      console.error('Memory 提取失败:', error);
      return { memories: [], confidence: 0 };
    }
  }

  /**
   * 从单条消息中提取 Memory（快速提取）
   */
  async extractFromMessage(message: string, role: 'user' | 'assistant'): Promise<ExtractionResult> {
    // 简单的规则匹配，用于快速提取明显的信息
    const memories: Array<Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>> = [];

    // 检测任务相关的关键词
    const taskKeywords = ['记得', '提醒', '待办', '任务', '需要', 'todo', 'task', 'remind'];
    if (role === 'user' && taskKeywords.some((kw) => message.includes(kw))) {
      // 可能是任务，但需要更详细的分析
      // 这里只做简单标记，实际提取由 extractFromHistory 完成
    }

    // 检测偏好相关的关键词
    const preferenceKeywords = ['喜欢', '偏好', '习惯', '通常', '一般', 'prefer', 'like', 'usually'];
    if (role === 'user' && preferenceKeywords.some((kw) => message.includes(kw))) {
      memories.push({
        type: 'preference',
        content: message.slice(0, 200), // 截断过长的内容
        importance: 5,
        tags: ['auto-extracted'],
      });
    }

    return {
      memories,
      confidence: memories.length > 0 ? 0.6 : 0,
    };
  }

  /**
   * 解析 LLM 返回的提取结果
   */
  private parseExtractionResult(text: string): ExtractionResult {
    try {
      // 尝试提取 JSON 部分
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { memories: [], confidence: 0 };
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // 验证格式
      if (!parsed.memories || !Array.isArray(parsed.memories)) {
        return { memories: [], confidence: 0 };
      }

      // 过滤和验证每个 memory
      const validMemories = parsed.memories
        .filter((m: any) => {
          return (
            m &&
            typeof m === 'object' &&
            typeof m.type === 'string' &&
            ['preference', 'fact', 'entity', 'task'].includes(m.type) &&
            typeof m.content === 'string' &&
            m.content.trim().length > 0
          );
        })
        .map((m: any) => ({
          type: m.type as MemoryType,
          content: m.content.trim(),
          importance: typeof m.importance === 'number' ? Math.max(1, Math.min(10, m.importance)) : 5,
          tags: Array.isArray(m.tags) ? m.tags.filter((t: any) => typeof t === 'string') : [],
          metadata: typeof m.metadata === 'object' ? m.metadata : undefined,
        }));

      const confidence =
        typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5;

      return {
        memories: validMemories,
        confidence,
      };
    } catch (error) {
      console.error('Failed to parse extraction result:', error);
      return { memories: [], confidence: 0 };
    }
  }

  /**
   * 合并相似的 Memory（去重）
   */
  async deduplicateMemories(
    existingMemories: MemoryEntry[],
    newMemories: Array<Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<Array<Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>>> {
    const result: Array<Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>> = [];

    for (const newMem of newMemories) {
      // 检查是否与现有 memory 相似
      const similar = existingMemories.find((existing) => {
        if (existing.type !== newMem.type) return false;

        // 简单的相似度检测：内容包含关系
        const existingContent = existing.content.toLowerCase();
        const newContent = newMem.content.toLowerCase();

        return existingContent.includes(newContent) || newContent.includes(existingContent);
      });

      if (!similar) {
        result.push(newMem);
      }
    }

    return result;
  }

  /**
   * 批量提取（分批处理大量历史）
   */
  async extractInBatches(
    entries: ChatLogEntryV1[],
    batchSize: number = 20,
  ): Promise<ExtractionResult> {
    const allMemories: Array<Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>> = [];
    let totalConfidence = 0;
    let batchCount = 0;

    // 分批处理
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      const result = await this.extractFromHistory(batch);

      allMemories.push(...result.memories);
      totalConfidence += result.confidence;
      batchCount++;
    }

    // 去重
    const uniqueMemories = this.deduplicateInMemories(allMemories);

    return {
      memories: uniqueMemories,
      confidence: batchCount > 0 ? totalConfidence / batchCount : 0,
    };
  }

  /**
   * 在新提取的 memories 中去重
   */
  private deduplicateInMemories(
    memories: Array<Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Array<Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>> {
    const result: Array<Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>> = [];
    const seen = new Set<string>();

    for (const mem of memories) {
      const key = `${mem.type}:${mem.content.toLowerCase().slice(0, 50)}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(mem);
      }
    }

    return result;
  }
}
