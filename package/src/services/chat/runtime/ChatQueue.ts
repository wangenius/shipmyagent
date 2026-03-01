/**
 * ChatQueue（进程内队列）。
 *
 * 关键点（中文）
 * - 进程内共享队列：services 入队、process 消费
 * - 作为插件级模块，被 process 直接引用
 * - 允许后续替换为 IPC/DB，不影响调用方
 */

import type {
  ChatQueueEnqueueParams,
  ChatQueueEnqueueResult,
  ChatQueueItem,
} from "../types/ChatQueue.js";

type EnqueueListener = (laneKey: string) => void;

const lanes: Map<string, ChatQueueItem[]> = new Map();
const listeners: Set<EnqueueListener> = new Set();
let nextSeq = 1;

function generateItemId(): string {
  const seq = nextSeq;
  nextSeq += 1;
  return `q:${Date.now().toString(36)}:${seq.toString(36)}`;
}

function getLane(key: string): ChatQueueItem[] {
  const lane = lanes.get(key);
  if (lane) return lane;
  const created: ChatQueueItem[] = [];
  lanes.set(key, created);
  return created;
}

function normalizeLaneKey(raw: string): string {
  const key = String(raw || "").trim();
  if (!key) throw new Error("ChatQueue requires a non-empty lane key");
  return key;
}

/**
 * 订阅入队事件。
 */
export function onChatQueueEnqueue(listener: EnqueueListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 入队。
 */
export function enqueueChatQueue(
  params: ChatQueueEnqueueParams,
): ChatQueueEnqueueResult {
  const laneKey = normalizeLaneKey(params.contextId);
  const lane = getLane(laneKey);
  const item: ChatQueueItem = {
    ...params,
    id: generateItemId(),
    enqueuedAt: Date.now(),
    kind: params.kind ?? "exec",
  };
  lane.push(item);
  for (const listener of listeners) {
    try {
      listener(laneKey);
    } catch {
      // ignore
    }
  }
  return {
    lanePosition: lane.length,
    itemId: item.id,
  };
}

/**
 * 弹出 lane 的第一条消息。
 */
export function shiftChatQueueItem(laneKey: string): ChatQueueItem | null {
  const key = normalizeLaneKey(laneKey);
  const lane = lanes.get(key);
  if (!lane || lane.length === 0) return null;
  const item = lane.shift() || null;
  if (lane.length === 0) lanes.delete(key);
  return item;
}

/**
 * 一次性 drain 某个 lane 的全部消息（或前 N 条）。
 */
export function drainChatQueueLane(
  laneKey: string,
  maxItems?: number,
): ChatQueueItem[] {
  const key = normalizeLaneKey(laneKey);
  const lane = lanes.get(key);
  if (!lane || lane.length === 0) return [];

  if (typeof maxItems === "number" && maxItems > 0 && maxItems < lane.length) {
    return lane.splice(0, Math.floor(maxItems));
  }

  lanes.delete(key);
  return lane.splice(0, lane.length);
}

/**
 * 获取当前有积压的 lane keys。
 */
export function listChatQueueLanes(): string[] {
  return Array.from(lanes.keys());
}

/**
 * 查询 lane 长度。
 */
export function getChatQueueLaneSize(laneKey: string): number {
  const key = String(laneKey || "").trim();
  if (!key) return 0;
  const lane = lanes.get(key);
  return lane ? lane.length : 0;
}

/**
 * 清空某个 lane。
 */
export function clearChatQueueLane(laneKey: string): void {
  const key = String(laneKey || "").trim();
  if (!key) return;
  lanes.delete(key);
}
