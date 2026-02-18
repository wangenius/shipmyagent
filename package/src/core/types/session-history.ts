import type { UIMessage } from "ai";
/**
 * Session 历史：以 UIMessage[] 作为唯一事实源。
 *
 * 关键点（中文）
 * - 持久化存储在 `.ship/session/<encodedSessionId>/messages/history.jsonl`
 * - 默认只存 `role=user|assistant`
 * - compact 会把更早消息压缩为一条 `assistant` 摘要消息
 */

export type ShipSessionChannel =
  | "telegram"
  | "feishu"
  | "qq"
  | "api"
  | "cli"
  | "scheduler";

export type ShipHistoryKind = "normal" | "summary";
export type ShipHistorySource = "ingress" | "egress" | "compact";

export type ShipMessageSourceRangeV1 = {
  fromId: string;
  toId: string;
  count: number;
};

export type ShipSessionMetadataV1 = {
  /** schema 版本 */
  v: 1;
  /** 记录时间戳（ms） */
  ts: number;
  /** 会话 ID */
  sessionId: string;
  /** 渠道类型 */
  channel: ShipSessionChannel;
  /** 渠道侧目标 ID（chatId 等） */
  targetId: string;
  /** 发起人 ID */
  actorId?: string;
  /** 发起人昵称 */
  actorName?: string;
  /** 平台原始消息 ID */
  messageId?: string;
  /** 线程/话题 ID */
  threadId?: number;
  /** 目标类型（group/private/topic 等） */
  targetType?: string;
  /** 请求链路 ID */
  requestId?: string;
  /** normal/summary */
  kind?: ShipHistoryKind;
  /** ingress/egress/compact */
  source?: ShipHistorySource;
  /** compact 来源范围 */
  sourceRange?: ShipMessageSourceRangeV1;
  /** 扩展元信息 */
  extra?: Record<string, unknown>;
};

export type ShipSessionMessageV1 = UIMessage<ShipSessionMetadataV1>;
