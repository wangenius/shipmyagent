import type { ChatDispatchChannel } from "./dispatcher.js";
import { getChatDispatcher } from "./dispatcher.js";

type ToolCallLike =
  | { tool: string; output?: string; result?: string }
  | { tool: string; output: string }
  | { tool: string; result: string };

/**
 * Final-output delivery helpers for chat integrations.
 *
 * Background
 * - Chat integrations often run the agent in a "tool-strict" mode where the model *should* call `chat_send`/`send_message`
 *   to deliver replies.
 * - In practice, models sometimes forget to call the tool and instead only emit plain text output. Without a fallback,
 *   the user sees nothing in the chat.
 *
 * This module provides a conservative fallback:
 * - If the agent already called `chat_send`/`send_message` successfully, do nothing (avoid duplicate messages).
 * - Otherwise, send the agent's final `output` to the current `chatId` via the registered dispatcher.
 */
export function hasSuccessfulChatSendToolCall(toolCalls?: ToolCallLike[]): boolean {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return false;

  for (const tc of toolCalls) {
    const name = String((tc as any)?.tool || "");
    if (name !== "chat_send" && name !== "send_message") continue;

    const raw = String((tc as any)?.output ?? (tc as any)?.result ?? "").trim();
    if (!raw) {
      // Tool was invoked but we don't know the result; treat as "sent" to avoid double-send.
      return true;
    }

    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && (parsed as any).success === true) return true;
    } catch {
      // Non-JSON output (or stringified in a non-standard way). Best-effort string check.
      if (raw.includes('"success":true') || raw.includes("'success':true")) return true;
      if (raw.includes('"success":false') || raw.includes("'success':false")) continue;
      // Unknown format: treat as "not delivered" so we still attempt a fallback send.
      continue;
    }
  }

  return false;
}

export async function sendFinalOutputIfNeeded(params: {
  channel: ChatDispatchChannel;
  chatId: string;
  output: string;
  toolCalls?: ToolCallLike[];
  messageThreadId?: number;
  chatType?: string;
  messageId?: string;
}): Promise<{ sent: boolean; skippedReason?: string; error?: string }> {
  const chatId = String(params.chatId || "").trim();
  const text = String(params.output ?? "");

  if (!chatId) return { sent: false, skippedReason: "missing_chat_id" };
  if (!text.trim()) return { sent: false, skippedReason: "empty_output" };
  if (hasSuccessfulChatSendToolCall(params.toolCalls)) {
    return { sent: false, skippedReason: "already_sent_via_tool" };
  }

  const dispatcher = getChatDispatcher(params.channel);
  if (!dispatcher) return { sent: false, error: `No dispatcher registered for channel: ${params.channel}` };

  const r = await dispatcher.sendText({
    chatId,
    text,
    ...(typeof params.messageThreadId === "number" ? { messageThreadId: params.messageThreadId } : {}),
    ...(typeof params.chatType === "string" && params.chatType ? { chatType: params.chatType } : {}),
    ...(typeof params.messageId === "string" && params.messageId ? { messageId: params.messageId } : {}),
  });

  return r.success ? { sent: true } : { sent: false, error: r.error || "send_failed" };
}
