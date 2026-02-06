/**
 * Context snapshots（跨轮上下文快照）类型定义。
 *
 * 术语（中文，关键点）
 * - transcript（ChatStore / conversations/history.jsonl）：平台侧“用户视角”对话历史，append-only，用于审计与追溯。
 * - context（本模块）：Agent 运行时为了“跨轮继续完成任务”而维护的工作上下文（只保留 user/assistant 关键消息）。
 *
 * 设计目标
 * - 结构稳定：不要把 provider 内部的 messages 结构原封不动落盘（避免升级/迁移成本）。
 * - 预算可控：快照应有硬上限（maxTurns/maxChars），宁可截断也不要无边界膨胀。
 */

export type ChatContextTurnRoleV1 = "user" | "assistant";

export type ChatContextCompletionStateV1 = "active" | "archived";

export type ChatContextCheckpointV1 = {
  /**
   * 以“最后一条 assistant 消息”为 checkpoint 节点（用户提出的约束）。
   */
  lastAssistantTurnIndex: number;
  lastAssistantTextPreview: string;
};

export type ChatContextTurnV1 = {
  v: 1;
  ts: number;
  role: ChatContextTurnRoleV1;
  text: string;
  meta?: Record<string, unknown>;
};

export type ChatContextSnapshotV1 = {
  v: 1;
  chatKey: string;
  contextId: string;
  state: ChatContextCompletionStateV1;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  title?: string;
  checkpoint?: ChatContextCheckpointV1;
  turns: ChatContextTurnV1[];
  /**
   * 用于检索的扁平文本（可截断）。只用于本地 best-effort 搜索。
   */
  searchText?: string;
};

export type ChatContextIndexItemV1 = {
  v: 1;
  contextId: string;
  title?: string;
  createdAt: number;
  archivedAt: number;
  turns: number;
  searchTextPreview?: string;
};

export type ChatContextIndexV1 = {
  v: 1;
  items: ChatContextIndexItemV1[];
};

