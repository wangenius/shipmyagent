/**
 * contextId 解析辅助。
 *
 * 关键点（中文）
 * - task/skills 只依赖 contextId，不触碰通道寻址语义。
 * - 通道寻址映射由对应 service 内部负责。
 */

/**
 * 解析 contextId。
 *
 * 优先级（中文）
 * 1) 显式参数 `input.contextId`
 * 2) `SMA_CTX_CONTEXT_ID`
 */
export function resolveContextId(input?: { contextId?: string }): string | undefined {
  const explicit = String(input?.contextId || "").trim();
  if (explicit) return explicit;

  const envContextId = String(process.env.SMA_CTX_CONTEXT_ID || "").trim();
  if (envContextId) return envContextId;

  return undefined;
}
