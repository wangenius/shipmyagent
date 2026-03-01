/**
 * ChatQueue 类型定义。
 *
 * 关键点（中文）
 * - 描述 chat 队列的数据结构与入队协议
 * - 供 services 与 process 统一复用
 */

import type { JsonObject } from "../../../types/Json.js";

export type ChatQueueItemKind = "exec" | "audit" | "control";

export type ChatQueueControl = {
  type: "clear";
};

export type ChatQueueItem = {
  id: string;
  enqueuedAt: number;
  kind: ChatQueueItemKind;
  channel: "telegram" | "feishu" | "qq";
  targetId: string;
  contextId: string;
  text: string;
  targetType?: string;
  threadId?: number;
  messageId?: string;
  actorId?: string;
  actorName?: string;
  extra?: JsonObject;
  control?: ChatQueueControl;
};

export type ChatQueueEnqueueParams = Omit<ChatQueueItem, "id" | "enqueuedAt"> & {
  kind?: ChatQueueItemKind;
};

export type ChatQueueEnqueueResult = {
  lanePosition: number;
  itemId: string;
};
