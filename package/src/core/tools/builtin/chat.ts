/**
 * Chat delivery tools (tool-strict).
 *
 * Provides the `chat_send` tool which routes messages through the runtime's
 * dispatcher registry. Adapters register dispatchers per platform, and the
 * agent uses this tool to send user-visible replies.
 */

import { z } from "zod";
import { tool } from "ai";
import { chatRequestContext } from "../../runtime/request-context.js";
import { getChatDispatcher, type ChatDispatchChannel } from "../../egress/dispatcher.js";
import { toolExecutionContext } from "./execution-context.js";
import { tryClaimChatEgressChatSend, markChatEgressChatSendDelivered, releaseChatEgressChatSendClaim } from "../../egress/egress-idempotency.js";
import { createHash } from "node:crypto";
import { getShipRuntimeContext } from "../../../server/ShipRuntimeContext.js";

const chatSendInputSchema = z.object({
  text: z.string().describe("Text to send back to the current chat."),
});

function hashTextForEgressKey(text: string): string {
  // 关键点（中文）：hash 只用于幂等 key；不需要可逆，也不应泄露明文内容。
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

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
    const toolCtx = toolExecutionContext.getStore();
    if (toolCtx) {
      const prev = toolCtx.toolCallCounts.get("chat_send") ?? 0;
      const next = prev + 1;
      toolCtx.toolCallCounts.set("chat_send", next);

      const chatEgress = getShipRuntimeContext().config.context?.chatEgress;
      const maxCalls =
        typeof chatEgress?.chatSendMaxCallsPerRun === "number" &&
        Number.isFinite(chatEgress.chatSendMaxCallsPerRun) &&
        chatEgress.chatSendMaxCallsPerRun > 0
          ? chatEgress.chatSendMaxCallsPerRun
          : 3;

      if (next > maxCalls) {
        return {
          success: false,
          error: `chat_send budget exceeded (max ${maxCalls} calls per run).`,
        };
      }
    }

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
    if (!text.trim()) return { success: true };

    const chatEgress = getShipRuntimeContext().config.context?.chatEgress;
    const enableIdempotency =
      chatEgress?.chatSendIdempotency === undefined
        ? true
        : Boolean(chatEgress.chatSendIdempotency);

    // 出站幂等（best-effort）：同一条 inbound messageId + 同一段回复内容最多发送一次。
    let claim:
      | { claimed: true; markerFile?: string }
      | { claimed: false; reason: string }
      | null = null;
    if (enableIdempotency && typeof messageId === "string" && messageId.trim()) {
      const messageKey = `${messageId.trim()}:${hashTextForEgressKey(text)}`;
      claim = await tryClaimChatEgressChatSend({
        channel,
        chatId,
        messageId: messageId.trim(),
        messageKey,
        meta: { tool: "chat_send" },
      });
      if (claim && claim.claimed === false && claim.reason === "already_claimed") {
        return { success: true, skippedReason: "egress_deduped" };
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
      if (claim && claim.claimed === true && claim.markerFile && r.success) {
        await markChatEgressChatSendDelivered({
          markerFile: claim.markerFile,
          deliveredMeta: { ok: true },
        });
      }
      if (claim && claim.claimed === true && claim.markerFile && !r.success) {
        await releaseChatEgressChatSendClaim(claim.markerFile);
      }
      return r;
    } catch (e) {
      if (claim && claim.claimed === true && claim.markerFile) {
        await releaseChatEgressChatSendClaim(claim.markerFile);
      }
      throw e;
    }
  },
});

export const chatTools = { chat_send };
