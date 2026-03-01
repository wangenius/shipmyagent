/**
 * Agent prompt helpers.
 *
 * 这里主要做两件事：
 * 1) 生成每次请求的“运行时 system prompt”（包含 contextId/requestId/来源渠道等）
 * 2) 把 `Agent.md` / 内置 prompts / skills 概览等“瓶装 system prompts”统一转换为 system messages，
 *    并支持模板变量替换（例如 `{{current_time}}`）
 */

import fs from "node:fs";
import { SystemModelMessage } from "ai";

/**
 * 构建一次运行的运行时 system prompt。
 *
 * 关键点（中文）
 * - 注入 project/context/request 等请求级上下文。
 * - 与固定规则拼接，形成每次调用的最小安全边界。
 */
export function buildContextSystemPrompt(input: {
  projectRoot: string;
  contextId: string;
  requestId: string;
  extraContextLines?: string[];
}): string {
  const { projectRoot, contextId, requestId, extraContextLines } = input;

  const runtimeContextLines: string[] = [
    "Runtime context:",
    `- Project root: ${projectRoot}`,
    `- ContextId: ${contextId}`,
    `- Request ID: ${requestId}`,
  ];

  if (Array.isArray(extraContextLines) && extraContextLines.length > 0) {
    runtimeContextLines.push(...extraContextLines);
  }

  const outputRules = [
    "User-facing output rules:",
    "- Reply in natural language.",
    "- Do NOT paste raw tool outputs or JSON logs; summarize them.",
    "- Deliver user-visible replies by running `sma chat send --text \"...\"` via shell tools.",
    "- For every inbound chatKey (telegram/feishu/qq), you MUST call `sma chat send` at key milestones: start (if work is not instant), blocked/error (with required user input), and final outcome.",
    "- Before ending a run, verify the requesting chatKey has at least one successful `sma chat send`; if not, send one concise final reply immediately.",
    "- If a task involves multiple chatKeys, every targeted chatKey must receive milestone replies; use `--chat-key <contextId>` for non-current contexts.",
    "- IMPORTANT: For a single user message, prefer a single `sma chat send` command unless user asks for follow-ups.",
    "- IMPORTANT: Keep replies compact and avoid consecutive blank lines (`\\n\\n`) whenever possible.",
    "- IMPORTANT: For multi-line or shell-sensitive text, use `sma chat send --stdin` (heredoc/pipe) or `--text-file` instead of raw `--text`.",
    "- IMPORTANT: Escape shell-sensitive characters in `--text` (especially backticks). Never put raw ``` fences inside double-quoted shell strings.",
  ].join("\n");

  return [runtimeContextLines.join("\n"), "", outputRules].join("\n");
}

/**
 * 获取当前时间字符串（ISO8601）。
 */
function getCurrentTimeString(): string {
  // 使用 ISO 时间，避免 locale 造成不可预测的格式差异
  return new Date().toISOString();
}

/**
 * 替换 prompt 模板变量。
 *
 * 当前支持（中文）
 * - `{{current_time}}`
 */
export function replaceVariablesInPrompts(prompt: string): string {
  if (!prompt) return prompt;
  return prompt.replaceAll("{{current_time}}", getCurrentTimeString());
}

/**
 * 将纯文本 prompts 转为 `system` messages。
 *
 * - 自动过滤空串并执行变量替换。
 */
export function transformPromptsIntoSystemMessages(
  prompts: string[],
): SystemModelMessage[] {
  const result: SystemModelMessage[] = [];
  prompts.forEach((item) => {
    if (item.length > 0)
      result.push({ role: "system", content: replaceVariablesInPrompts(item) });
  });
  return result;
}

/**
 * 加载 Ship 默认系统提示模板（txt 文件）。
 *
 * 关键点（中文）
 * - 默认提示词落在独立 txt，便于直接维护长文本。
 * - 启动时若文件缺失，直接抛错，避免在生产中静默降级。
 */
const DEFAULT_SHIP_PROMPTS_FILE_URL = new URL(
  "./prompt.txt",
  import.meta.url,
);

function loadDefaultShipPrompts(): string {
  try {
    return fs.readFileSync(DEFAULT_SHIP_PROMPTS_FILE_URL, "utf-8").trim();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `failed to load default ship prompts from ${DEFAULT_SHIP_PROMPTS_FILE_URL.pathname}: ${reason}`,
    );
  }
}

/**
 * Ship 默认系统提示模板。
 */
export const DEFAULT_SHIP_PROMPTS = loadDefaultShipPrompts();
