import type { ModelMessage } from "ai";
import { ChatStore, type ChatLogEntryV1 } from "./store.js";
import type { ChatTranscriptInjectionOptions } from "../types/context.js";

/**
 * Chat transcript 注入（对话式注入，单条 assistant message）。
 *
 * 背景
 * - ChatStore（`.ship/chat/<chatKey>/conversations/history.jsonl`）保存的是“用户视角 transcript”（append-only，便于审计）。
 * - Agent 在每次执行时只需要“足够的上文”，而不是把所有历史逐条重放。
 *
 * 关键约束（你在评审时可以优先看这三条）
 * 1) 始终注入为 **一条** assistant message（更省 tokens、更稳定，减少 role/meta 的结构性影响）
 * 2) 只选择 user/assistant（忽略 system/tool；system 由 Agent 自己管理）
 * 3) 允许截断（maxChars），但必须给出明确提示，避免模型误以为历史完整
 */

function pickUserAssistantEntries(entries: ChatLogEntryV1[]): ChatLogEntryV1[] {
  return entries.filter((e) => e.role === "user" || e.role === "assistant");
}

function formatEntryLine(e: ChatLogEntryV1): string {
  const role = e.role === "user" ? "user" : "assistant";

  // 关键点：尽量把“是谁说的”保留下来，但不引入复杂结构。
  // - username 主要在 user 消息里有意义（来自 adapter meta）
  const username =
    e.role === "user" ? String((e.meta as any)?.username || "").trim() : "";
  const who = username ? `@${username} ` : "";

  const text = String(e.text ?? "").replace(/\s+$/g, "");
  return `${role}: ${who}${text}`;
}

export async function loadChatTranscriptAsOneAssistantMessage(params: {
  projectRoot: string;
  chatKey: string;
  options: ChatTranscriptInjectionOptions;
}): Promise<{ message: ModelMessage | null; picked: number; truncated: boolean }> {
  const projectRoot = String(params.projectRoot || "").trim();
  const chatKey = String(params.chatKey || "").trim();
  if (!projectRoot || !chatKey) return { message: null, picked: 0, truncated: false };

  const count = Math.max(0, Math.min(200, Math.floor(params.options.count)));
  const offset = Math.max(0, Math.min(2000, Math.floor(params.options.offset ?? 0)));
  const maxChars = Math.max(500, Math.min(50_000, Math.floor(params.options.maxChars ?? 12000)));

  if (count <= 0) return { message: null, picked: 0, truncated: false };

  const chat = new ChatStore({ projectRoot, chatKey });
  let entries: ChatLogEntryV1[] = [];
  try {
    entries = await chat.loadRecentEntries(Math.min(5000, count + offset));
  } catch {
    return { message: null, picked: 0, truncated: false };
  }

  const ua = pickUserAssistantEntries(entries);
  const endExclusive = Math.max(0, ua.length - offset);
  const startInclusive = Math.max(0, endExclusive - count);
  const picked = ua.slice(startInclusive, endExclusive);
  if (picked.length === 0) return { message: null, picked: 0, truncated: false };

  const header = [
    "以下是该 chat 的历史对话（来自 ChatStore transcript，供参考）：",
    `- chatKey: ${chatKey}`,
    `- picked: ${picked.length}`,
    `- offset: ${offset}`,
    "",
  ].join("\n");

  let out = header;
  let truncated = false;

  for (const e of picked) {
    const line = formatEntryLine(e);
    if (!line.trim()) continue;

    const next = out + line + "\n";
    if (next.length > maxChars) {
      truncated = true;
      break;
    }
    out = next;
  }

  if (truncated) {
    out = out.trimEnd() + "\n…（注意：历史过长，已截断。请优先关注最近/关键信息。）\n";
  }

  return {
    message: { role: "assistant", content: out.trimEnd() },
    picked: picked.length,
    truncated,
  };
}
