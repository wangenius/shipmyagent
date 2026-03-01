/**
 * Shell 工具类型定义。
 *
 * 关键点（中文）
 * - 统一沉淀 `exec_command/write_stdin/close_shell` 相关类型。
 * - 保证工具实现文件聚焦流程逻辑，避免类型噪音。
 */

import type { ChildProcessWithoutNullStreams } from "child_process";

export type OutputLimits = {
  maxChars: number;
  maxLines: number;
};

export type ShellContext = {
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

export type ShellOutputPage = {
  output: string;
  hasMoreOutput: boolean;
  originalChars: number;
  originalLines: number;
  droppedChars: number;
};

export type CreateShellContextInput = {
  command: string;
  cwd: string;
  shellPath?: string;
  login?: boolean;
};

export type CloseShellContextResult = {
  contextId: number;
  wasRunning: boolean;
  pendingOutputChars: number;
  droppedChars: number;
  exitCode: number | null;
};

export type ShellCommandInput = {
  cmd: string;
  workdir?: string;
  shell?: string;
  login?: boolean;
  yield_time_ms?: number;
  max_output_tokens?: number;
};

export type ShellWriteInput = {
  context_id: number;
  chars?: string;
  yield_time_ms?: number;
  max_output_tokens?: number;
};

export type ShellCloseInput = {
  context_id: number;
  force?: boolean;
};
