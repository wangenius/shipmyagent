/**
 * Tool execution context (per agent run).
 *
 * Some tools need to interact with the **current in-flight** LLM message list
 * (e.g. inject additional historical messages on demand).
 *
 * The AI SDK executes tools inside the same async call chain as the agent run,
 * so an AsyncLocalStorage store is the safest way to pass these per-run
 * capabilities without introducing global mutable singletons.
 *
 * Design goals:
 * - Keep user messages pristine: tools can inject context messages without
 *   requiring the user prompt to be rewritten or prefixed.
 * - Avoid runtime↔tool circular dependencies: tools read this context, the
 *   AgentRuntime sets it.
 * - Provide a small, explicit surface area so we can evolve safely.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { ModelMessage } from "ai";

export type ToolExecutionContext = {
  /**
   * Index after the leading system messages within `messages`.
   *
   * Tools that inject additional **system** instructions should insert at this
   * index so system messages remain grouped at the top.
   */
  systemMessageInsertIndex: number;

  /**
   * Mutable reference to the message list currently being used by the agent.
   *
   * Tools may insert additional messages (e.g. loaded history) into this list.
   */
  messages: ModelMessage[];

  /**
   * Index of the current user message within `messages`.
   *
   * Tools that inject additional "earlier" context should insert **before**
   * this index so chronology remains sensible.
   */
  currentUserMessageIndex: number;

  /**
   * Dedupe set for injected messages within the current run.
   *
   * Fingerprints are intentionally opaque to callers; tools should use
   * a stable, human-safe representation (e.g. `${ts}:${role}:${text}`).
   */
  injectedFingerprints: Set<string>;

  /**
   * Hard ceiling to prevent runaway context growth in a single run.
   */
  maxInjectedMessages: number;

  /**
   * 工具调用计数器（本次 agent run 内）。
   *
   * 关键用途（中文）
   * - 为关键工具提供“预算/限流”能力，例如：允许多次 `chat_send`，但在异常情况下避免无限循环刷屏。
   * - 仅影响本次 run，不落盘；不用于跨请求统计。
   */
  toolCallCounts: Map<string, number>;

  /**
   * 预备注入：system messages（不直接改写 in-flight messages）。
   *
   * 关键点（中文）
   * - 由工具（例如 skills_load）或运行时逻辑写入
   * - 由 Agent 的 `prepareStep` 统一拼接到当次 step 的 system prompt 中
   * - 这样可以避免“工具在执行时直接 splice messages”带来的时序/竞态复杂度
   */
  preparedSystemMessages: Array<{ fingerprint: string; content: string }>;

  /**
   * 预备注入：assistant messages（不直接改写 in-flight messages）。
   *
   * 典型用法
   * - chat_load_history：把历史合并为一条 assistant message，但不立刻 splice 到 messages；
   *   而是交由 `prepareStep` 在每个 step 的输入中稳定插入（在当前 user message 之前）。
   */
  preparedAssistantMessages: Array<{ fingerprint: string; content: string }>;

  /**
   * 已加载的 skills（本次 run 内）。
   *
   * 由 `skills_load` 填充，`prepareStep` 负责把内容作为 system prompt 约束注入。
   */
  loadedSkills: Map<
    string,
    {
      id: string;
      name: string;
      skillMdPath: string;
      content: string;
      allowedTools: string[];
    }
  >;
};

/**
 * 在当前 agent run 中“预备”一条 system message（一次性去重）。
 *
 * 注意（中文）
 * - 不会改写 `ctx.messages`（不 splice）
 * - 由 `prepareStep` 在每个 step 调用时统一合并到 system prompt
 */
export function prepareSystemMessageOnce(params: {
  ctx: ToolExecutionContext;
  fingerprint: string;
  content: string;
}): { prepared: boolean; reason?: string } {
  const fp = String(params.fingerprint || "").trim();
  const content = String(params.content ?? "");
  if (!fp) return { prepared: false, reason: "missing_fingerprint" };
  if (!content.trim()) return { prepared: false, reason: "empty_content" };
  if (params.ctx.injectedFingerprints.has(fp))
    return { prepared: false, reason: "duplicate" };
  if (params.ctx.injectedFingerprints.size >= params.ctx.maxInjectedMessages)
    return { prepared: false, reason: "limit_reached" };

  params.ctx.preparedSystemMessages.push({ fingerprint: fp, content });
  params.ctx.injectedFingerprints.add(fp);
  return { prepared: true };
}

/**
 * 在当前 agent run 中“预备”一条 assistant message（一次性去重）。
 *
 * 注意（中文）
 * - 不会改写 `ctx.messages`（不 splice）
 * - 由 `prepareStep` 在每个 step 调用时统一插入到 user message 之前
 */
export function prepareAssistantMessageOnce(params: {
  ctx: ToolExecutionContext;
  fingerprint: string;
  content: string;
}): { prepared: boolean; reason?: string } {
  const fp = String(params.fingerprint || "").trim();
  const content = String(params.content ?? "");
  if (!fp) return { prepared: false, reason: "missing_fingerprint" };
  if (!content.trim()) return { prepared: false, reason: "empty_content" };
  if (params.ctx.injectedFingerprints.has(fp))
    return { prepared: false, reason: "duplicate" };
  if (params.ctx.injectedFingerprints.size >= params.ctx.maxInjectedMessages)
    return { prepared: false, reason: "limit_reached" };

  params.ctx.preparedAssistantMessages.push({ fingerprint: fp, content });
  params.ctx.injectedFingerprints.add(fp);
  return { prepared: true };
}

/**
 * 在当前 agent run 中注入一条 system message。
 *
 * 设计目标
 * - 让工具在“本次对话”内动态追加 system 级别约束（例如 skills 的全文规则）
 * - 保持 system messages 统一聚合在 message 列表开头（方便调试与可审计）
 *
 * 注意
 * - 该注入只影响当前 in-flight messages，不会自动持久化。
 * - 注入会计入 `maxInjectedMessages` 上限，避免单次 run 无边界膨胀。
 */
export function injectSystemMessageOnce(params: {
  ctx: ToolExecutionContext;
  fingerprint: string;
  content: string;
}): { injected: boolean; reason?: string } {
  const fp = String(params.fingerprint || "").trim();
  const content = String(params.content ?? "");
  if (!fp) return { injected: false, reason: "missing_fingerprint" };
  if (!content.trim()) return { injected: false, reason: "empty_content" };
  if (params.ctx.injectedFingerprints.has(fp))
    return { injected: false, reason: "duplicate" };
  if (params.ctx.injectedFingerprints.size >= params.ctx.maxInjectedMessages)
    return { injected: false, reason: "limit_reached" };

  const insertAt = Math.max(
    0,
    Math.min(params.ctx.systemMessageInsertIndex, params.ctx.messages.length),
  );
  params.ctx.messages.splice(insertAt, 0, { role: "system", content });
  params.ctx.injectedFingerprints.add(fp);

  params.ctx.systemMessageInsertIndex += 1;
  params.ctx.currentUserMessageIndex += 1;
  return { injected: true };
}

/**
 * 在当前 agent run 中注入一条 assistant message（作为“对话式上下文”）。
 *
 * 典型用法
 * - chat 历史（ChatStore）注入：把上文摘要/逐条对话拼成一条 assistant message
 *
 * 注意
 * - 注入发生在 current user message 之前（不改写用户原文）。
 * - 注入会计入 `maxInjectedMessages` 上限。
 */
export function injectAssistantMessageOnce(params: {
  ctx: ToolExecutionContext;
  fingerprint: string;
  content: string;
}): { injected: boolean; reason?: string } {
  const fp = String(params.fingerprint || "").trim();
  const content = String(params.content ?? "");
  if (!fp) return { injected: false, reason: "missing_fingerprint" };
  if (!content.trim()) return { injected: false, reason: "empty_content" };
  if (params.ctx.injectedFingerprints.has(fp))
    return { injected: false, reason: "duplicate" };
  if (params.ctx.injectedFingerprints.size >= params.ctx.maxInjectedMessages)
    return { injected: false, reason: "limit_reached" };

  const insertAt = Math.max(
    0,
    Math.min(params.ctx.currentUserMessageIndex, params.ctx.messages.length),
  );
  params.ctx.messages.splice(insertAt, 0, { role: "assistant", content });
  params.ctx.injectedFingerprints.add(fp);

  params.ctx.currentUserMessageIndex += 1;
  return { injected: true };
}

export const toolExecutionContext =
  new AsyncLocalStorage<ToolExecutionContext>();

export function withToolExecutionContext<T>(
  ctx: ToolExecutionContext,
  fn: () => Promise<T>,
): Promise<T> {
  return toolExecutionContext.run(ctx, fn);
}
