/**
 * Send text to a target chat using chatKey.
 *
 * 设计动机（中文）
 * - Task runner / scheduler 需要在“非当前对话上下文”向指定 chatKey 投递消息
 * - 复用现有 dispatcher 与 chat history（尤其 QQ 的被动回复依赖 messageId）
 *
 * 注意
 * - 这里是运行时内部能力（不是 tool）；tool `chat_contact_send` 也会复用本实现
 */

import { getChatDispatcher, type ChatDispatchChannel } from "./dispatcher.js";
import type { ShipMessageV1 } from "../../types/chat-history.js";
import { getShipRuntimeContext } from "../../server/ShipRuntimeContext.js";

type DispatchableChannel = "telegram" | "feishu" | "qq";

export function parseChatKeyForDispatch(chatKey: string): {
  channel: DispatchableChannel;
  chatId: string;
  chatType?: string;
  messageThreadId?: number;
} | null {
  const key = String(chatKey || "").trim();
  if (!key) return null;

  // Telegram: telegram-chat-<id> 或 telegram-chat-<id>-topic-<thread>
  const tgTopic = key.match(/^telegram-chat-([^-\s]+)-topic-(\d+)$/i);
  if (tgTopic) {
    return {
      channel: "telegram",
      chatId: tgTopic[1],
      messageThreadId: Number.parseInt(tgTopic[2], 10),
    };
  }
  const tg = key.match(/^telegram-chat-([^-\s]+)$/i);
  if (tg) return { channel: "telegram", chatId: tg[1] };

  // Feishu: feishu-chat-<id>
  const fe = key.match(/^feishu-chat-(.+)$/i);
  if (fe) return { channel: "feishu", chatId: fe[1] };

  // QQ: qq-<chatType>-<chatId>
  const qq = key.match(/^qq-([^-\s]+)-(.+)$/i);
  if (qq) return { channel: "qq", chatType: qq[1], chatId: qq[2] };

  return null;
}

function pickLatestUserMetaFromMessages(messages: ShipMessageV1[]): {
  chatType?: string;
  messageThreadId?: number;
  messageId?: string;
} {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m || typeof m !== "object") continue;
    if (m.role !== "user") continue;
    const md = (m as any).metadata || {};
    const chatType = typeof md.chatType === "string" ? md.chatType.trim() : undefined;
    const messageThreadId =
      typeof md.messageThreadId === "number" && Number.isFinite(md.messageThreadId)
        ? md.messageThreadId
        : undefined;
    const messageId = typeof md.messageId === "string" ? md.messageId.trim() : undefined;
    if (chatType || messageThreadId || messageId) {
      return {
        ...(chatType ? { chatType } : {}),
        ...(typeof messageThreadId === "number" ? { messageThreadId } : {}),
        ...(messageId ? { messageId } : {}),
      };
    }
  }
  return {};
}

export async function sendTextByChatKey(params: {
  chatKey: string;
  text: string;
}): Promise<{ success: boolean; error?: string }> {
  const chatKey = String(params.chatKey || "").trim();
  const text = String(params.text ?? "");
  if (!chatKey) return { success: false, error: "Missing chatKey" };
  if (!text.trim()) return { success: true };

  const parsed = parseChatKeyForDispatch(chatKey);
  if (!parsed) {
    return { success: false, error: `Unsupported chatKey format: ${chatKey}` };
  }

  const channel = parsed.channel as ChatDispatchChannel;
  const chatId = String(parsed.chatId || "").trim();
  if (!chatId) return { success: false, error: "Missing chatId (from chatKey)" };

  const dispatcher = getChatDispatcher(channel);
  if (!dispatcher) {
    return { success: false, error: `No dispatcher registered for channel: ${channel}` };
  }

  // 关键点（中文）：尽量从 history 的最近 user message 拿到 chatType/messageThreadId/messageId（尤其 QQ 需要）。
  const historyStore = getShipRuntimeContext().chatRuntime.getHistoryStore(chatKey);
  let messages: ShipMessageV1[] = [];
  try {
    messages = await historyStore.loadAll();
  } catch {
    messages = [];
  }
  const meta = pickLatestUserMetaFromMessages(messages);

  const chatType =
    typeof meta.chatType === "string"
      ? meta.chatType
      : typeof parsed.chatType === "string"
        ? parsed.chatType
        : undefined;
  const messageThreadId =
    typeof meta.messageThreadId === "number"
      ? meta.messageThreadId
      : typeof parsed.messageThreadId === "number"
        ? parsed.messageThreadId
        : undefined;
  const messageId = typeof meta.messageId === "string" ? meta.messageId : undefined;

  if (channel === "qq") {
    if (!chatType || !messageId) {
      return {
        success: false,
        error:
          "QQ requires chatType + messageId to send a reply. Ask the target user to send a message first so ShipMyAgent can record the latest messageId in history.",
      };
    }
  }

  return dispatcher.sendText({
    chatId,
    text,
    ...(typeof messageThreadId === "number" ? { messageThreadId } : {}),
    ...(typeof chatType === "string" && chatType ? { chatType } : {}),
    ...(typeof messageId === "string" && messageId ? { messageId } : {}),
  }) as any;
}

