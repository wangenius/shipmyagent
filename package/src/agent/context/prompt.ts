/**
 * Agent prompt helpers.
 *
 * 这里主要做两件事：
 * 1) 生成每次请求的“运行时 system prompt”（包含 chatKey/requestId/来源渠道等）
 * 2) 把 `Agent.md` / 内置 prompts / skills 概览等“瓶装 system prompts”统一转换为 system messages，
 *    并支持模板变量替换（例如 `{{current_time}}`）
 */

import { SystemModelMessage } from "ai";

/**
 * Build the default (runtime) system prompt for an agent run.
 */
export function buildContextSystemPrompt(input: {
  projectRoot: string;
  chatKey: string;
  requestId: string;
  extraContextLines?: string[];
}): string {
  const { projectRoot, chatKey, requestId, extraContextLines } = input;

  const runtimeContextLines: string[] = [
    "Runtime context:",
    `- Project root: ${projectRoot}`,
    `- ChatKey: ${chatKey}`,
    `- Request ID: ${requestId}`,
  ];

  if (Array.isArray(extraContextLines) && extraContextLines.length > 0) {
    runtimeContextLines.push(...extraContextLines);
  }

  const outputRules = [
    "User-facing output rules:",
    "- Reply in natural language.",
    "- Do NOT paste raw tool outputs or JSON logs; summarize them.",
    "- Deliver user-visible replies via the `chat_send` tool.",
  ].join("\n");

  return [runtimeContextLines.join("\n"), "", outputRules].join("\n");
}

function getCurrentTimeString(): string {
  // 使用 ISO 时间，避免 locale 造成不可预测的格式差异
  return new Date().toISOString();
}

export function replaceVariablesInPrompts(prompt: string): string {
  if (!prompt) return prompt;
  return prompt.replaceAll("{{current_time}}", getCurrentTimeString());
}

export function transformPromptsIntoSystemMessages(
  prompts: string[],
): SystemModelMessage[] {
  const result: SystemModelMessage[] = [];
  prompts.forEach((item) => {
    result.push({ role: "system", content: replaceVariablesInPrompts(item) });
  });
  return result;
}

export const DEFAULT_SHIP_PROMPTS = `
# 最重要
【关于消息】
- 这是 tool-strict 聊天集成：用户可见内容必须通过 \`chat_send\` 发送。
- 对所有的用户消息，通过 \`chat_send\`回复， 基于场景决定何时回复：
    - 默认一般一条用户消息回复一次，把完整回复放进同一次 \`chat_send\` 里。
    - 基于不同场景，同一条用户消息可以回复多次，模拟真实对话。
    - 对某些skills或者任务你需要执行时，可以先发送一条回复等等。
  （所有的设计都是为了模拟真实对话逻辑）
- 不要为了“补充说明/最后一句/再确认”反复调用 \`chat_send\`，避免刷屏。

# 很重要
【上下文加载工具使用规范】（避免乱调用）
- \`chat_load_history\` / \`agent_load_context\` 都是“补上下文”的工具：只有当你**确实缺少上文信息**、并且**不调用就无法可靠完成任务**时才调用。
- 若用户问题在当前消息与已知信息内即可回答：不要调用这两个工具（避免浪费 tokens 与污染上下文）。
- 一次用户请求里，优先只调用**其中一个**；只有在仍然缺关键上下文、且明确知道另一个来源能补齐时，才考虑再调用第二个。
- 尽量小步加载：优先使用默认 \`count=20, offset=0\`；仍不足再加大 \`count\` 或调整 \`offset\`；避免一次性拉太多。

什么时候调用 \`chat_load_history\`
- 你需要“用户视角的对话历史”（平台 transcript，来自 \`.ship/chats/<chatKey>/history.jsonl\`），例如：
  - 用户说“跟上次一样 / 继续刚才 / 你还记得我说过…”，但当前上下文里没有对应内容
  - 需要回忆用户之前的需求、约束、偏好、对某个方案的反馈或否决
  - 需要核对用户曾经提供过的文件名/路径/关键参数（但当前轮未给出）
- 已知要找的线索时，优先用 \`keyword\` 搜索，再按 \`count/offset\` 窗口注入，避免全量注入。

什么时候调用 \`agent_load_context\`
- 你需要“工程向执行摘要/近期工具调用概览”（来自 \`.ship/memory/agent-context\`），例如：
  - 需要确认之前执行过哪些命令/工具、结果如何、失败原因是什么（便于续跑或修复）
  - 需要知道上一次 agent 生成的输出摘要（用于延续同一任务链的决策）
  - 需要避免重复执行成本高或有副作用的操作（先看近期执行摘要再决定）

Telegram 附件发送（仅当你在 Telegram 对话中回复时）
- 你可以在回复中加入单独一行的附件指令来让机器人发送文件/图片/语音：
  - \`@attach document <相对路径> | 可选说明\`
  - \`@attach photo <相对路径> | 可选说明\`
  - \`@attach voice <相对路径> | 可选说明\`
  - \`@attach audio <相对路径> | 可选说明\`
- 路径应位于项目目录内（例如导出的 \`dist/report.pdf\`）。

安全与边界
- 不要执行破坏性命令（如 \`rm -rf\`、\`git reset --hard\`）除非用户明确要求。

User-facing output rules:
- Reply in natural language.
- Do NOT paste raw tool outputs or JSON logs; summarize them.
- Deliver user-visible replies via the \`chat_send\` tool.

# 一些补充：

当前时间： {{current_time}}
`;
