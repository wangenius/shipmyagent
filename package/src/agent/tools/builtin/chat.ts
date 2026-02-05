/**
 * Chat delivery tools (tool-strict).
 *
 * Provides the `chat_send` tool which routes messages through the runtime's
 * dispatcher registry. Adapters register dispatchers per platform, and the
 * agent uses this tool to send user-visible replies.
 */

import { z } from "zod";
import { tool } from "ai";
import { chatRequestContext } from "../../../chat/request-context.js";
import { getChatDispatcher, type ChatDispatchChannel } from "../../../chat/dispatcher.js";

const chatSendInputSchema = z.object({
  text: z.string().describe("Text to send back to the current chat."),
});

export const chat_send = tool({
  description: (() => {
    const store = chatRequestContext.getStore();
    const contextInfo =
      store?.channel && store?.chatId
        ? ` Current context: channel=${store.channel}, chatId=${store.chatId}.`
        : "";
    return `Send a chat message back to the current chat.${contextInfo}`;
  })(),
  inputSchema: chatSendInputSchema,
  execute: async (input) => {
    const store = chatRequestContext.getStore();
    const channel = store?.channel as ChatDispatchChannel | undefined;
    const chatId = store?.chatId;
    const messageThreadId = store?.messageThreadId;
    const chatType = store?.chatType;
    const messageId = store?.messageId;

    if (!channel) {
      return {
        success: false,
        error:
          "No chat channel available. Call this tool from a chat-triggered context.",
      };
    }
    if (!chatId) {
      return {
        success: false,
        error:
          "No chatId available. Call this tool from a chat-triggered context.",
      };
    }

    const dispatcher = getChatDispatcher(channel);
    if (!dispatcher) {
      return {
        success: false,
        error: `No dispatcher registered for channel: ${channel}`,
      };
    }

    const text = String(input.text ?? "");

    try {
      const r = await dispatcher.sendText({
        chatId,
        text,
        ...(typeof messageThreadId === "number" ? { messageThreadId } : {}),
        ...(typeof chatType === "string" && chatType ? { chatType } : {}),
        ...(typeof messageId === "string" && messageId ? { messageId } : {}),
      });
      return r;
    } catch (e) {
      throw e;
    }
  },
});

export const chatTools = { chat_send };
