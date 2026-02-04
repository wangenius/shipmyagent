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

