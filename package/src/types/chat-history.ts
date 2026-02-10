import type { UIMessage } from "ai";
import type { ChatDispatchChannel } from "./chat-dispatcher.js";

/**
 * 对话历史：以 UIMessage[] 作为“唯一事实源”（用于 UI 展示 + 模型 messages 输入）。
 *
 * 关键点（中文）
 * - 持久化存储在 `.ship/chat/<encodedChatKey>/messages/history.jsonl`（每行一个 UIMessage）
 * - 默认只存 `role=user|assistant`（system prompt 仍由服务端 system 注入，不进 history）
 * - compact 会把更早的消息段压缩为一条 `assistant` 摘要消息（kind=summary）
 */

export type ShipChatChannel = ChatDispatchChannel | "api" | "cli" | "scheduler";

export type ShipHistoryKind = "normal" | "summary";
export type ShipHistorySource = "ingress" | "egress" | "compact";

export type ShipMessageSourceRangeV1 = {
  fromId: string;
  toId: string;
  count: number;
};

export type ShipMessageMetadataV1 = {
  v: 1;
  ts: number;
  chatKey: string;
  channel: ShipChatChannel;
  chatId: string;
  userId?: string;
  username?: string;
  messageId?: string;
  messageThreadId?: number;
  chatType?: string;
  requestId?: string;
  kind?: ShipHistoryKind;
  source?: ShipHistorySource;
  sourceRange?: ShipMessageSourceRangeV1;
  /**
   * 额外信息（可选，审计/排查用，不保证被模型使用）。
   */
  extra?: Record<string, unknown>;
};

export type ShipMessageV1 = UIMessage<ShipMessageMetadataV1>;
