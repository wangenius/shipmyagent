/**
 * Shell 会话管理器（内存态）。
 *
 * 关键点（中文）
 * - 负责会话状态生命周期：创建、查询、关闭、回收。
 * - 与 tool 定义解耦，避免 `Shell.ts` 混杂状态细节。
 */

import { spawn } from "child_process";
import type {
  CloseShellContextResult,
  CreateShellContextInput,
  ShellContext,
} from "../../types/Shell.js";
import {
  appendContextOutput,
  buildShellContextEnv,
  notifyContextWaiters,
  touchContext,
} from "./ShellHelpers.js";

const MAX_ACTIVE_SHELL_CONTEXTS = 64;
const CONTEXT_CLEANUP_DELAY_MS = 10 * 60 * 1000;

let nextContextId = 1000;
const shellContexts = new Map<number, ShellContext>();

/**
 * 安排会话延迟清理。
 */
function scheduleContextCleanup(context: ShellContext): void {
  if (context.cleanupTimer) clearTimeout(context.cleanupTimer);
  context.cleanupTimer = setTimeout(
    () => {
      const current = shellContexts.get(context.id);
      if (!current) return;
      if (current.exited) shellContexts.delete(context.id);
    },
    CONTEXT_CLEANUP_DELAY_MS,
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
  if (shellContexts.size < MAX_ACTIVE_SHELL_CONTEXTS) return;

  const removable = Array.from(shellContexts.values())
    .filter((s) => s.exited && s.pendingOutput.length === 0)
    .sort((a, b) => a.lastActiveAt - b.lastActiveAt);

  for (const context of removable) {
    if (shellContexts.size < MAX_ACTIVE_SHELL_CONTEXTS) break;
    if (context.cleanupTimer) clearTimeout(context.cleanupTimer);
    shellContexts.delete(context.id);
  }

  if (shellContexts.size >= MAX_ACTIVE_SHELL_CONTEXTS) {
    throw new Error(
      `Too many shell contexts (${shellContexts.size}). Please drain finished contexts first.`,
    );
  }
}

/**
 * 创建一个命令执行会话。
 */
export function createShellContext(input: CreateShellContextInput): ShellContext {
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
    env: buildShellContextEnv(),
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  const context: ShellContext = {
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

  shellContexts.set(contextId, context);

  child.stdout.on("data", (chunk: string | Buffer) => {
    appendContextOutput(context, String(chunk ?? ""));
  });

  child.stderr.on("data", (chunk: string | Buffer) => {
    appendContextOutput(context, String(chunk ?? ""));
  });

  child.on("error", (err: Error) => {
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
 * 获取会话，不存在则抛错。
 */
export function getContextOrThrow(contextId: number): ShellContext {
  const context = shellContexts.get(contextId);
  if (!context) {
    throw new Error(`Unknown context_id: ${contextId}`);
  }
  return context;
}

/**
 * 显式关闭会话（可选强制）。
 */
export function closeShellContext(
  context: ShellContext,
  force: boolean,
): CloseShellContextResult {
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
  shellContexts.delete(context.id);

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
export function finalizeContextIfDrainComplete(
  context: ShellContext,
  hasMoreOutput: boolean,
): number | null {
  const keepAlive =
    !context.exited || hasMoreOutput || context.pendingOutput.length > 0;
  if (keepAlive) return context.id;

  if (context.cleanupTimer) {
    clearTimeout(context.cleanupTimer);
    context.cleanupTimer = null;
  }

  shellContexts.delete(context.id);
  return null;
}
