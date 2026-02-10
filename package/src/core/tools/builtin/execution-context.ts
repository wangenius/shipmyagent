/**
 * Tool execution context (per agent run).
 *
 * 关键点（中文）
 * - 当前版本的上下文历史以 UIMessage[] 为唯一事实源，不再允许“工具直接 splice model messages”
 * - 工具只通过这里维护少量 run-scope 状态：`loadedSkills`
 */

import { AsyncLocalStorage } from "node:async_hooks";

export type ToolExecutionContext = {
  /**
   * 已加载的 skills（本次 run 内）。
   *
   * 关键点（中文）
   * - 运行开始时由 pinned skills 初始化
   * - 后续可由运行时流程继续扩展（如未来支持会话内动态加载）
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
