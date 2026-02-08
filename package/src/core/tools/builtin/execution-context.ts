/**
 * Tool execution context (per agent run).
 *
 * 关键点（中文）
 * - 当前版本的上下文历史以 UIMessage[] 为唯一事实源，不再允许“工具直接 splice model messages”
 * - 工具只通过这里维护少量 run-scope 状态：
 *   1) `toolCallCounts`：关键工具预算（如 chat_send）
 *   2) `loadedSkills`：skills_load 加载的 SKILL.md（由 Agent.prepareStep 注入到 system）
 */

import { AsyncLocalStorage } from "node:async_hooks";

export type ToolExecutionContext = {
  /**
   * 工具调用计数器（本次 agent run 内）。
   *
   * 关键用途（中文）
   * - 为关键工具提供“预算/限流”能力，例如：允许多次 `chat_send`，但在异常情况下避免无限循环刷屏。
   * - 仅影响本次 run，不落盘；不用于跨请求统计。
   */
  toolCallCounts: Map<string, number>;

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

export const toolExecutionContext =
  new AsyncLocalStorage<ToolExecutionContext>();

export function withToolExecutionContext<T>(
  ctx: ToolExecutionContext,
  fn: () => Promise<T>,
): Promise<T> {
  return toolExecutionContext.run(ctx, fn);
}

