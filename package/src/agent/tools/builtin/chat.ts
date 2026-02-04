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
import { getToolRuntimeContext } from "../set/runtime-context.js";
import {
  markChatEgressChatSendDelivered,
  releaseChatEgressChatSendClaim,
  tryClaimChatEgressChatSend,
} from "../../../chat/egress-idempotency.js";

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

    // 关键防线：同一条 inbound messageId 只允许发送一次，避免模型在 tool-loop 中重复 chat_send 造成刷屏。
    let markerFile: string | undefined = undefined;
    if (typeof messageId === "string" && messageId.trim()) {
      try {
        const { projectRoot } = getToolRuntimeContext();
        const claim = await tryClaimChatEgressChatSend({
          projectRoot,
          channel,
          chatId,
          messageId,
          meta: { textPreview: text.slice(0, 200) },
        });
        if (!claim.claimed) {
          return { success: true, skipped: true, reason: claim.reason };
        }
        markerFile = claim.markerFile || undefined;
      } catch {
        // ignore (best-effort)
      }
    }

    try {
      const r = await dispatcher.sendText({
        chatId,
        text,
        ...(typeof messageThreadId === "number" ? { messageThreadId } : {}),
        ...(typeof chatType === "string" && chatType ? { chatType } : {}),
        ...(typeof messageId === "string" && messageId ? { messageId } : {}),
      });
      if (r?.success && markerFile) {
        await markChatEgressChatSendDelivered({
          markerFile,
          deliveredMeta: { textLen: text.length },
        });
      }
      if (!r?.success && markerFile) {
        // 发送失败：释放 claim，允许后续重试（最佳努力）。
        await releaseChatEgressChatSendClaim(markerFile);
      }
      return r;
    } catch (e) {
      if (markerFile) {
        await releaseChatEgressChatSendClaim(markerFile);
      }
      throw e;
    }
  },
});

export const chatTools = { chat_send };
