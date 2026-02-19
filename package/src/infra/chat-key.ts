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
 */
export function resolveChatKey(input?: { chatKey?: string }): string | undefined {
  const explicit = String(input?.chatKey || "").trim();
  if (explicit) return explicit;

  const envContextId = String(process.env.SMA_CTX_CONTEXT_ID || "").trim();
  if (envContextId) return envContextId;

  const envChatKey = String(process.env.SMA_CTX_CHAT_KEY || "").trim();
  if (envChatKey) return envChatKey;

  return undefined;
}

