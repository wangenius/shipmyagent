/**
 * chatKey 解析辅助。
 *
 * 关键点（中文）
 * - 这是 infra 公共语义，不属于单个 chat 模块
 * - 用于避免 skills/task module 反向依赖 chat/service
 */

/**
 * 解析 chatKey。
 *
 * 优先级（中文）
 * 1) 显式参数 `input.chatKey`
 * 2) `SMA_CTX_CONTEXT_ID`
 * 3) `SMA_CTX_CHAT_KEY`
 * 4) 由 `SMA_CTX_CHANNEL + SMA_CTX_TARGET_ID (+ THREAD/TYPE)` 派生
 */
export function resolveChatKey(input?: { chatKey?: string }): string | undefined {
  const explicit = String(input?.chatKey || "").trim();
  if (explicit) return explicit;

  const envContextId = String(process.env.SMA_CTX_CONTEXT_ID || "").trim();
  if (envContextId) return envContextId;

  const envChatKey = String(process.env.SMA_CTX_CHAT_KEY || "").trim();
  if (envChatKey) return envChatKey;

  const channel = String(process.env.SMA_CTX_CHANNEL || "")
    .trim()
    .toLowerCase();
  const chatId = String(
    process.env.SMA_CTX_TARGET_ID || process.env.SMA_CTX_CHAT_ID || "",
  ).trim();
  if (!channel || !chatId) return undefined;

  if (channel === "telegram") {
    const threadRaw = String(
      process.env.SMA_CTX_THREAD_ID || process.env.SMA_CTX_MESSAGE_THREAD_ID || "",
    ).trim();
    const threadId = Number.parseInt(threadRaw, 10);
    if (Number.isFinite(threadId) && threadId > 0) {
      return `telegram-chat-${chatId}-topic-${threadId}`;
    }
    return `telegram-chat-${chatId}`;
  }

  if (channel === "feishu") {
    return `feishu-chat-${chatId}`;
  }

  if (channel === "qq") {
    const chatType = String(
      process.env.SMA_CTX_TARGET_TYPE || process.env.SMA_CTX_CHAT_TYPE || "",
    ).trim();
    if (!chatType) return undefined;
    return `qq-${chatType}-${chatId}`;
  }

  return undefined;
}
