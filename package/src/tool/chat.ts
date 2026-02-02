import { z } from "zod";
import { tool } from "ai";
import { chatRequestContext } from "../runtime/chat/request-context.js";
import { getChatDispatcher, type ChatDispatchChannel } from "../runtime/chat/dispatcher.js";

const chatSendInputSchema = z.object({
  text: z.string().describe("Text to send to the chat."),
  channel: z
    .enum(["telegram", "feishu", "qq"])
    .optional()
    .describe("Override the destination channel. Defaults to current chat context."),
  chatId: z
    .string()
    .optional()
    .describe("Override the destination chatId. Defaults to current chat context userId."),
  messageThreadId: z
    .number()
    .optional()
    .describe("Optional thread/topic id (Telegram topics etc). Defaults to current chat context."),
  chatType: z
    .string()
    .optional()
    .describe("Optional platform chat type (e.g. feishu p2p/group, qq group/c2c/channel). Defaults to current chat context."),
  messageId: z
    .string()
    .optional()
    .describe("Optional message id to reply to (platform-specific). Defaults to current chat context."),
});

export const chat_send = tool({
  description:
    "Send a chat message back to the user on the current channel (e.g. Telegram/Feishu). Use this when you want to control when/how many messages are sent.",
  inputSchema: chatSendInputSchema,
  execute: async (input) => {
    const store = chatRequestContext.getStore();
    const inferredChannel =
      input.channel ||
      (store?.source === "telegram" ||
      store?.source === "feishu" ||
      store?.source === "qq"
        ? store.source
        : undefined);
    const channel = inferredChannel as ChatDispatchChannel | undefined;
    const chatId = input.chatId || store?.userId;
    const messageThreadId =
      typeof input.messageThreadId === "number"
        ? input.messageThreadId
        : store?.messageThreadId;
    const chatType = input.chatType || store?.chatType;
    const messageId = input.messageId || store?.messageId;

    if (!channel) {
      return {
        success: false,
        error:
          "No chat channel available. Provide `channel`, or call this tool from a chat-triggered context.",
      };
    }
    if (!chatId) {
      return {
        success: false,
        error:
          "No chatId available. Provide `chatId`, or call this tool from a chat-triggered context.",
      };
    }

    const dispatcher = getChatDispatcher(channel);
    if (!dispatcher) {
      return {
        success: false,
        error: `No dispatcher registered for channel: ${channel}`,
      };
    }

    return dispatcher.sendText({
      chatId,
      text: String(input.text ?? ""),
      ...(typeof messageThreadId === "number" ? { messageThreadId } : {}),
      ...(typeof chatType === "string" && chatType ? { chatType } : {}),
      ...(typeof messageId === "string" && messageId ? { messageId } : {}),
    });
  },
});

// Alias for ergonomics / common naming in prompts.
export const send_message = chat_send;

export const chatTools = { chat_send, send_message };
