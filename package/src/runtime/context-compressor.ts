/**
 * 上下文压缩器 - 实现滑动窗口+摘要策略
 */

import { generateText } from 'ai';
import type { LanguageModel, ModelMessage } from 'ai';

export interface CompressionOptions {
  /** 滑动窗口大小（保留最近 N 条完整消息） */
  windowSize?: number;
  /** 是否启用摘要 */
  enableSummary?: boolean;
  /** 摘要的最大字符数 */
  maxSummaryChars?: number;
}

export interface CompressionResult {
  /** 压缩后的消息列表 */
  messages: ModelMessage[];
  /** 是否进行了压缩 */
  compressed: boolean;
  /** 原始消息数量 */
  originalCount: number;
  /** 压缩后消息数量 */
  compressedCount: number;
}

export class ContextCompressor {
  private model: LanguageModel;
  private defaultWindowSize: number;
  private enableSummary: boolean;
  private maxSummaryChars: number;

  constructor(model: LanguageModel, options?: CompressionOptions) {
    this.model = model;
    this.defaultWindowSize = options?.windowSize ?? 20;
    this.enableSummary = options?.enableSummary ?? true;
    this.maxSummaryChars = options?.maxSummaryChars ?? 2000;
  }

  /**
   * 压缩消息历史
   */
  async compress(
    messages: ModelMessage[],
    options?: CompressionOptions,
  ): Promise<CompressionResult> {
    const windowSize = options?.windowSize ?? this.defaultWindowSize;
    const enableSummary = options?.enableSummary ?? this.enableSummary;

    // 如果消息数量不超过窗口大小，不需要压缩
    if (messages.length <= windowSize) {
      return {
        messages,
        compressed: false,
        originalCount: messages.length,
        compressedCount: messages.length,
      };
    }

    // 分离旧消息和新消息
    const oldMessages = messages.slice(0, messages.length - windowSize);
    const recentMessages = messages.slice(messages.length - windowSize);

    // 如果启用摘要，生成旧消息的摘要
    let compressedMessages: ModelMessage[];
    if (enableSummary && oldMessages.length > 0) {
      try {
        const summary = await this.generateSummary(oldMessages);
        compressedMessages = [
          {
            role: 'assistant',
            content: summary,
          },
          ...recentMessages,
        ];
      } catch (error) {
        // 摘要生成失败时，回退到滑动窗口策略（不插入错误消息）
        console.warn('摘要生成失败，回退到滑动窗口策略:', error);
        compressedMessages = recentMessages;
      }
    } else {
      // 不启用摘要，直接使用最近的消息
      compressedMessages = recentMessages;
    }

    return {
      messages: compressedMessages,
      compressed: true,
      originalCount: messages.length,
      compressedCount: compressedMessages.length,
    };
  }

  /**
   * 生成消息摘要
   */
  private async generateSummary(messages: ModelMessage[]): Promise<string> {
    // 构建对话文本（限制长度，避免日志过长）
    const maxContentLength = 2000; // 限制总内容长度
    let conversationText = '';
    let currentLength = 0;
    let truncatedCount = 0;

    for (const msg of messages) {
      const role = msg.role === 'user' ? '用户' : msg.role === 'assistant' ? '助手' : '系统';
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      const truncatedContent = content.slice(0, 150); // 每条消息最多150字符
      const line = `${role}: ${truncatedContent}${content.length > 150 ? '...' : ''}\n\n`;

      if (currentLength + line.length > maxContentLength) {
        truncatedCount = messages.length - messages.indexOf(msg);
        break;
      }

      conversationText += line;
      currentLength += line.length;
    }

    if (truncatedCount > 0) {
      conversationText += `...(还有 ${truncatedCount} 条消息未显示)\n`;
    }

    const prompt = `请为以下对话生成一个简洁的摘要，保留关键信息和上下文。摘要应该：
1. 突出重要的讨论点和决策
2. 保留必要的技术细节
3. 简洁明了，不超过 ${this.maxSummaryChars} 字符
4. 使用第三人称叙述

对话内容（共 ${messages.length} 条消息）：
${conversationText}

请直接返回摘要内容，不要添加额外的说明。`;

    try {
      const result = await generateText({
        model: this.model,
        prompt,
        temperature: 0.3,
      });

      const summary = result.text.trim();

      // 格式化摘要
      return `[历史对话摘要 - 已压缩 ${messages.length} 条消息]\n${summary}\n[以上是之前对话的摘要，以下是最近的完整对话]`;
    } catch (error) {
      console.error('摘要生成失败:', error);
      // 抛出错误，让调用方决定如何处理（回退到滑动窗口）
      throw new Error(`Summary generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 估算消息的 token 数量（粗略估计）
   *
   * ⚠️ 注意：这是一个简化的估算方法，实际 token 数量取决于模型的 tokenizer
   * - 中文：约 1.5 字符/token
   * - 英文：约 4 字符/token
   * - 代码：约 3 字符/token
   *
   * 建议：未来可以集成 tiktoken 库进行精确计算
   * 参考：https://github.com/openai/tiktoken
   */
  estimateTokenCount(messages: ModelMessage[]): number {
    let totalChars = 0;
    for (const msg of messages) {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      totalChars += content.length;
    }
    // 使用保守估计 2 字符/token（适用于中英文混合场景）
    return Math.ceil(totalChars / 2);
  }

  /**
   * 根据 token 限制压缩消息
   */
  async compressByTokenLimit(
    messages: ModelMessage[],
    maxTokens: number,
  ): Promise<CompressionResult> {
    const currentTokens = this.estimateTokenCount(messages);

    // 如果当前 token 数量在限制内，不需要压缩
    if (currentTokens <= maxTokens) {
      return {
        messages,
        compressed: false,
        originalCount: messages.length,
        compressedCount: messages.length,
      };
    }

    // 计算需要保留的窗口大小
    let windowSize = messages.length;
    let estimatedTokens = currentTokens;

    while (windowSize > 1 && estimatedTokens > maxTokens * 0.8) {
      windowSize = Math.floor(windowSize * 0.7); // 每次减少 30%
      const recentMessages = messages.slice(messages.length - windowSize);
      estimatedTokens = this.estimateTokenCount(recentMessages);
    }

    // 使用计算出的窗口大小进行压缩
    return this.compress(messages, { windowSize, enableSummary: this.enableSummary });
  }

  /**
   * 智能压缩：根据消息重要性选择性保留
   */
  async smartCompress(
    messages: ModelMessage[],
    targetSize: number,
  ): Promise<CompressionResult> {
    if (messages.length <= targetSize) {
      return {
        messages,
        compressed: false,
        originalCount: messages.length,
        compressedCount: messages.length,
      };
    }

    // 评估每条消息的重要性
    const scored = messages.map((msg, index) => ({
      message: msg,
      index,
      score: this.scoreMessageImportance(msg, index, messages.length),
    }));

    // 始终保留最近的消息
    const recentCount = Math.floor(targetSize * 0.6); // 60% 保留最近的
    const importantCount = targetSize - recentCount; // 40% 保留重要的

    const recentMessages = scored.slice(-recentCount);
    const olderMessages = scored.slice(0, -recentCount);

    // 从旧消息中选择最重要的
    olderMessages.sort((a, b) => b.score - a.score);
    const importantMessages = olderMessages.slice(0, importantCount);

    // 合并并按原始顺序排序
    const selected = [...importantMessages, ...recentMessages];
    selected.sort((a, b) => a.index - b.index);

    const compressedMessages = selected.map((s) => s.message);

    // 如果启用摘要，为被省略的消息生成摘要
    if (this.enableSummary && selected.length < messages.length) {
      const omittedIndices = new Set(selected.map((s) => s.index));
      const omittedMessages = messages.filter((_, i) => !omittedIndices.has(i));

      if (omittedMessages.length > 0) {
        const summary = await this.generateSummary(omittedMessages);
        compressedMessages.unshift({
          role: 'assistant',
          content: summary,
        });
      }
    }

    return {
      messages: compressedMessages,
      compressed: true,
      originalCount: messages.length,
      compressedCount: compressedMessages.length,
    };
  }

  /**
   * 评估消息的重要性（0-1）
   */
  private scoreMessageImportance(msg: ModelMessage, index: number, total: number): number {
    let score = 0;

    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);

    // 1. 位置权重：越新的消息越重要
    const positionWeight = index / total;
    score += positionWeight * 0.3;

    // 2. 长度权重：较长的消息可能包含更多信息
    const lengthWeight = Math.min(content.length / 500, 1);
    score += lengthWeight * 0.2;

    // 3. 关键词权重：包含重要关键词的消息更重要
    const importantKeywords = [
      '重要',
      '关键',
      '决定',
      '问题',
      '错误',
      'error',
      'important',
      'critical',
      '需要',
      '必须',
      'must',
      'should',
    ];
    const hasImportantKeyword = importantKeywords.some((kw) => content.toLowerCase().includes(kw));
    if (hasImportantKeyword) {
      score += 0.3;
    }

    // 4. 用户消息权重：用户的问题通常很重要
    if (msg.role === 'user') {
      score += 0.2;
    }

    return Math.min(score, 1);
  }

  /**
   * 批量压缩多个会话的历史
   */
  async compressBatch(
    sessions: Array<{ sessionId: string; messages: ModelMessage[] }>,
    options?: CompressionOptions,
  ): Promise<Map<string, CompressionResult>> {
    const results = new Map<string, CompressionResult>();

    for (const session of sessions) {
      const result = await this.compress(session.messages, options);
      results.set(session.sessionId, result);
    }

    return results;
  }
}
