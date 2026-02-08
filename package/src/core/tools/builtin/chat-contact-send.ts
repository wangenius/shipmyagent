/**
 * `chat_contact_send`：按 chatKey 指定目标 chat 发送消息。
 *
 * 背景
 * - 以前的 “ContactBook（联系人簿）” 通过 username -> chatId/chatKey 映射实现跨会话投递。
 * - 现在移除联系人簿，统一使用 chatKey 作为跨会话投递的唯一定位符。
 *
 * 设计
 * - 输入仅需要 `chatKey + text`
 * - 通过 chatKey 解析出 `channel/chatId/(threadId)`，并从 history 补齐必要的投递参数（如 QQ 的 messageId）
 *
 * 关键点（中文）
 * - QQ 被动回复需要 `chatType + messageId`：本工具会从该 chatKey 的最近 user 消息里回溯拿到它们；
 *   若仍缺失，则提示对方先发一条消息以建立上下文。
 */

import { z } from "zod";
import { tool } from "ai";
import { getChatDispatcher, type ChatDispatchChannel } from "../../egress/dispatcher.js";
import { getToolRuntimeContext } from "../set/runtime-context.js";
import type { ShipMessageV1 } from "../../../types/chat-history.js";

const chatContactSendInputSchema = z.object({
  chatKey: z
    .string()
    .trim()
    .min(1)
    .describe("Target chatKey to send to (must already have chat history on disk)."),
  text: z.string().describe("Text to send."),
});

type DispatchableChannel = "telegram" | "feishu" | "qq";

function parseChatKeyForDispatch(chatKey: string): {
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

export const chat_contact_send = tool({
  description:
    "Send a message to another chat by chatKey. This parses the chatKey and uses history to infer required delivery params (e.g. QQ messageId).",
  inputSchema: chatContactSendInputSchema,
  execute: async (input) => {
    const chatKey = String((input as any).chatKey || "").trim();
    const text = String((input as any).text ?? "");
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

    // 尽量从 history 的最近 user message 拿到 chatType/messageThreadId/messageId（尤其 QQ 需要）
    const { chat } = getToolRuntimeContext();
    const historyStore = chat.get(chatKey);
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
    });
  },
});

export const chatContactSendTools = { chat_contact_send };
