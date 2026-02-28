/**
 * Chat command services.
 *
 * 关键点（中文）
 * - 对外仍是 chatKey 语义（service 边界）
 * - 内部通过注入的 request context bridge 做映射读取
 */

import type { ServiceRuntimeDependencies } from "../../infra/service-runtime-types.js";
import {
  getServiceRequestContextBridge,
} from "../../infra/service-runtime-dependencies.js";
import { sendTextByChatKey } from "./runtime/chatkey-send.js";
import { llmRequestContext } from "../../logger/index.js";
import type {
  ChatContextSnapshot,
  ChatSendResponse,
} from "./types/chat-command.js";

/**
 * 读取字符串环境变量。
 *
 * 关键点（中文）
 * - 自动 trim；空字符串视为未设置。
 */
function readEnvString(name: string): string | undefined {
  const value = String(process.env[name] || "").trim();
  return value ? value : undefined;
}

/**
 * 读取数字环境变量。
 *
 * 关键点（中文）
 * - 解析失败返回 undefined，不抛错。
 */
function readEnvNumber(name: string): number | undefined {
  const raw = readEnvString(name);
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return undefined;
  return parsed;
}

/**
 * 解析 chat 上下文快照。
 *
 * 优先级（中文）
 * 1) 显式参数
 * 2) request context bridge（server 注入）
 * 3) 环境变量回退
 */
export function resolveChatContextSnapshot(input?: {
  chatKey?: string;
  context?: ServiceRuntimeDependencies;
}): ChatContextSnapshot {
  const requestCtx = input?.context
    ? getServiceRequestContextBridge(input.context).getCurrentContextRequestContext()
    : undefined;
  const llmCtx = llmRequestContext.getStore();

  const explicitChatKey = String(input?.chatKey || "").trim();

  const snapshot: ChatContextSnapshot = {
    chatKey:
      explicitChatKey ||
      (typeof requestCtx?.contextId === "string" && requestCtx.contextId.trim()
        ? requestCtx.contextId.trim()
        : readEnvString("SMA_CTX_CONTEXT_ID") ||
          readEnvString("SMA_CTX_CHAT_KEY")),
    channel:
      (typeof requestCtx?.channel === "string" && requestCtx.channel.trim()
        ? requestCtx.channel.trim()
        : readEnvString("SMA_CTX_CHANNEL")) || undefined,
    chatId:
      (typeof requestCtx?.targetId === "string" && requestCtx.targetId.trim()
        ? requestCtx.targetId.trim()
        : readEnvString("SMA_CTX_TARGET_ID") ||
          readEnvString("SMA_CTX_CHAT_ID")) || undefined,
    messageThreadId:
      typeof requestCtx?.threadId === "number"
        ? requestCtx.threadId
        : readEnvNumber("SMA_CTX_THREAD_ID") ||
          readEnvNumber("SMA_CTX_MESSAGE_THREAD_ID"),
    chatType:
      (typeof requestCtx?.targetType === "string" && requestCtx.targetType.trim()
        ? requestCtx.targetType.trim()
        : readEnvString("SMA_CTX_TARGET_TYPE") ||
          readEnvString("SMA_CTX_CHAT_TYPE")) || undefined,
    userId:
      (typeof requestCtx?.actorId === "string" && requestCtx.actorId.trim()
        ? requestCtx.actorId.trim()
        : readEnvString("SMA_CTX_ACTOR_ID") ||
          readEnvString("SMA_CTX_USER_ID")) || undefined,
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

/**
 * 从上下文快照派生 chatKey（当上游未显式给 chatKey 时）。
 *
 * 规则（中文）
 * - Telegram：`telegram-chat-<chatId>` / topic 场景 `telegram-chat-<chatId>-topic-<threadId>`
 * - Feishu：`feishu-chat-<chatId>`
 * - QQ：`qq-<chatType>-<chatId>`（chatType 缺失则无法派生）
 */
function deriveChatKeyFromSnapshot(snapshot: ChatContextSnapshot): string | undefined {
  const channel = String(snapshot.channel || "").trim().toLowerCase();
  const chatId = String(snapshot.chatId || "").trim();
  if (!channel || !chatId) return undefined;

  if (channel === "telegram") {
    const threadId =
      typeof snapshot.messageThreadId === "number" &&
      Number.isFinite(snapshot.messageThreadId)
        ? snapshot.messageThreadId
        : undefined;
    if (typeof threadId === "number" && threadId > 0) {
      return `telegram-chat-${chatId}-topic-${threadId}`;
    }
    return `telegram-chat-${chatId}`;
  }

  if (channel === "feishu") {
    return `feishu-chat-${chatId}`;
  }

  if (channel === "qq") {
    const chatType = String(snapshot.chatType || "").trim();
    if (!chatType) return undefined;
    return `qq-${chatType}-${chatId}`;
  }

  return undefined;
}

/**
 * 提取最终 chatKey（用于发送路径）。
 */
export function resolveChatKey(input?: { chatKey?: string }): string | undefined {
  const snapshot = resolveChatContextSnapshot({ chatKey: input?.chatKey });
  const key = String(snapshot.chatKey || "").trim() || deriveChatKeyFromSnapshot(snapshot) || "";
  return key ? key : undefined;
}

/**
 * 规范化 `chat send` 文本。
 *
 * 关键点（中文）
 * - 当文本只包含字面量转义（如 `\n`）且没有真实换行时，自动解码为真实控制字符。
 * - 这样可兼容模型/脚本把多行文本写成 `\\n` 的场景，避免用户看到原样 `\n`。
 */
function normalizeChatSendText(raw: string): string {
  const text = String(raw ?? "");
  if (!text) return text;

  const hasRealLineBreak = text.includes("\n") || text.includes("\r");
  let normalized = text;

  if (
    !hasRealLineBreak &&
    (text.includes("\\n") || text.includes("\\r") || text.includes("\\t"))
  ) {
    normalized = text
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t");
  }

  return normalized;
}

/**
 * 按 chatKey 发送文本。
 *
 * 关键点（中文）
 * - service 不关心具体平台；由 runtime sender 做 channel 分发。
 * - 返回统一结构，便于上层链路做可观测与错误汇总。
 */
export async function sendChatTextByChatKey(params: {
  context: ServiceRuntimeDependencies;
  chatKey: string;
  text: string;
}): Promise<ChatSendResponse> {
  const chatKey = String(params.chatKey || "").trim();
  const text = normalizeChatSendText(String(params.text ?? ""));
  if (!chatKey) {
    return {
      success: false,
      error: "Missing chatKey",
    };
  }

  const result = await sendTextByChatKey({
    context: params.context,
    chatKey,
    text,
  });
  return {
    success: Boolean(result.success),
    chatKey,
    ...(result.success ? {} : { error: result.error || "chat send failed" }),
  };
}
