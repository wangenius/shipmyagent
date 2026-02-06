/**
 * `chat_contact_send`：按 chatKey 指定目标 chat 发送消息。
 *
 * 背景
 * - 以前的 “ContactBook（联系人簿）” 通过 username -> chatId/chatKey 映射实现跨会话投递。
 * - 现在移除联系人簿，统一使用 chatKey 作为跨会话投递的唯一定位符。
 *
 * 设计
 * - 输入仅需要 `chatKey + text`
 * - 通过 ChatStore 的最近日志反推 `channel/chatId/chatType/messageThreadId/messageId` 等投递参数
 *
 * 关键点（中文）
 * - 如果该 chatKey 没有任何历史记录，将无法推断投递目标（channel/chatId），因此会返回错误。
 * - QQ 被动回复需要 `chatType + messageId`：本工具会从该 chatKey 的最近 user 消息里回溯拿到它们；
 *   若仍缺失，则提示对方先发一条消息以建立上下文。
 */

import { z } from "zod";
import { tool } from "ai";
import { getChatDispatcher, type ChatDispatchChannel } from "../../../chat/egress/dispatcher.js";
import { getToolRuntimeContext } from "../set/runtime-context.js";
import type { ChatLogEntryV1 } from "../../../chat/store/store.js";

const chatContactSendInputSchema = z.object({
  chatKey: z
    .string()
    .trim()
    .min(1)
    .describe("Target chatKey to send to (must already have chat history on disk)."),
  text: z.string().describe("Text to send."),
});

const DISPATCHABLE_CHANNELS = ["telegram", "feishu", "qq"] as const;
type DispatchableChannel = (typeof DISPATCHABLE_CHANNELS)[number];

function isDispatchableChannel(v: unknown): v is DispatchableChannel {
  return typeof v === "string" && (DISPATCHABLE_CHANNELS as readonly string[]).includes(v);
}

function pickLatestDispatchEntry(entries: ChatLogEntryV1[]): ChatLogEntryV1 | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const e = entries[i];
    if (!e) continue;
    if (!isDispatchableChannel(e.channel)) continue;
    if (!String(e.chatId || "").trim()) continue;
    return e;
  }
  return null;
}

function pickLatestUserMeta(entries: ChatLogEntryV1[]): {
  chatType?: string;
  messageThreadId?: number;
  messageId?: string;
} {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const e = entries[i];
    if (!e) continue;
    if (e.role !== "user") continue;
    if (!isDispatchableChannel(e.channel)) continue;

    const meta = (e.meta || {}) as any;
    const chatType = typeof meta.chatType === "string" ? meta.chatType.trim() : undefined;
    const messageThreadId =
      typeof meta.messageThreadId === "number" && Number.isFinite(meta.messageThreadId)
        ? meta.messageThreadId
        : undefined;
    const messageId = typeof e.messageId === "string" ? e.messageId.trim() : undefined;

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
    "Send a message to another chat by chatKey. This reads the target chat's recent transcript to infer delivery params (channel/chatId/etc.).",
  inputSchema: chatContactSendInputSchema,
  execute: async (input) => {
    const chatKey = String((input as any).chatKey || "").trim();
    const text = String((input as any).text ?? "");
    if (!chatKey) return { success: false, error: "Missing chatKey" };
    if (!text.trim()) return { success: true };

    const { chat } = getToolRuntimeContext();
    const chatStore = chat.get(chatKey);

    let entries: ChatLogEntryV1[] = [];
    try {
      entries = await chatStore.loadRecentEntries(80);
    } catch (e) {
      return { success: false, error: String(e) };
    }

    const latest = pickLatestDispatchEntry(entries);
    if (!latest) {
      return {
        success: false,
        error:
          `No dispatchable chat history found for chatKey: ${chatKey}. ` +
          "This tool needs existing transcript entries to infer (channel/chatId).",
      };
    }

    const channel = latest.channel as ChatDispatchChannel;
    const chatId = String(latest.chatId || "").trim();
    if (!chatId) return { success: false, error: "Missing chatId (from chat history)" };

    const dispatcher = getChatDispatcher(channel);
    if (!dispatcher) {
      return { success: false, error: `No dispatcher registered for channel: ${channel}` };
    }

    // 尽量从最近的 user entry 拿到 chatType/messageThreadId/messageId（尤其 QQ 需要）
    const meta = pickLatestUserMeta(entries);
    const chatType = typeof meta.chatType === "string" ? meta.chatType : undefined;
    const messageThreadId = typeof meta.messageThreadId === "number" ? meta.messageThreadId : undefined;
    const messageId = typeof meta.messageId === "string" ? meta.messageId : undefined;

    if (channel === "qq") {
      if (!chatType || !messageId) {
        return {
          success: false,
          error:
            "QQ requires chatType + messageId to send a reply. Ask the target user to send a message first so ShipMyAgent can record the latest messageId in chat history.",
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
