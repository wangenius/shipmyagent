/**
 * Context snapshots（跨轮上下文快照）类型定义。
 *
 * 术语（中文，关键点）
 * - transcript（ChatStore / conversations/history.jsonl）：平台侧“用户视角”对话历史，append-only，用于审计与追溯。
 * - context（本模块）：Agent 的“工作上下文 messages 列表”，会被持久化到 `.ship/chat/<chatKey>/contexts/active.jsonl`，
 *   以便下一轮直接沿用（无需任何 judge）。
 *
 * 设计目标
 * - 结构稳定：active.jsonl 不直接落盘 provider 的内部结构，只存 role+content 的必要字段。
 * - 可恢复：archive 快照是一次性 JSON（用于切换/回滚/检索），active 是 JSONL（便于持续追加）。
 * - checkpoint：以“最后一条 assistant 消息”为节点归档快照。
 */

export type ChatContextMessageRoleV1 = "user" | "assistant";

export type ChatContextMessageEntryV1 = {
  v: 1;
  ts: number;
  role: ChatContextMessageRoleV1;
  content: string;
  meta?: Record<string, unknown>;
};

export type ChatContextCheckpointV1 = {
  lastAssistantIndex: number;
  lastAssistantPreview: string;
};

export type ChatContextArchiveSnapshotV1 = {
  v: 1;
  chatKey: string;
  contextId: string;
  createdAt: number;
  archivedAt: number;
  title?: string;
  reason?: string;
  checkpoint?: ChatContextCheckpointV1;
  messages: ChatContextMessageEntryV1[];
  searchText?: string;
};

export type ChatContextIndexItemV1 = {
  v: 1;
  contextId: string;
  title?: string;
  createdAt: number;
  archivedAt: number;
  messages: number;
  searchTextPreview?: string;
};

export type ChatContextIndexV1 = {
  v: 1;
  items: ChatContextIndexItemV1[];
};
