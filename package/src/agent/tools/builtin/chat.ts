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
import { toolExecutionContext, injectSystemMessageOnce } from "./execution-context.js";
import { getToolRuntimeContext } from "../set/runtime-context.js";
import { tryClaimChatEgressChatSend, markChatEgressChatSendDelivered, releaseChatEgressChatSendClaim } from "../../../chat/egress-idempotency.js";
import { createHash } from "node:crypto";

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

      const { config } = getToolRuntimeContext();
      const maxCalls =
        typeof config.context?.chatEgress?.chatSendMaxCallsPerRun === "number" &&
        Number.isFinite(config.context.chatEgress.chatSendMaxCallsPerRun) &&
        config.context.chatEgress.chatSendMaxCallsPerRun > 0
          ? config.context.chatEgress.chatSendMaxCallsPerRun
          : 3;

      if (next > maxCalls) {
        // 超预算时，注入一次系统约束，帮助模型尽快停止继续调用（避免无意义消耗）。
        injectSystemMessageOnce({
          ctx: toolCtx,
          fingerprint: "guard:chat_send_budget_exceeded",
          content:
            "系统约束（重要）：你已经多次调用 chat_send，已触发发送预算上限。现在禁止继续调用 chat_send；请停止工具调用并结束本次回复。",
        });
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

    const { projectRoot, config } = getToolRuntimeContext();
    const enableIdempotency =
      config.context?.chatEgress?.chatSendIdempotency === undefined
        ? true
        : Boolean(config.context.chatEgress.chatSendIdempotency);

    // 出站幂等（best-effort）：同一条 inbound messageId + 同一段回复内容最多发送一次。
    let claim:
      | { claimed: true; markerFile?: string }
      | { claimed: false; reason: string }
      | null = null;
    if (enableIdempotency && typeof messageId === "string" && messageId.trim()) {
      const messageKey = `${messageId.trim()}:${hashTextForEgressKey(text)}`;
      claim = await tryClaimChatEgressChatSend({
        projectRoot,
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
