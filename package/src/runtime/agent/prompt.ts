/**
 * Build the default (runtime) system prompt for an agent run.
 *
 * The final system message should be:
 * - `Agent.md` content (project instructions)
 * - plus this default runtime prompt (routing/context/output rules)
 */
export function buildDefaultSystemPrompt(input: {
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
