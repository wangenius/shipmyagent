/**
 * Shell 辅助函数集合。
 *
 * 关键点（中文）
 * - 仅包含可复用的辅助逻辑（预算、输出处理、环境变量、等待策略）。
 * - 不持有全局会话 map，避免与执行流程状态耦合。
 */

import path from "path";
import { randomBytes } from "crypto";
import { getShipRuntimeContext } from "../../main/runtime/ShipRuntimeContext.js";
import { contextRequestContext } from "../context/RequestContext.js";
import { llmRequestContext } from "../../utils/logger/Context.js";
import type {
  ShellContext,
  ShellOutputPage,
  OutputLimits,
} from "../types/Shell.js";

export const DEFAULT_MAX_OUTPUT_CHARS = 12_000;
export const DEFAULT_MAX_OUTPUT_LINES = 200;
export const APPROX_CHARS_PER_TOKEN = 4;

export const DEFAULT_SHELL_COMMAND_YIELD_MS = 10_000;
export const DEFAULT_WRITE_STDIN_YIELD_MS = 250;
export const MIN_EMPTY_WRITE_STDIN_YIELD_MS = 5_000;
export const MIN_YIELD_TIME_MS = 50;
export const MAX_YIELD_TIME_MS = 30_000;

/**
 * 会话缓存上限。
 *
 * 关键点（中文）
 * - 缓存的是“尚未被读取”的输出。
 * - 超出上限时丢弃最旧部分，保证进程不会无限吃内存。
 */
export const MAX_CONTEXT_PENDING_CHARS = 1_000_000;

export function clampYieldTimeMs(
  value: number | undefined,
  fallback: number,
): number {
  const n =
    typeof value === "number" && Number.isFinite(value)
      ? Math.floor(value)
      : fallback;
  return Math.min(MAX_YIELD_TIME_MS, Math.max(MIN_YIELD_TIME_MS, n));
}

export function generateChunkId(): string {
  return randomBytes(3).toString("hex");
}

export function approxTokenCountFromChars(chars: number): number {
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
 * 对 `sma chat send` 命令做前置安全校验。
 *
 * 关键点（中文）
 * - 历史上模型会把长文本直接拼进多行 shell 命令，导致后续行被 zsh 当作独立命令解析。
 * - 这会出现“前面已发送，后面才报错”的副作用（用户看到重复/异常消息）。
 * - 多行正文请通过 `--stdin`（here-doc/pipe）或 `--text-file` 传入，避免内容被 shell 当成命令语法。
 */
export function validateChatSendCommand(cmd: string): string | null {
  const source = String(cmd ?? "");
  if (!/\bsma\s+chat\s+send\b/.test(source)) return null;
  if (!/[\r\n]/.test(source)) return null;
  if (/\bsma\s+chat\s+send\b[\s\S]*\s--stdin(?:\s|$)/.test(source)) return null;
  if (/\bsma\s+chat\s+send\b[\s\S]*\s--text-file(?:\s|$)/.test(source))
    return null;
  return [
    "Unsafe `sma chat send` command: real newlines are not allowed.",
    "If your message is multi-line, use `sma chat send --stdin` (with heredoc/pipe) or `--text-file`.",
  ].join(" ");
}

/**
 * 解析输出预算。
 *
 * 配置来源（中文）
 * - `ship.json.permissions.exec_command.maxOutputChars/maxOutputLines`
 * - 工具入参 `max_output_tokens` 会进一步收紧 maxChars
 */
export function resolveOutputLimits(maxOutputTokens?: number): OutputLimits {
  const cfg = getShipRuntimeContext().config.permissions?.exec_command;
  const cfgObject = cfg && typeof cfg === "object" ? cfg : undefined;
  const maxCharsRaw = cfgObject?.maxOutputChars;
  const maxLinesRaw = cfgObject?.maxOutputLines;

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
export function resolveShellWorkdir(
  projectRoot: string,
  workdir?: string,
): string {
  const trimmed = String(workdir ?? "").trim();
  if (!trimmed) return projectRoot;
  return path.isAbsolute(trimmed)
    ? trimmed
    : path.resolve(projectRoot, trimmed);
}

function setEnvString(
  env: NodeJS.ProcessEnv,
  key: string,
  value: string | undefined,
): void {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (!trimmed) return;
  env[key] = trimmed;
}

function setEnvNumber(
  env: NodeJS.ProcessEnv,
  key: string,
  value: number | undefined,
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
export function buildShellContextEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const contextCtx = contextRequestContext.getStore();
  const llmCtx = llmRequestContext.getStore();

  setEnvString(env, "SMA_CTX_CONTEXT_ID", contextCtx?.contextId);
  setEnvString(env, "SMA_CTX_CHANNEL", contextCtx?.chat);
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

export function touchContext(context: ShellContext): void {
  context.lastActiveAt = Date.now();
}

export function notifyContextWaiters(context: ShellContext): void {
  const waiters = Array.from(context.waiters);
  context.waiters.clear();
  for (const resolve of waiters) resolve();
}

/**
 * 追加进程输出到会话缓冲区。
 *
 * - 达到上限后截断最旧内容，并累计 `droppedChars`。
 */
export function appendContextOutput(context: ShellContext, raw: string): void {
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
export function consumeContextOutputPage(
  context: ShellContext,
  limits: OutputLimits,
): ShellOutputPage {
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
  context: ShellContext,
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
export async function collectOutputUntilDeadline(
  context: ShellContext,
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
 * 向会话 stdin 写入输入。
 */
export async function writeContextStdin(
  context: ShellContext,
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
