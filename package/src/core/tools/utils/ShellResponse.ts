/**
 * Shell 响应格式化辅助。
 *
 * 关键点（中文）
 * - 统一 `exec_command/write_stdin` 的响应结构。
 * - 在输出读空且进程退出时自动回收会话。
 */

import type { JsonObject } from "../../../types/Json.js";
import type { ShellContext, ShellOutputPage } from "../../types/Shell.js";
import {
  MAX_CONTEXT_PENDING_CHARS,
  approxTokenCountFromChars,
  generateChunkId,
} from "./ShellHelpers.js";
import { finalizeContextIfDrainComplete } from "./ShellContextManager.js";

export function formatContextResponse(input: {
  context: ShellContext;
  page: ShellOutputPage;
  startedAt: number;
}): JsonObject {
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
