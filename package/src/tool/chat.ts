import { z } from "zod";
import { tool } from "ai";
import { chatRequestContext } from "../runtime/chat/request-context.js";
import { getChatDispatcher, type ChatDispatchChannel } from "../runtime/chat/dispatcher.js";

const chatSendInputSchema = z.object({
  text: z.string().describe("Text to send to the chat."),
  channel: z
    .enum(["telegram", "feishu", "qq"])
    .optional()
    .describe("Platform to send message (telegram/feishu/qq). Optional - if not specified, defaults to the platform where the user's message came from."),
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
  description: (() => {
    const store = chatRequestContext.getStore();
    const contextInfo = store?.source ? ` Current context: user messaged from ${store.source}.` : "";
    return `Send a chat message back to the user. ${contextInfo} The channel parameter is optional - if not specified, the message will be sent to the platform where the user's message came from. If the user explicitly requests a specific platform (e.g., "send via QQ"), use that platform by specifying the channel parameter.`;
  })(),
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

export const chatTools = { chat_send };
