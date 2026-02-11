/**
 * chatKey 解析辅助。
 *
 * 关键点（中文）
 * - 这是 infra 公共语义，不属于单个 chat 模块
 * - 用于避免 skills/task module 反向依赖 chat/service
 */

export function resolveChatKey(input?: { chatKey?: string }): string | undefined {
  const explicit = String(input?.chatKey || "").trim();
  if (explicit) return explicit;

  const envSessionId = String(process.env.SMA_CTX_SESSION_ID || "").trim();
  if (envSessionId) return envSessionId;

  const envChatKey = String(process.env.SMA_CTX_CHAT_KEY || "").trim();
  if (envChatKey) return envChatKey;

  return undefined;
}

