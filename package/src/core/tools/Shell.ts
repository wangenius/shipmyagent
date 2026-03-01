/**
 * Shell context tools（Codex 风格）。
 *
 * 设计目标（中文）
 * - 只提供会话式命令工具：`exec_command` + `write_stdin` + `close_shell`
 * - 工具定义只负责参数协议与流程编排
 * - 会话状态管理与通用辅助逻辑统一下沉到 `utils/`
 */

import { z } from "zod";
import { tool } from "ai";
import { getShipRuntimeContext } from "../../process/server/ShipRuntimeContext.js";
import type {
  ShellCloseInput,
  ShellCommandInput,
  ShellWriteInput,
} from "../types/Shell.js";
import {
  DEFAULT_SHELL_COMMAND_YIELD_MS,
  DEFAULT_WRITE_STDIN_YIELD_MS,
  MIN_EMPTY_WRITE_STDIN_YIELD_MS,
  clampYieldTimeMs,
  collectOutputUntilDeadline,
  consumeContextOutputPage,
  resolveShellWorkdir,
  resolveOutputLimits,
  validateChatSendCommand,
  writeContextStdin,
} from "./utils/ShellHelpers.js";
import {
  closeShellContext,
  createShellContext,
  getContextOrThrow,
} from "./utils/ShellContextManager.js";
import { formatContextResponse } from "./utils/ShellResponse.js";

/**
 * 构建标准错误响应。
 */
function formatToolError(prefix: string, error: unknown): { success: false; error: string } {
  return {
    success: false,
    error: `${prefix}: ${String(error)}`,
  };
}

/**
 * 计算 `write_stdin` 的有效等待时间。
 *
 * 关键点（中文）
 * - 空输入轮询时使用更大的最小等待时间，减少高频空轮询。
 */
function resolveWriteStdinYieldMs(
  input: string,
  yieldTimeMs: number | undefined,
): number {
  const clamped = clampYieldTimeMs(
    yieldTimeMs,
    DEFAULT_WRITE_STDIN_YIELD_MS,
  );
  if (input) return clamped;
  return Math.max(MIN_EMPTY_WRITE_STDIN_YIELD_MS, clamped);
}

const shellCommandInputSchema = z.object({
  cmd: z.string().describe("Shell command to execute."),
  workdir: z
    .string()
    .optional()
    .describe(
      "Optional working directory. Relative path is resolved from project root.",
    ),
  shell: z
    .string()
    .optional()
    .describe("Optional shell executable path. Example: /bin/zsh"),
  login: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to run shell as login shell (-lc). false uses -c."),
  yield_time_ms: z
    .number()
    .optional()
    .default(DEFAULT_SHELL_COMMAND_YIELD_MS)
    .describe("How long to wait for output before yielding."),
  max_output_tokens: z
    .number()
    .optional()
    .describe("Maximum output tokens per response chunk."),
});

const writeStdinInputSchema = z.object({
  context_id: z.number().describe("Identifier returned by exec_command."),
  chars: z
    .string()
    .optional()
    .default("")
    .describe("Bytes to write to stdin; empty means poll only."),
  yield_time_ms: z
    .number()
    .optional()
    .default(DEFAULT_WRITE_STDIN_YIELD_MS)
    .describe("How long to wait for output before yielding."),
  max_output_tokens: z
    .number()
    .optional()
    .describe("Maximum output tokens per response chunk."),
});

const closeShellInputSchema = z.object({
  context_id: z.number().describe("Identifier returned by exec_command."),
  force: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Whether to force-kill context process (SIGKILL). Default false uses SIGTERM.",
    ),
});

/**
 * `exec_command`：启动命令会话。
 */
export const exec_command = tool({
  description:
    "Start a shell command context. Returns context_id for follow-up polling/input via write_stdin.",
  inputSchema: shellCommandInputSchema,
  execute: async ({
    cmd,
    workdir,
    shell,
    login = true,
    yield_time_ms = DEFAULT_SHELL_COMMAND_YIELD_MS,
    max_output_tokens,
  }: ShellCommandInput) => {
    const startedAt = Date.now();

    try {
      const validationError = validateChatSendCommand(cmd);
      if (validationError) {
        return {
          success: false,
          error: `exec_command rejected: ${validationError}`,
        };
      }

      const runtime = getShipRuntimeContext();
      const context = createShellContext({
        command: cmd,
        cwd: resolveShellWorkdir(runtime.rootPath, workdir),
        shellPath: shell,
        login,
      });

      await collectOutputUntilDeadline(
        context,
        clampYieldTimeMs(yield_time_ms, DEFAULT_SHELL_COMMAND_YIELD_MS),
      );

      const page = consumeContextOutputPage(
        context,
        resolveOutputLimits(max_output_tokens),
      );
      return formatContextResponse({ context, page, startedAt });
    } catch (error) {
      return formatToolError("exec_command failed", error);
    }
  },
});

/**
 * `write_stdin`：向现有会话写入输入或轮询输出。
 */
export const write_stdin = tool({
  description:
    "Write chars to an existing exec context and return next output chunk. Use empty chars to poll.",
  inputSchema: writeStdinInputSchema,
  execute: async ({
    context_id,
    chars = "",
    yield_time_ms = DEFAULT_WRITE_STDIN_YIELD_MS,
    max_output_tokens,
  }: ShellWriteInput) => {
    const startedAt = Date.now();

    try {
      const context = getContextOrThrow(context_id);
      const input = String(chars ?? "");

      if (input) {
        await writeContextStdin(context, input);
      }

      await collectOutputUntilDeadline(
        context,
        resolveWriteStdinYieldMs(input, yield_time_ms),
      );

      const page = consumeContextOutputPage(
        context,
        resolveOutputLimits(max_output_tokens),
      );
      return formatContextResponse({ context, page, startedAt });
    } catch (error) {
      return formatToolError("write_stdin failed", error);
    }
  },
});

/**
 * `close_shell`：主动关闭并回收会话。
 */
export const close_shell = tool({
  description:
    "Close an existing exec context and release resources. Use force=true to send SIGKILL.",
  inputSchema: closeShellInputSchema,
  execute: async ({
    context_id,
    force = false,
  }: ShellCloseInput) => {
    try {
      const context = getContextOrThrow(context_id);
      const result = closeShellContext(context, force);

      return {
        success: true,
        context_id: result.contextId,
        closed: true,
        was_running: result.wasRunning,
        exit_code: result.exitCode,
        pending_output_chars: result.pendingOutputChars,
        dropped_chars: result.droppedChars,
        ...(result.pendingOutputChars > 0
          ? {
              note: `Dropped ${result.pendingOutputChars} pending output chars while closing context.`,
            }
          : {}),
      };
    } catch (error) {
      const err = String(error ?? "");
      // 关键点（中文）：close 是“释放资源”语义，重复 close 应视为幂等成功而非失败。
      if (err.includes("Unknown context_id")) {
        return {
          success: true,
          context_id,
          closed: false,
          was_running: false,
          exit_code: null,
          pending_output_chars: 0,
          dropped_chars: 0,
          note: `Context ${context_id} already closed or expired.`,
        };
      }
      return formatToolError("close_shell failed", error);
    }
  },
});

/**
 * Shell 工具导出集合。
 */
export const shellTools = {
  exec_command,
  write_stdin,
  close_shell,
};
