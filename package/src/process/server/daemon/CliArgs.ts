/**
 * 负责把 commander 解析到的 options 转换成子进程 CLI 参数。
 *
 * 关键点
 * - daemon 实际启动的是 `shipmyagent run`（前台逻辑），这里拼装出对应的 argv。
 */

import type { StartOptions } from "../../commands/types/Start.js";

/**
 * 将 start/restart 选项转换为 `run` 子进程 argv。
 *
 * 关键点（中文）
 * - daemon 始终启动 `run`，因此参数统一映射到 `run` 的 CLI 形态。
 * - 只透传用户显式传入的字段，避免污染默认值决策。
 */
export const buildRunArgsFromOptions = (
  projectRoot: string,
  options: StartOptions,
): string[] => {
  const args: string[] = ["run", projectRoot];

  if (options.port !== undefined) args.push("--port", String(options.port));
  if (options.host) args.push("--host", String(options.host));
  if (options.interactiveWeb !== undefined)
    args.push("--interactive-web", String(options.interactiveWeb));
  if (options.interactivePort !== undefined)
    args.push("--interactive-port", String(options.interactivePort));

  return args;
};

