import type { AgentInput } from "./types.js";

export function buildRuntimePrefixedPrompt(input: {
  projectRoot: string;
  sessionId: string;
  requestId: string;
  instructions: string;
  context?: AgentInput["context"];
  replyMode?: "auto" | "tool";
}): string {
  const { projectRoot, sessionId, requestId, instructions, context, replyMode } =
    input;

  let fullPrompt = instructions;
  if (context?.taskDescription) {
    fullPrompt = `${context.taskDescription}\n\n${instructions}`;
  }

  const runtimePrefix =
    `Runtime context:\n` +
    `- Project root: ${projectRoot}\n` +
    `- Session: ${sessionId}\n` +
    `- Request ID: ${requestId}\n` +
    (context?.source ? `- Source: ${context.source}\n` : "") +
    (context?.userId ? `- User/Chat ID: ${context.userId}\n` : "") +
    (context?.actorId ? `- Actor ID: ${context.actorId}\n` : "") +
    (context?.actorUsername ? `- Actor username: ${context.actorUsername}\n` : "") +
    (context?.chatType ? `- Chat type: ${context.chatType}\n` : "") +
    `\nUser-facing output rules:\n` +
    `- Reply in natural language.\n` +
    `- Do NOT paste raw tool outputs or JSON logs; summarize them.\n` +
    (context?.source === "telegram" ||
    context?.source === "feishu" ||
    context?.source === "qq"
      ? `- When you need to use tools in multiple steps, include short progress updates as plain text before/around tool usage (no tool names/commands).\n` +
        (replyMode === "tool"
          ? `- IMPORTANT: deliver replies via the \`send_message\` tool (alias: \`chat_send\`). Do not rely on plain text output only.\n`
          : "") +
        ((context?.chatType || "").toLowerCase().includes("group")
          ? `- This is a group chat. Prefer addressing the current actor (use @<Actor username> if available) so readers know who you're responding to.\n` +
            `- In a group chat, start your reply with 1 short line that says who you are replying to (the current actor) and that you are the project assistant.\n`
          : "")
      : "");

  return `${runtimePrefix}\n${fullPrompt}`;
}

