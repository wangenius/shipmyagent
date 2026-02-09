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
import { sendTextByChatKey } from "../../egress/chatkey-send.js";

const chatContactSendInputSchema = z.object({
  chatKey: z
    .string()
    .trim()
    .min(1)
    .describe("Target chatKey to send to (must already have chat history on disk)."),
  text: z.string().describe("Text to send."),
});

export const chat_contact_send = tool({
  description:
    "Send a message to another chat by chatKey. This parses the chatKey and uses history to infer required delivery params (e.g. QQ messageId).",
  inputSchema: chatContactSendInputSchema,
  execute: async (input) => {
    const chatKey = String((input as any).chatKey || "").trim();
    const text = String((input as any).text ?? "");
    return await sendTextByChatKey({ chatKey, text });
  },
});

export const chatContactSendTools = { chat_contact_send };
