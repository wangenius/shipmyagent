/**
 * Context history 类型转发。
 *
 * 关键点（中文）
 * - 源定义在 core/types
 * - integration 通过 infra 引用，保持层级边界
 *
 * 设计意图（中文）
 * - 让 chat/task/memory 等 integration 在不感知 core 目录结构的情况下共享消息协议。
 */

export type {
  ShipContextChannel,
  ShipHistoryKind,
  ShipHistorySource,
  ShipMessageSourceRangeV1,
  ShipContextMetadataV1,
  ShipContextMessageV1,
} from "../core/types/context-history.js";

export type { ShipContextMessagesMetaV1 } from "../core/types/context-messages-meta.js";
