/**
 * Chat command services.
 *
 * 关键点（中文）
 * - 统一处理 chat 上下文快照（参数 / 环境变量 / request context）
 * - 统一处理 chatKey 解析优先级，避免 CLI/Server 出现行为分叉
 */

import { sendTextByChatKey } from "./runtime/chatkey-send.js";
import { chatRequestContext } from "../../core/runtime/request-context.js";
import { llmRequestContext } from "../../telemetry/index.js";
import type {
  ChatContextSnapshot,
  ChatSendResponse,
} from "../../types/module-command.js";

function readEnvString(name: string): string | undefined {
  const value = String(process.env[name] || "").trim();
  return value ? value : undefined;
}

function readEnvNumber(name: string): number | undefined {
  const raw = readEnvString(name);
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return undefined;
  return parsed;
}

export function resolveChatContextSnapshot(input?: {
  chatKey?: string;
}): ChatContextSnapshot {
  const requestCtx = chatRequestContext.getStore();
  const llmCtx = llmRequestContext.getStore();

  const explicitChatKey = String(input?.chatKey || "").trim();

  const snapshot: ChatContextSnapshot = {
    chatKey:
      explicitChatKey ||
      (typeof requestCtx?.chatKey === "string" && requestCtx.chatKey.trim()
        ? requestCtx.chatKey.trim()
        : readEnvString("SMA_CTX_CHAT_KEY")),
    channel:
      (typeof requestCtx?.channel === "string" && requestCtx.channel.trim()
        ? requestCtx.channel.trim()
        : readEnvString("SMA_CTX_CHANNEL")) || undefined,
    chatId:
      (typeof requestCtx?.chatId === "string" && requestCtx.chatId.trim()
        ? requestCtx.chatId.trim()
        : readEnvString("SMA_CTX_CHAT_ID")) || undefined,
    messageThreadId:
      typeof requestCtx?.messageThreadId === "number"
        ? requestCtx.messageThreadId
        : readEnvNumber("SMA_CTX_MESSAGE_THREAD_ID"),
    chatType:
      (typeof requestCtx?.chatType === "string" && requestCtx.chatType.trim()
        ? requestCtx.chatType.trim()
        : readEnvString("SMA_CTX_CHAT_TYPE")) || undefined,
    userId:
      (typeof requestCtx?.userId === "string" && requestCtx.userId.trim()
        ? requestCtx.userId.trim()
        : readEnvString("SMA_CTX_USER_ID")) || undefined,
    messageId:
      (typeof requestCtx?.messageId === "string" && requestCtx.messageId.trim()
        ? requestCtx.messageId.trim()
        : readEnvString("SMA_CTX_MESSAGE_ID")) || undefined,
    requestId:
      (typeof llmCtx?.requestId === "string" && llmCtx.requestId.trim()
        ? llmCtx.requestId.trim()
        : readEnvString("SMA_CTX_REQUEST_ID")) || undefined,
  };

  return snapshot;
}

export function resolveChatKey(input?: { chatKey?: string }): string | undefined {
  const snapshot = resolveChatContextSnapshot({ chatKey: input?.chatKey });
  const key = String(snapshot.chatKey || "").trim();
  return key ? key : undefined;
}

export async function sendChatTextByChatKey(params: {
  chatKey: string;
  text: string;
}): Promise<ChatSendResponse> {
  const chatKey = String(params.chatKey || "").trim();
  const text = String(params.text ?? "");
  if (!chatKey) {
    return {
      success: false,
      error: "Missing chatKey",
    };
  }

  const result = await sendTextByChatKey({ chatKey, text });
  return {
    success: Boolean(result.success),
    chatKey,
    ...(result.success ? {} : { error: result.error || "chat send failed" }),
  };
}
