/**
 * Shell session tools（Codex 风格）。
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
import { getShipRuntimeContext } from "../../../server/ShipRuntimeContext.js";
import { chatRequestContext } from "../../runtime/request-context.js";
import { llmRequestContext } from "../../../telemetry/index.js";

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
const MAX_SESSION_PENDING_CHARS = 1_000_000;
const MAX_ACTIVE_EXEC_SESSIONS = 64;

let nextSessionId = 1000;

type OutputLimits = {
  maxChars: number;
  maxLines: number;
};

type ExecSession = {
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

const execSessions = new Map<number, ExecSession>();

function clampYieldTimeMs(value: number | undefined, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
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
  const maxCharsRaw = cfg && typeof cfg === "object" ? (cfg as any).maxOutputChars : undefined;
  const maxLinesRaw = cfg && typeof cfg === "object" ? (cfg as any).maxOutputLines : undefined;

  const maxChars =
    typeof maxCharsRaw === "number" && Number.isFinite(maxCharsRaw) && maxCharsRaw >= 500
      ? Math.floor(maxCharsRaw)
      : DEFAULT_MAX_OUTPUT_CHARS;

  const maxLines =
    typeof maxLinesRaw === "number" && Number.isFinite(maxLinesRaw) && maxLinesRaw >= 20
      ? Math.floor(maxLinesRaw)
      : DEFAULT_MAX_OUTPUT_LINES;

  const byTokens =
    typeof maxOutputTokens === "number" && Number.isFinite(maxOutputTokens) && maxOutputTokens > 0
      ? Math.max(200, Math.floor(maxOutputTokens * APPROX_CHARS_PER_TOKEN))
      : null;

  return {
    maxChars: byTokens == null ? maxChars : Math.min(maxChars, byTokens),
    maxLines,
  };
}

function resolveExecWorkdir(projectRoot: string, workdir?: string): string {
  const trimmed = String(workdir ?? "").trim();
  if (!trimmed) return projectRoot;
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(projectRoot, trimmed);
}

function setEnvString(env: NodeJS.ProcessEnv, key: string, value: unknown): void {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (!trimmed) return;
  env[key] = trimmed;
}

function setEnvNumber(env: NodeJS.ProcessEnv, key: string, value: unknown): void {
  if (typeof value !== "number" || !Number.isFinite(value)) return;
  env[key] = String(Math.trunc(value));
}

function buildExecContextEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const chatCtx = chatRequestContext.getStore();
  const llmCtx = llmRequestContext.getStore();

  setEnvString(env, "SMA_CTX_CHAT_KEY", chatCtx?.chatKey);
  setEnvString(env, "SMA_CTX_CHANNEL", chatCtx?.channel);
  setEnvString(env, "SMA_CTX_CHAT_ID", chatCtx?.chatId);
  setEnvString(env, "SMA_CTX_CHAT_TYPE", chatCtx?.chatType);
  setEnvString(env, "SMA_CTX_USER_ID", chatCtx?.userId);
  setEnvString(env, "SMA_CTX_MESSAGE_ID", chatCtx?.messageId);
  setEnvNumber(env, "SMA_CTX_MESSAGE_THREAD_ID", chatCtx?.messageThreadId);
  setEnvString(env, "SMA_CTX_REQUEST_ID", llmCtx?.requestId);

  // 关键点（中文）：把当前 server 地址透传给子进程，便于 `sma chat/skill/task` 自动命中本地服务。
  setEnvString(env, "SMA_CTX_SERVER_HOST", process.env.SMA_SERVER_HOST);
  setEnvString(env, "SMA_CTX_SERVER_PORT", process.env.SMA_SERVER_PORT);

  return env;
}

function touchSession(session: ExecSession): void {
  session.lastActiveAt = Date.now();
}

function notifySessionWaiters(session: ExecSession): void {
  const waiters = Array.from(session.waiters);
  session.waiters.clear();
  for (const resolve of waiters) resolve();
}

function appendSessionOutput(session: ExecSession, raw: string): void {
  const chunk = normalizeOutputChunk(raw);
  if (!chunk) return;

  session.pendingOutput += chunk;

  if (session.pendingOutput.length > MAX_SESSION_PENDING_CHARS) {
    const overflow = session.pendingOutput.length - MAX_SESSION_PENDING_CHARS;
    session.pendingOutput = session.pendingOutput.slice(overflow);
    session.droppedChars += overflow;
  }

  touchSession(session);
  notifySessionWaiters(session);
}

function scheduleSessionCleanup(session: ExecSession): void {
  if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
  session.cleanupTimer = setTimeout(() => {
    const current = execSessions.get(session.id);
    if (!current) return;
    if (current.exited) execSessions.delete(session.id);
  }, 10 * 60 * 1000);
  if (typeof session.cleanupTimer.unref === "function") session.cleanupTimer.unref();
}

function ensureSessionCapacity(): void {
  if (execSessions.size < MAX_ACTIVE_EXEC_SESSIONS) return;

  const removable = Array.from(execSessions.values())
    .filter((s) => s.exited && s.pendingOutput.length === 0)
    .sort((a, b) => a.lastActiveAt - b.lastActiveAt);

  for (const session of removable) {
    if (execSessions.size < MAX_ACTIVE_EXEC_SESSIONS) break;
    if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
    execSessions.delete(session.id);
  }

  if (execSessions.size >= MAX_ACTIVE_EXEC_SESSIONS) {
    throw new Error(
      `Too many exec sessions (${execSessions.size}). Please drain finished sessions first.`,
    );
  }
}

function createExecSession(input: {
  command: string;
  cwd: string;
  shellPath?: string;
  login?: boolean;
}): ExecSession {
  ensureSessionCapacity();

  const sessionId = nextSessionId;
  nextSessionId += 1;

  const shellPath = String(input.shellPath ?? process.env.SHELL ?? "/bin/zsh").trim() || "/bin/zsh";
  const loginFlag = input.login === false ? "-c" : "-lc";

  const child = spawn(shellPath, [loginFlag, input.command], {
    cwd: input.cwd,
    stdio: "pipe",
    env: buildExecContextEnv(),
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  const session: ExecSession = {
    id: sessionId,
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

  execSessions.set(sessionId, session);

  child.stdout.on("data", (chunk: string | Buffer) => {
    appendSessionOutput(session, String(chunk ?? ""));
  });

  child.stderr.on("data", (chunk: string | Buffer) => {
    appendSessionOutput(session, String(chunk ?? ""));
  });

  child.on("error", (err: unknown) => {
    appendSessionOutput(session, `\n[process error] ${String(err)}\n`);
    session.exited = true;
    session.exitCode = -1;
    touchSession(session);
    notifySessionWaiters(session);
    scheduleSessionCleanup(session);
  });

  child.on("close", (code: number | null) => {
    session.exited = true;
    session.exitCode = typeof code === "number" ? code : -1;
    touchSession(session);
    notifySessionWaiters(session);
    scheduleSessionCleanup(session);
  });

  return session;
}

function splitOutputPage(text: string, limits: OutputLimits): {
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

function consumeSessionOutputPage(session: ExecSession, limits: OutputLimits): {
  output: string;
  hasMoreOutput: boolean;
  originalChars: number;
  originalLines: number;
  droppedChars: number;
} {
  const text = session.pendingOutput;
  const originalChars = text.length;
  const originalLines = text ? text.split("\n").length : 0;
  const droppedChars = session.droppedChars;
  session.droppedChars = 0;

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
  session.pendingOutput = tail;
  touchSession(session);

  return {
    output: head,
    hasMoreOutput: tail.length > 0,
    originalChars,
    originalLines,
    droppedChars,
  };
}

async function waitForSessionSignal(session: ExecSession, timeoutMs: number): Promise<boolean> {
  if (timeoutMs <= 0) return false;

  return await new Promise<boolean>((resolve) => {
    let resolved = false;

    const onSignal = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      session.waiters.delete(onSignal);
      resolve(true);
    };

    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      session.waiters.delete(onSignal);
      resolve(false);
    }, timeoutMs);

    session.waiters.add(onSignal);
  });
}

/**
 * 在一个 yield 窗口内收集输出。
 *
 * 关键点（中文）
 * - 若已经有输出，会再短等 30ms 抓取“紧随其后的块”，减少碎片化。
 */
async function collectOutputUntilDeadline(session: ExecSession, yieldTimeMs: number): Promise<void> {
  const deadline = Date.now() + yieldTimeMs;

  while (Date.now() < deadline) {
    if (session.pendingOutput.length > 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return;
      const gotMore = await waitForSessionSignal(session, Math.min(30, remaining));
      if (!gotMore) return;
      continue;
    }

    if (session.exited) return;

    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    const signaled = await waitForSessionSignal(session, remaining);
    if (!signaled) return;
  }
}

function getSessionOrThrow(sessionId: number): ExecSession {
  const session = execSessions.get(sessionId);
  if (!session) {
    throw new Error(`Unknown session_id: ${sessionId}`);
  }
  return session;
}

async function writeSessionStdin(session: ExecSession, chars: string): Promise<void> {
  if (!chars) return;
  if (session.exited) throw new Error(`Session ${session.id} already exited`);
  if (!session.child.stdin.writable) throw new Error(`Session ${session.id} stdin is closed`);

  await new Promise<void>((resolve, reject) => {
    session.child.stdin.write(chars, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });

  touchSession(session);
}

/**
 * 显式关闭会话（可选强制）。
 *
 * 关键点（中文）
 * - 适合长驻命令在业务完成后主动释放资源
 * - 关闭后该 session_id 不可再用
 */
function closeExecSession(session: ExecSession, force: boolean): {
  sessionId: number;
  wasRunning: boolean;
  pendingOutputChars: number;
  droppedChars: number;
  exitCode: number | null;
} {
  const wasRunning = !session.exited;
  const pendingOutputChars = session.pendingOutput.length;
  const droppedChars = session.droppedChars;

  if (session.cleanupTimer) {
    clearTimeout(session.cleanupTimer);
    session.cleanupTimer = null;
  }

  if (wasRunning) {
    try {
      session.child.kill(force ? "SIGKILL" : "SIGTERM");
    } catch {
      // ignore
    }
    session.exited = true;
    if (session.exitCode == null) {
      session.exitCode = force ? -9 : -15;
    }
  }

  session.pendingOutput = "";
  session.droppedChars = 0;
  touchSession(session);
  notifySessionWaiters(session);
  execSessions.delete(session.id);

  return {
    sessionId: session.id,
    wasRunning,
    pendingOutputChars,
    droppedChars,
    exitCode: session.exitCode,
  };
}

function finalizeSessionIfDrainComplete(session: ExecSession, hasMoreOutput: boolean): number | null {
  const keepAlive = !session.exited || hasMoreOutput || session.pendingOutput.length > 0;
  if (keepAlive) return session.id;

  if (session.cleanupTimer) {
    clearTimeout(session.cleanupTimer);
    session.cleanupTimer = null;
  }

  execSessions.delete(session.id);
  return null;
}

function formatSessionResponse(input: {
  session: ExecSession;
  page: {
    output: string;
    hasMoreOutput: boolean;
    originalChars: number;
    originalLines: number;
    droppedChars: number;
  };
  startedAt: number;
}): Record<string, unknown> {
  const { session, page, startedAt } = input;
  const processId = finalizeSessionIfDrainComplete(session, page.hasMoreOutput);

  const notes: string[] = [];
  if (page.hasMoreOutput) {
    notes.push("More output is available; call write_stdin with empty chars to read next chunk.");
  }
  if (page.droppedChars > 0) {
    notes.push(
      `Dropped ${page.droppedChars} old chars due to session buffer cap (${MAX_SESSION_PENDING_CHARS}).`,
    );
  }

  return {
    success: true,
    chunk_id: generateChunkId(),
    wall_time_seconds: Math.max(0, (Date.now() - startedAt) / 1000),
    output: page.output,
    process_id: processId,
    exit_code: session.exited ? session.exitCode : null,
    original_token_count: approxTokenCountFromChars(page.originalChars),
    original_chars: page.originalChars,
    original_lines: page.originalLines,
    has_more_output: page.hasMoreOutput,
    ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
  };
}

export const exec_command = tool({
  description:
    "Start a shell command session. Returns process_id for follow-up polling/input via write_stdin.",
  inputSchema: z.object({
    cmd: z.string().describe("Shell command to execute."),
    workdir: z
      .string()
      .optional()
      .describe("Optional working directory. Relative path is resolved from project root."),
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
      const session = createExecSession({
        command: cmd,
        cwd,
        shellPath: shell,
        login,
      });

      await collectOutputUntilDeadline(
        session,
        clampYieldTimeMs(yield_time_ms, DEFAULT_EXEC_COMMAND_YIELD_MS),
      );

      const page = consumeSessionOutputPage(session, resolveOutputLimits(max_output_tokens));
      return formatSessionResponse({ session, page, startedAt });
    } catch (error) {
      return {
        success: false,
        error: `exec_command failed: ${String(error)}`,
      };
    }
  },
});

export const write_stdin = tool({
  description:
    "Write chars to an existing exec session and return next output chunk. Use empty chars to poll.",
  inputSchema: z.object({
    session_id: z.number().describe("Identifier returned by exec_command."),
    chars: z.string().optional().default("").describe("Bytes to write to stdin; empty means poll only."),
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
    session_id,
    chars = "",
    yield_time_ms = DEFAULT_WRITE_STDIN_YIELD_MS,
    max_output_tokens,
  }: {
    session_id: number;
    chars?: string;
    yield_time_ms?: number;
    max_output_tokens?: number;
  }) => {
    const startedAt = Date.now();

    try {
      const session = getSessionOrThrow(session_id);
      const input = String(chars ?? "");

      if (input) {
        await writeSessionStdin(session, input);
      }

      const effectiveYield = input
        ? clampYieldTimeMs(yield_time_ms, DEFAULT_WRITE_STDIN_YIELD_MS)
        : Math.max(
            MIN_EMPTY_WRITE_STDIN_YIELD_MS,
            clampYieldTimeMs(yield_time_ms, DEFAULT_WRITE_STDIN_YIELD_MS),
          );

      await collectOutputUntilDeadline(session, effectiveYield);

      const page = consumeSessionOutputPage(session, resolveOutputLimits(max_output_tokens));
      return formatSessionResponse({ session, page, startedAt });
    } catch (error) {
      return {
        success: false,
        error: `write_stdin failed: ${String(error)}`,
      };
    }
  },
});

export const close_session = tool({
  description:
    "Close an existing exec session and release resources. Use force=true to send SIGKILL.",
  inputSchema: z.object({
    session_id: z.number().describe("Identifier returned by exec_command."),
    force: z
      .boolean()
      .optional()
      .default(false)
      .describe("Whether to force-kill session process (SIGKILL). Default false uses SIGTERM."),
  }),
  execute: async ({
    session_id,
    force = false,
  }: {
    session_id: number;
    force?: boolean;
  }) => {
    try {
      const session = getSessionOrThrow(session_id);
      const result = closeExecSession(session, force);

      return {
        success: true,
        session_id: result.sessionId,
        closed: true,
        was_running: result.wasRunning,
        exit_code: result.exitCode,
        pending_output_chars: result.pendingOutputChars,
        dropped_chars: result.droppedChars,
        ...(result.pendingOutputChars > 0
          ? {
              note: `Dropped ${result.pendingOutputChars} pending output chars while closing session.`,
            }
          : {}),
      };
    } catch (error) {
      return {
        success: false,
        error: `close_session failed: ${String(error)}`,
      };
    }
  },
});

export const execShellTools = {
  exec_command,
  write_stdin,
  close_session,
};
