import type { ChatDispatchChannel } from "./chat-send-registry.js";
import { getChatSender } from "./chat-send-registry.js";

type ToolCallLike =
  | { tool: string; output?: string; result?: string }
  | { tool: string; output: string }
  | { tool: string; result: string };

/**
 * Final-output delivery helpers for chat integrations（egress 兜底回包）。
 *
 * Background
 * - Chat integrations often run the agent in a "tool-strict" mode where the model *should* call `chat_send`
 *   to deliver replies.
 * - In practice, models sometimes forget to call the tool and instead only emit plain text output. Without a fallback,
 *   the user sees nothing in the chat.
 *
 * This module provides a conservative fallback:
 * - If the agent already delivered a user-visible message, do nothing (avoid duplicate messages).
 * - Otherwise, send the agent's final `output` to the current `chatId` via the registered dispatcher.
 */
function looksLikeSuccessfulSmaChatSend(raw: string): boolean {
  const text = String(raw || "").trim();
  if (!text) return false;

  // 优先尝试 JSON 解析（`sma chat send --json` 的典型输出）
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      const success = (parsed as any).success === true;
      const hasChatKey = typeof (parsed as any).chatKey === "string";
      if (success && hasChatKey) return true;
    }
  } catch {
    // ignore
  }

  const lowered = text.toLowerCase();
  if (!lowered.includes("sma chat send") && !lowered.includes("chat sent")) {
    return false;
  }
  if (lowered.includes('"success":true') || lowered.includes('"success": true')) {
    return true;
  }
  if (lowered.includes("✅ chat sent")) {
    return true;
  }
  return false;
}

function hasSuccessfulSmaChatSendCommand(toolCalls?: ToolCallLike[]): boolean {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return false;

  for (const tc of toolCalls) {
    const name = String((tc as any)?.tool || "");
    if (name !== "exec_command" && name !== "write_stdin") continue;

    const raw = String((tc as any)?.output ?? (tc as any)?.result ?? "").trim();
    if (!raw) continue;
    if (looksLikeSuccessfulSmaChatSend(raw)) return true;
  }

  return false;
}

export function hasSuccessfulChatSendToolCall(toolCalls?: ToolCallLike[]): boolean {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return false;

  for (const tc of toolCalls) {
    const name = String((tc as any)?.tool || "");
    if (name !== "chat_send") continue;

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
    return { sent: false, skippedReason: "already_sent_via_chat_send" };
  }
  if (hasSuccessfulSmaChatSendCommand(params.toolCalls)) {
    return { sent: false, skippedReason: "already_sent_via_sma_chat_send" };
  }

  const dispatcher = getChatSender(params.channel);
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
