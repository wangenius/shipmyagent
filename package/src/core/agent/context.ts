/**
 * In-memory per-chat session store for AgentRuntime.
 *
 * Responsibilities:
 * - Keep the current conversation history in-memory (keyed by `chatKey`)
 * - Provide deterministic log formatting for LLM response blocks
 *
 * Persistence is handled elsewhere (e.g. ChatStore); this class is runtime-memory only.
 */

import type { ModelMessage } from "ai";
import type { ConversationMessage } from "../../types/agent.js";

export class AgentContextStore {
  private messages: Map<string, ModelMessage[]> = new Map();

  getOrCreate(chatKey: string): ModelMessage[] {
    const existing = this.messages.get(chatKey);
    if (existing) return existing;
    const fresh: ModelMessage[] = [];
    this.messages.set(chatKey, fresh);
    return fresh;
  }

  set(chatKey: string, messages: unknown[]): void {
    this.messages.set(
      chatKey,
      this.coerceStoredMessagesToModelMessages(
        Array.isArray(messages) ? (messages as unknown[]) : [],
      ),
    );
  }

  replace(chatKey: string, messages: ModelMessage[]): void {
    this.messages.set(chatKey, messages);
  }

  delete(chatKey: string): void {
    this.messages.delete(chatKey);
  }

  clear(chatKey?: string): void {
    if (!chatKey) this.messages.clear();
    else this.messages.delete(chatKey);
  }

  getConversationHistory(chatKey?: string): ConversationMessage[] {
    const toLegacy = (m: ModelMessage): ConversationMessage => {
      const role = (m as any).role as ConversationMessage["role"];
      const content = (m as any).content;
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? JSON.stringify(content).slice(0, 2000)
            : String(content ?? "");
      return {
        role:
          role === "tool"
            ? "tool"
            : role === "assistant"
              ? "assistant"
              : "user",
        content: text,
        timestamp: Date.now(),
      };
    };

    if (!chatKey) {
      const all: ConversationMessage[] = [];
      for (const messages of this.messages.values()) {
        all.push(...messages.map(toLegacy));
      }
      return all;
    }

    return (this.messages.get(chatKey) || []).map(toLegacy);
  }

  formatModelMessagesForLog(
    messages: ModelMessage[],
    maxCharsTotal: number = 12000,
  ): string {
    const indent = (text: string): string =>
      text
        .split("\n")
        .map((l) => `  ${l}`)
        .join("\n");

    const lines: string[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i] as any;
      const role = String(m?.role ?? "unknown");
      const text = this.modelMessageContentToText(m?.content, 4000) || "(empty)";
      lines.push([`[#${i}] role=${role}`, indent(text)].join("\n"));
    }

    const joined = lines.join("\n");
    if (joined.length <= maxCharsTotal) return joined;
    return (
      joined.slice(0, maxCharsTotal) +
      `…(truncated, ${joined.length} chars total)`
    );
  }

  coerceStoredMessagesToModelMessages(messages: unknown[]): ModelMessage[] {
    if (
      Array.isArray(messages) &&
      messages.every(
        (m) =>
          m &&
          typeof m === "object" &&
          "role" in (m as any) &&
          "content" in (m as any),
      )
    ) {
      return messages as ModelMessage[];
    }

    const out: ModelMessage[] = [];
    for (const raw of messages) {
      if (!raw || typeof raw !== "object") continue;
      const role = (raw as any).role;
      const content = (raw as any).content;
      if (role === "user" || role === "assistant") {
        out.push({ role, content: String(content ?? "") });
      } else if (role === "tool") {
        out.push({
          role: "assistant",
          content: `Tool result:\n${String(content ?? "")}`,
        });
      }
    }
    return out;
  }

  private modelMessageContentToText(content: any, maxChars: number): string {
    const truncate = (text: string): string =>
      text.length <= maxChars
        ? text
        : text.slice(0, maxChars) + `…(truncated, ${text.length} chars total)`;

    if (typeof content === "string") return truncate(content);
    if (Array.isArray(content)) {
      const parts = content
        .map((p: any) => {
          if (!p || typeof p !== "object") return "";
          if (p.type === "text") return String(p.text ?? "");
          if (p.type === "input_text") return String(p.text ?? "");
          if (p.type === "tool-approval-request") {
            const toolName = (p.toolCall as any)?.toolName;
            return `Approval requested: ${String(toolName ?? "")}`;
          }
          if (p.type === "tool-call") return `Tool call: ${String(p.toolName ?? "")}`;
          if (p.type === "tool-result")
            return `Tool result: ${String(p.toolName ?? "")}`;
          if (p.type === "tool-error") return `Tool error: ${String(p.toolName ?? "")}`;
          return "";
        })
        .filter(Boolean)
        .join("\n");
      return truncate(parts);
    }
    if (content && typeof content === "object") {
      try {
        return truncate(JSON.stringify(content));
      } catch {
        return truncate(String(content));
      }
    }
    return truncate(String(content ?? ""));
  }
}
