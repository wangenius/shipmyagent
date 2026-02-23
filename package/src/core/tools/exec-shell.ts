/**
 * Shell context tools（Codex 风格）。
 *
 * 设计目标（中文）
 * - 只提供会话式命令工具：`exec_command` + `write_stdin`
 * - 支持“启动命令 -> 分段读取输出 -> 继续输入”闭环
 * - 输出按 budget 分页，避免单次 tool_result 过大触发 provider 参数异常
 */

import path from "path";
import { randomBytes } from "crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { z } from "zod";
import { tool } from "ai";
import { getShipRuntimeContext } from "../../server/ShipRuntimeContext.js";
import { contextRequestContext } from "../context/request-context.js";
import { llmRequestContext } from "../../telemetry/index.js";

const DEFAULT_MAX_OUTPUT_CHARS = 12_000;
const DEFAULT_MAX_OUTPUT_LINES = 200;
const APPROX_CHARS_PER_TOKEN = 4;

const DEFAULT_EXEC_COMMAND_YIELD_MS = 10_000;
const DEFAULT_WRITE_STDIN_YIELD_MS = 250;
const MIN_EMPTY_WRITE_STDIN_YIELD_MS = 5_000;
const MIN_YIELD_TIME_MS = 50;
const MAX_YIELD_TIME_MS = 30_000;

/**
 * 会话缓存上限。
 *
 * 关键点（中文）
 * - 缓存的是“尚未被读取”的输出。
 * - 超出上限时丢弃最旧部分，保证进程不会无限吃内存。
 */
const MAX_CONTEXT_PENDING_CHARS = 1_000_000;
const MAX_ACTIVE_EXEC_CONTEXTS = 64;

let nextContextId = 1000;

type OutputLimits = {
  maxChars: number;
  maxLines: number;
};

type ExecContext = {
  id: number;
  command: string;
  cwd: string;
  child: ChildProcessWithoutNullStreams;
  pendingOutput: string;
  droppedChars: number;
  exited: boolean;
  exitCode: number | null;
  waiters: Set<() => void>;
  cleanupTimer: NodeJS.Timeout | null;
  createdAt: number;
  lastActiveAt: number;
};

const execContexts = new Map<number, ExecContext>();

/**
 * 归一化 yieldTime。
 */
function clampYieldTimeMs(value: number | undefined, fallback: number): number {
  const n =
    typeof value === "number" && Number.isFinite(value)
      ? Math.floor(value)
      : fallback;
  return Math.min(MAX_YIELD_TIME_MS, Math.max(MIN_YIELD_TIME_MS, n));
}

function generateChunkId(): string {
  return randomBytes(3).toString("hex");
}

function approxTokenCountFromChars(chars: number): number {
  if (chars <= 0) return 0;
  return Math.ceil(chars / APPROX_CHARS_PER_TOKEN);
}

function normalizeOutputChunk(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

/**
 * 解析输出预算。
 *
 * 配置来源（中文）
 * - `ship.json.permissions.exec_command.maxOutputChars/maxOutputLines`
 * - 工具入参 `max_output_tokens` 会进一步收紧 maxChars
 */
function resolveOutputLimits(maxOutputTokens?: number): OutputLimits {
  const cfg = getShipRuntimeContext().config.permissions?.exec_command;
  const maxCharsRaw =
    cfg && typeof cfg === "object" ? (cfg as any).maxOutputChars : undefined;
  const maxLinesRaw =
    cfg && typeof cfg === "object" ? (cfg as any).maxOutputLines : undefined;

  const maxChars =
    typeof maxCharsRaw === "number" &&
    Number.isFinite(maxCharsRaw) &&
    maxCharsRaw >= 500
      ? Math.floor(maxCharsRaw)
      : DEFAULT_MAX_OUTPUT_CHARS;

  const maxLines =
    typeof maxLinesRaw === "number" &&
    Number.isFinite(maxLinesRaw) &&
    maxLinesRaw >= 20
      ? Math.floor(maxLinesRaw)
      : DEFAULT_MAX_OUTPUT_LINES;

  const byTokens =
    typeof maxOutputTokens === "number" &&
    Number.isFinite(maxOutputTokens) &&
    maxOutputTokens > 0
      ? Math.max(200, Math.floor(maxOutputTokens * APPROX_CHARS_PER_TOKEN))
      : null;

  return {
    maxChars: byTokens == null ? maxChars : Math.min(maxChars, byTokens),
    maxLines,
  };
}

/**
 * 解析命令工作目录。
 *
 * - 空值回退 projectRoot；相对路径按 projectRoot 解析。
 */
function resolveExecWorkdir(projectRoot: string, workdir?: string): string {
  const trimmed = String(workdir ?? "").trim();
  if (!trimmed) return projectRoot;
  return path.isAbsolute(trimmed)
    ? trimmed
    : path.resolve(projectRoot, trimmed);
}

function setEnvString(
  env: NodeJS.ProcessEnv,
  key: string,
  value: unknown,
): void {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (!trimmed) return;
  env[key] = trimmed;
}

function setEnvNumber(
  env: NodeJS.ProcessEnv,
  key: string,
  value: unknown,
): void {
  if (typeof value !== "number" || !Number.isFinite(value)) return;
  env[key] = String(Math.trunc(value));
}

/**
 * 构建子进程环境变量。
 *
 * 关键点（中文）
 * - 把 context/request 上下文字段透传给命令执行环境。
 */
function buildExecContextEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const contextCtx = contextRequestContext.getStore();
  const llmCtx = llmRequestContext.getStore();

  setEnvString(env, "SMA_CTX_CONTEXT_ID", contextCtx?.contextId);
  setEnvString(env, "SMA_CTX_CHANNEL", contextCtx?.channel);
  setEnvString(env, "SMA_CTX_TARGET_ID", contextCtx?.targetId);
  setEnvString(env, "SMA_CTX_TARGET_TYPE", contextCtx?.targetType);
  setEnvString(env, "SMA_CTX_ACTOR_ID", contextCtx?.actorId);
  setEnvString(env, "SMA_CTX_MESSAGE_ID", contextCtx?.messageId);
  setEnvNumber(env, "SMA_CTX_THREAD_ID", contextCtx?.threadId);
  setEnvString(env, "SMA_CTX_REQUEST_ID", llmCtx?.requestId);

  // 关键点（中文）：把当前 server 地址透传给子进程，便于 `sma message/skill/task` 自动命中本地服务。
  setEnvString(env, "SMA_CTX_SERVER_HOST", process.env.SMA_SERVER_HOST);
  setEnvString(env, "SMA_CTX_SERVER_PORT", process.env.SMA_SERVER_PORT);

  return env;
}

function touchContext(context: ExecContext): void {
  context.lastActiveAt = Date.now();
}

function notifyContextWaiters(context: ExecContext): void {
  const waiters = Array.from(context.waiters);
  context.waiters.clear();
  for (const resolve of waiters) resolve();
}

/**
 * 追加进程输出到会话缓冲区。
 *
 * - 达到上限后截断最旧内容，并累计 `droppedChars`。
 */
function appendContextOutput(context: ExecContext, raw: string): void {
  const chunk = normalizeOutputChunk(raw);
  if (!chunk) return;

  context.pendingOutput += chunk;

  if (context.pendingOutput.length > MAX_CONTEXT_PENDING_CHARS) {
    const overflow = context.pendingOutput.length - MAX_CONTEXT_PENDING_CHARS;
    context.pendingOutput = context.pendingOutput.slice(overflow);
    context.droppedChars += overflow;
  }

  touchContext(context);
  notifyContextWaiters(context);
}

/**
 * 安排会话延迟清理。
 */
function scheduleContextCleanup(context: ExecContext): void {
  if (context.cleanupTimer) clearTimeout(context.cleanupTimer);
  context.cleanupTimer = setTimeout(
    () => {
      const current = execContexts.get(context.id);
      if (!current) return;
      if (current.exited) execContexts.delete(context.id);
    },
    10 * 60 * 1000,
  );
  if (typeof context.cleanupTimer.unref === "function")
    context.cleanupTimer.unref();
}

/**
 * 控制活跃会话上限。
 *
 * 策略（中文）
 * - 超上限时优先回收最旧且已退出会话。
 */
function ensureContextCapacity(): void {
  if (execContexts.size < MAX_ACTIVE_EXEC_CONTEXTS) return;

  const removable = Array.from(execContexts.values())
    .filter((s) => s.exited && s.pendingOutput.length === 0)
    .sort((a, b) => a.lastActiveAt - b.lastActiveAt);

  for (const context of removable) {
    if (execContexts.size < MAX_ACTIVE_EXEC_CONTEXTS) break;
    if (context.cleanupTimer) clearTimeout(context.cleanupTimer);
    execContexts.delete(context.id);
  }

  if (execContexts.size >= MAX_ACTIVE_EXEC_CONTEXTS) {
    throw new Error(
      `Too many exec contexts (${execContexts.size}). Please drain finished contexts first.`,
    );
  }
}

/**
 * 创建一个命令执行会话。
 *
 * 流程（中文）
 * 1) 生成 contextId
 * 2) spawn shell 子进程
 * 3) 绑定 stdout/stderr/error/close 事件
 */
function createExecContext(input: {
  command: string;
  cwd: string;
  shellPath?: string;
  login?: boolean;
}): ExecContext {
  ensureContextCapacity();

  const contextId = nextContextId;
  nextContextId += 1;

  const shellPath =
    String(input.shellPath ?? process.env.SHELL ?? "/bin/zsh").trim() ||
    "/bin/zsh";
  const loginFlag = input.login === false ? "-c" : "-lc";

  const child = spawn(shellPath, [loginFlag, input.command], {
    cwd: input.cwd,
    stdio: "pipe",
    env: buildExecContextEnv(),
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  const context: ExecContext = {
    id: contextId,
    command: input.command,
    cwd: input.cwd,
    child,
    pendingOutput: "",
    droppedChars: 0,
    exited: false,
    exitCode: null,
    waiters: new Set(),
    cleanupTimer: null,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };

  execContexts.set(contextId, context);

  child.stdout.on("data", (chunk: string | Buffer) => {
    appendContextOutput(context, String(chunk ?? ""));
  });

  child.stderr.on("data", (chunk: string | Buffer) => {
    appendContextOutput(context, String(chunk ?? ""));
  });

  child.on("error", (err: unknown) => {
    appendContextOutput(context, `\n[process error] ${String(err)}\n`);
    context.exited = true;
    context.exitCode = -1;
    touchContext(context);
    notifyContextWaiters(context);
    scheduleContextCleanup(context);
  });

  child.on("close", (code: number | null) => {
    context.exited = true;
    context.exitCode = typeof code === "number" ? code : -1;
    touchContext(context);
    notifyContextWaiters(context);
    scheduleContextCleanup(context);
  });

  return context;
}

/**
 * 按字符/行预算切分页输出。
 */
function splitOutputPage(
  text: string,
  limits: OutputLimits,
): {
  head: string;
  tail: string;
} {
  if (!text) return { head: "", tail: "" };

  const byChar = text.slice(0, Math.min(text.length, limits.maxChars));
  let head = byChar;

  if (limits.maxLines > 0) {
    const lines = byChar.split("\n");
    if (lines.length > limits.maxLines) {
      head = lines.slice(0, limits.maxLines).join("\n");
    }
  }

  return {
    head,
    tail: text.slice(head.length),
  };
}

/**
 * 消费一页输出并更新会话缓冲区。
 */
function consumeContextOutputPage(
  context: ExecContext,
  limits: OutputLimits,
): {
  output: string;
  hasMoreOutput: boolean;
  originalChars: number;
  originalLines: number;
  droppedChars: number;
} {
  const text = context.pendingOutput;
  const originalChars = text.length;
  const originalLines = text ? text.split("\n").length : 0;
  const droppedChars = context.droppedChars;
  context.droppedChars = 0;

  if (!text) {
    return {
      output: "",
      hasMoreOutput: false,
      originalChars,
      originalLines,
      droppedChars,
    };
  }

  const { head, tail } = splitOutputPage(text, limits);
  context.pendingOutput = tail;
  touchContext(context);

  return {
    output: head,
    hasMoreOutput: tail.length > 0,
    originalChars,
    originalLines,
    droppedChars,
  };
}

/**
 * 等待会话信号（输出到达或进程退出）。
 */
async function waitForContextSignal(
  context: ExecContext,
  timeoutMs: number,
): Promise<boolean> {
  if (timeoutMs <= 0) return false;

  return await new Promise<boolean>((resolve) => {
    let resolved = false;

    const onSignal = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      context.waiters.delete(onSignal);
      resolve(true);
    };

    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      context.waiters.delete(onSignal);
      resolve(false);
    }, timeoutMs);

    context.waiters.add(onSignal);
  });
}

/**
 * 在一个 yield 窗口内收集输出。
 *
 * 关键点（中文）
 * - 若已经有输出，会再短等 30ms 抓取“紧随其后的块”，减少碎片化。
 */
async function collectOutputUntilDeadline(
  context: ExecContext,
  yieldTimeMs: number,
): Promise<void> {
  const deadline = Date.now() + yieldTimeMs;

  while (Date.now() < deadline) {
    if (context.pendingOutput.length > 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return;
      const gotMore = await waitForContextSignal(
        context,
        Math.min(30, remaining),
      );
      if (!gotMore) return;
      continue;
    }

    if (context.exited) return;

    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    const signaled = await waitForContextSignal(context, remaining);
    if (!signaled) return;
  }
}

/**
 * 获取会话，不存在则抛错。
 */
function getContextOrThrow(contextId: number): ExecContext {
  const context = execContexts.get(contextId);
  if (!context) {
    throw new Error(`Unknown context_id: ${contextId}`);
  }
  return context;
}

/**
 * 向会话 stdin 写入输入。
 */
async function writeContextStdin(
  context: ExecContext,
  chars: string,
): Promise<void> {
  if (!chars) return;
  if (context.exited) throw new Error(`Context ${context.id} already exited`);
  if (!context.child.stdin.writable)
    throw new Error(`Context ${context.id} stdin is closed`);

  await new Promise<void>((resolve, reject) => {
    context.child.stdin.write(chars, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });

  touchContext(context);
}

/**
 * 显式关闭会话（可选强制）。
 *
 * 关键点（中文）
 * - 适合长驻命令在业务完成后主动释放资源
 * - 关闭后该 context_id 不可再用
 */
function closeExecContext(
  context: ExecContext,
  force: boolean,
): {
  contextId: number;
  wasRunning: boolean;
  pendingOutputChars: number;
  droppedChars: number;
  exitCode: number | null;
} {
  const wasRunning = !context.exited;
  const pendingOutputChars = context.pendingOutput.length;
  const droppedChars = context.droppedChars;

  if (context.cleanupTimer) {
    clearTimeout(context.cleanupTimer);
    context.cleanupTimer = null;
  }

  if (wasRunning) {
    try {
      context.child.kill(force ? "SIGKILL" : "SIGTERM");
    } catch {
      // ignore
    }
    context.exited = true;
    if (context.exitCode == null) {
      context.exitCode = force ? -9 : -15;
    }
  }

  context.pendingOutput = "";
  context.droppedChars = 0;
  touchContext(context);
  notifyContextWaiters(context);
  execContexts.delete(context.id);

  return {
    contextId: context.id,
    wasRunning,
    pendingOutputChars,
    droppedChars,
    exitCode: context.exitCode,
  };
}

/**
 * 在“已退出且输出已读空”时自动回收会话。
 */
function finalizeContextIfDrainComplete(
  context: ExecContext,
  hasMoreOutput: boolean,
): number | null {
  const keepAlive =
    !context.exited || hasMoreOutput || context.pendingOutput.length > 0;
  if (keepAlive) return context.id;

  if (context.cleanupTimer) {
    clearTimeout(context.cleanupTimer);
    context.cleanupTimer = null;
  }

  execContexts.delete(context.id);
  return null;
}

/**
 * 统一格式化 exec/write 的响应结构。
 */
function formatContextResponse(input: {
  context: ExecContext;
  page: {
    output: string;
    hasMoreOutput: boolean;
    originalChars: number;
    originalLines: number;
    droppedChars: number;
  };
  startedAt: number;
}): Record<string, unknown> {
  const { context, page, startedAt } = input;
  const contextId = finalizeContextIfDrainComplete(context, page.hasMoreOutput);

  const notes: string[] = [];
  if (page.hasMoreOutput) {
    notes.push(
      "More output is available; call write_stdin with empty chars to read next chunk.",
    );
  }
  if (page.droppedChars > 0) {
    notes.push(
      `Dropped ${page.droppedChars} old chars due to context buffer cap (${MAX_CONTEXT_PENDING_CHARS}).`,
    );
  }

  return {
    success: true,
    chunk_id: generateChunkId(),
    wall_time_seconds: Math.max(0, (Date.now() - startedAt) / 1000),
    output: page.output,
    context_id: contextId,
    exit_code: context.exited ? context.exitCode : null,
    original_token_count: approxTokenCountFromChars(page.originalChars),
    original_chars: page.originalChars,
    original_lines: page.originalLines,
    has_more_output: page.hasMoreOutput,
    ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
  };
}

/**
 * `exec_command`：启动命令会话。
 */
export const exec_command = tool({
  description:
    "Start a shell command context. Returns context_id for follow-up polling/input via write_stdin.",
  inputSchema: z.object({
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
      .default(DEFAULT_EXEC_COMMAND_YIELD_MS)
      .describe("How long to wait for output before yielding."),
    max_output_tokens: z
      .number()
      .optional()
      .describe("Maximum output tokens per response chunk."),
  }),
  execute: async ({
    cmd,
    workdir,
    shell,
    login = true,
    yield_time_ms = DEFAULT_EXEC_COMMAND_YIELD_MS,
    max_output_tokens,
  }: {
    cmd: string;
    workdir?: string;
    shell?: string;
    login?: boolean;
    yield_time_ms?: number;
    max_output_tokens?: number;
  }) => {
    const startedAt = Date.now();

    try {
      const runtime = getShipRuntimeContext();
      const cwd = resolveExecWorkdir(runtime.rootPath, workdir);
      const context = createExecContext({
        command: cmd,
        cwd,
        shellPath: shell,
        login,
      });

      await collectOutputUntilDeadline(
        context,
        clampYieldTimeMs(yield_time_ms, DEFAULT_EXEC_COMMAND_YIELD_MS),
      );

      const page = consumeContextOutputPage(
        context,
        resolveOutputLimits(max_output_tokens),
      );
      return formatContextResponse({ context, page, startedAt });
    } catch (error) {
      return {
        success: false,
        error: `exec_command failed: ${String(error)}`,
      };
    }
  },
});

/**
 * `write_stdin`：向现有会话写入输入或轮询输出。
 */
export const write_stdin = tool({
  description:
    "Write chars to an existing exec context and return next output chunk. Use empty chars to poll.",
  inputSchema: z.object({
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
  }),
  execute: async ({
    context_id,
    chars = "",
    yield_time_ms = DEFAULT_WRITE_STDIN_YIELD_MS,
    max_output_tokens,
  }: {
    context_id: number;
    chars?: string;
    yield_time_ms?: number;
    max_output_tokens?: number;
  }) => {
    const startedAt = Date.now();

    try {
      const context = getContextOrThrow(context_id);
      const input = String(chars ?? "");

      if (input) {
        await writeContextStdin(context, input);
      }

      const effectiveYield = input
        ? clampYieldTimeMs(yield_time_ms, DEFAULT_WRITE_STDIN_YIELD_MS)
        : Math.max(
            MIN_EMPTY_WRITE_STDIN_YIELD_MS,
            clampYieldTimeMs(yield_time_ms, DEFAULT_WRITE_STDIN_YIELD_MS),
          );

      await collectOutputUntilDeadline(context, effectiveYield);

      const page = consumeContextOutputPage(
        context,
        resolveOutputLimits(max_output_tokens),
      );
      return formatContextResponse({ context, page, startedAt });
    } catch (error) {
      return {
        success: false,
        error: `write_stdin failed: ${String(error)}`,
      };
    }
  },
});

/**
 * `close_shell`：主动关闭并回收会话。
 */
export const close_shell = tool({
  description:
    "Close an existing exec context and release resources. Use force=true to send SIGKILL.",
  inputSchema: z.object({
    context_id: z.number().describe("Identifier returned by exec_command."),
    force: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Whether to force-kill context process (SIGKILL). Default false uses SIGTERM.",
      ),
  }),
  execute: async ({
    context_id,
    force = false,
  }: {
    context_id: number;
    force?: boolean;
  }) => {
    try {
      const context = getContextOrThrow(context_id);
      const result = closeExecContext(context, force);

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
      return {
        success: false,
        error: `close_shell failed: ${err}`,
      };
    }
  },
});

/**
 * Shell 工具导出集合。
 */
export const execShellTools = {
  exec_command,
  write_stdin,
  close_shell,
};
