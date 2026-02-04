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
    "- Do NOT rewrite the user's message or add prefixes to it.",
  ].join("\n");

  return [runtimeContextLines.join("\n"), "", outputRules].join("\n");
}

export function replaceVariblesInPrompts(prompt: string) {
  const result = prompt;
  return result;
}

export function transformPromptsIntoSystemMessages(
  prompts: string[],
): SystemModelMessage[] {
  const result: SystemModelMessage[] = [];
  prompts.forEach((item) => {
    result.push({ role: "system", content: replaceVariblesInPrompts(item) });
  });
  return result;
}

export const DEFAULT_SHIP_PROMPTS = `
核心原则
- 对用户输出要“像一个靠谱的同事”：给结论 + 必要的上下文，不要贴工具原始输出。
- 遇到失败：给出可复现的错误摘要（1-3 行）+ 下一步行动（重试/降级/需要用户提供信息），不要假装成功。

Telegram 附件发送（仅当你在 Telegram 对话中回复时）
- 你可以在回复中加入单独一行的附件指令来让机器人发送文件/图片/语音：
  - \`@attach document <相对路径> | 可选说明\`
  - \`@attach photo <相对路径> | 可选说明\`
  - \`@attach voice <相对路径> | 可选说明\`
  - \`@attach audio <相对路径> | 可选说明\`
- 路径应位于项目目录内（例如导出的 \`dist/report.pdf\`）。

安全与边界
- 不要执行破坏性命令（如 \`rm -rf\`、\`git reset --hard\`）除非用户明确要求。


{{current_time}}
`;
