/**
 * Context 相关的跨模块类型定义。
 *
 * 约定
 * - ChatStore（.ship/chats）记录的是“用户视角”的 platform transcript。
 * - AgentExecutionEntry 记录的是“工程向”的 agent 执行摘要（.ship/memory）。
 */

export type AgentExecutionEntryV1 = {
  v: 1;
  ts: number;
  chatKey: string;
  requestId: string;
  userPreview: string;
  outputPreview: string;
  toolCalls: Array<{
    tool: string;
    success?: boolean;
    error?: string;
  }>;
};

/**
 * Chat transcript（in-memory message cache）的压缩参数。
 *
 * 说明
 * - 这里的“chat history”指 ContextStore 内维护的会话 messages（用于下一轮 LLM 输入）。
 * - 不是 ChatStore（`.ship/chats`）里的平台 transcript。
 */
export type ChatHistoryCompactionOptions = {
  /**
   * 压缩后保留最后 N 条 messages。
   * - N 越大：更贴近当前任务，但上下文更长
   * - N 越小：更省 tokens，但可能丢失细节
   */
  keepLast: number;
};
