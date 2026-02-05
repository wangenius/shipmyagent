/**
 * ContextStore（统一上下文存储）
 * Agent Runtime 的 Context 管理
 *
 * 目标
 * - 用一个模块统一管理“对 LLM 输入有用的一切上下文数据”，并明确区分两条数据链：
 *
 * 1) Chat transcript（用户视角对话历史）
 *    - 由 ChatStore（`.ship/chat/<chatKey>/conversations/history.jsonl`）负责落盘
 *    - 注入方式通常是“对话式”：作为一条 assistant message 注入（见 `chat_load_history`）
 *
 * 另外：本模块也负责维护“会话上下文 messages（in-memory）”，用于下一轮 LLM 输入：
 * - 这不是 ChatStore 的 transcript
 * - 这是 AgentRuntime 的 message cache（user/assistant/tool）
 */

import type { ModelMessage } from "ai";
import type { ConversationMessage } from "../../types/agent.js";
import type { ChatHistoryCompactionOptions } from "../../types/context.js";

export class ContextStore {
  private chatMessagesByChatKey: Map<string, ModelMessage[]> = new Map();
  constructor() {}

  // ---------------------------
  // Chat session messages (in-memory)
  // ---------------------------

  /**
   * 获取（或创建）某个 chatKey 的 in-memory messages 列表。
   *
   * 注意：这些 messages 用于下一轮 LLM 输入，不等价于 ChatStore 的 transcript。
   */
  getOrCreateChatSession(chatKey: string): ModelMessage[] {
    const key = String(chatKey || "").trim();
    const existing = this.chatMessagesByChatKey.get(key);
    if (existing) return existing;
    const fresh: ModelMessage[] = [];
    this.chatMessagesByChatKey.set(key, fresh);
    return fresh;
  }

  setChatSession(chatKey: string, messages: unknown[]): void {
    const key = String(chatKey || "").trim();
    this.chatMessagesByChatKey.set(
      key,
      this.coerceStoredMessagesToModelMessages(
        Array.isArray(messages) ? (messages as unknown[]) : [],
      ),
    );
  }

  replaceChatSession(chatKey: string, messages: ModelMessage[]): void {
    const key = String(chatKey || "").trim();
    this.chatMessagesByChatKey.set(key, messages);
  }

  deleteChatSession(chatKey: string): void {
    const key = String(chatKey || "").trim();
    this.chatMessagesByChatKey.delete(key);
  }

  clearChatSessions(chatKey?: string): void {
    const key = typeof chatKey === "string" ? chatKey.trim() : "";
    if (!key) this.chatMessagesByChatKey.clear();
    else this.chatMessagesByChatKey.delete(key);
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
      for (const messages of this.chatMessagesByChatKey.values()) {
        all.push(...messages.map(toLegacy));
      }
      return all;
    }

    return (this.chatMessagesByChatKey.get(chatKey) || []).map(toLegacy);
  }

  /**
   * 压缩某个 chat session 的 in-memory messages。
   *
   * 目标
   * - 把更早的 user/assistant/tool messages 合并成一条 assistant summary
   * - 保留最后 keepLast 条 messages（更贴近当前任务）
   *
   * 返回值
   * - true：完成压缩
   * - false：无法压缩（历史太短或输入不合法）
   */
  compactChatHistory(
    chatKey: string,
    opts: ChatHistoryCompactionOptions,
  ): boolean {
    const keepLast = Math.max(1, Math.min(5000, Math.floor(opts.keepLast)));
    const history = this.getOrCreateChatSession(chatKey);
    if (!Array.isArray(history)) return false;
    if (history.length <= keepLast + 2) return false;

    const cut = Math.max(1, history.length - keepLast);
    const older = history.slice(0, cut);
    const recent = history.slice(cut);

    const lines: string[] = [];
    lines.push("（已压缩更早的对话上下文，供参考）");
    lines.push(`- chatKey: ${chatKey}`);
    lines.push(`- olderMessages: ${older.length}`);
    lines.push("");

    const maxLines = 120;
    for (const m of older) {
      const role = String((m as any)?.role || "");
      const content = (m as any)?.content;
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? JSON.stringify(content).slice(0, 400)
            : String(content ?? "");
      if (!role || !text) continue;
      lines.push(`${role}: ${text.replace(/\s+$/g, "")}`.slice(0, 600));
      if (lines.length >= maxLines) {
        lines.push("…（省略更多压缩内容）");
        break;
      }
    }

    const summary: ModelMessage = {
      role: "assistant",
      content: lines.join("\n"),
    };

    history.splice(0, history.length, summary, ...recent);
    return true;
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
