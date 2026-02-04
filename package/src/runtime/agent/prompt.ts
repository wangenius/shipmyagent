import { SystemModelMessage } from "ai";

import fs from "node:fs";
import { fileURLToPath } from "node:url";
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

function readShipPromptsText(): string {
  // When compiled: bin/runtime/prompts/ship-prompts.js
  // We want to load src/runtime/prompts.txt (shipped in repo/package) for the default prompt text.
  const candidates = [
    new URL("./prompts.txt", import.meta.url),
    new URL("../prompts.txt", import.meta.url),
  ];

  const tried: string[] = [];
  for (const url of candidates) {
    const filePath = fileURLToPath(url);
    tried.push(filePath);
    try {
      return fs.readFileSync(url, "utf8");
    } catch {
      // try next candidate
    }
  }

  throw new Error(
    `ShipMyAgent: failed to load prompts.txt. Tried: ${tried.join(", ")}`,
  );
}

export const DEFAULT_SHIP_PROMPTS = readShipPromptsText();
