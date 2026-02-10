import type { UIMessage } from "ai";
import type { ChatDispatchChannel } from "./chat-dispatcher.js";

/**
 * Session 历史：以 UIMessage[] 作为唯一事实源。
 *
 * 关键点（中文）
 * - 持久化存储在 `.ship/session/<encodedSessionId>/messages/history.jsonl`
 * - 默认只存 `role=user|assistant`
 * - compact 会把更早消息压缩为一条 `assistant` 摘要消息
 */

export type ShipSessionChannel = ChatDispatchChannel | "api" | "cli" | "scheduler";

export type ShipHistoryKind = "normal" | "summary";
export type ShipHistorySource = "ingress" | "egress" | "compact";

export type ShipMessageSourceRangeV1 = {
  fromId: string;
  toId: string;
  count: number;
};

export type ShipSessionMetadataV1 = {
  v: 1;
  ts: number;
  sessionId: string;
  channel: ShipSessionChannel;
  targetId: string;
  actorId?: string;
  actorName?: string;
  messageId?: string;
  threadId?: number;
  targetType?: string;
  requestId?: string;
  kind?: ShipHistoryKind;
  source?: ShipHistorySource;
  sourceRange?: ShipMessageSourceRangeV1;
  extra?: Record<string, unknown>;
};

export type ShipSessionMessageV1 = UIMessage<ShipSessionMetadataV1>;
