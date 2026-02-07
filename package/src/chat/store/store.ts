import fs from "fs-extra";
import {
  getShipChatConversationsDirPath,
  getShipChatDirPath,
  getShipChatHistoryPath,
  getShipChatMemoryDirPath,
  getShipChatMemoryPrimaryPath,
} from "../../utils.js";

export type ChatChannel =
  | "telegram"
  | "feishu"
  | "qq"
  | "api"
  | "cli"
  | "scheduler";
export type ChatRole = "user" | "assistant" | "system" | "tool";

export interface ChatLogEntryV1 {
  v: 1;
  ts: number;
  channel: ChatChannel;
  chatId: string;
  chatKey: string;
  userId?: string;
  messageId?: string;
  role: ChatRole;
  text: string;
  meta?: Record<string, unknown>;
}

/**
 * ChatStore：单个 chatKey 的审计与追溯（per-chat）。
 *
 * 设计目标
 * - "一个 chat 一个 store"：对上层来说它就是这个 chat 的 transcript 读写入口
 * - 简化存储：只使用 history.jsonl，无归档、无缓存、无搜索
 */
export class ChatStore {
  readonly projectRoot: string;
  readonly chatKey: string;

  constructor(params: { projectRoot: string; chatKey: string }) {
    const root = String(params.projectRoot || "").trim();
    if (!root) throw new Error("ChatStore requires a non-empty projectRoot");
    const key = String(params.chatKey || "").trim();
    if (!key) throw new Error("ChatStore requires a non-empty chatKey");
    this.projectRoot = root;
    this.chatKey = key;
  }

  /**
   * 获取该 chatKey 的落盘目录。
   *
   * 存储结构（每个 chatKey 一个目录）：
   * - `.ship/chat/<encodedChatKey>/conversations/history.jsonl`
   * - `.ship/chat/<encodedChatKey>/memory/`（按需，用于持久化记忆）
   */
  getChatDirPath(): string {
    return getShipChatDirPath(this.projectRoot, this.chatKey);
  }

  getHistoryFilePath(): string {
    return getShipChatHistoryPath(this.projectRoot, this.chatKey);
  }

  async append(
    entry: Omit<ChatLogEntryV1, "v" | "ts" | "chatKey"> &
      Partial<Pick<ChatLogEntryV1, "ts">>,
  ): Promise<void> {
    const full: ChatLogEntryV1 = {
      v: 1,
      ts: typeof entry.ts === "number" ? entry.ts : Date.now(),
      channel: entry.channel,
      chatId: entry.chatId,
      chatKey: this.chatKey,
      userId: entry.userId,
      messageId: entry.messageId,
      role: entry.role,
      text: String(entry.text ?? ""),
      meta: entry.meta,
    };

    const convDir = getShipChatConversationsDirPath(
      this.projectRoot,
      this.chatKey,
    );
    await fs.ensureDir(convDir);
    // 预创建 memory 目录（不要求存在 Primary.md，但保持结构一致）
    await fs.ensureDir(
      getShipChatMemoryDirPath(this.projectRoot, this.chatKey),
    );
    await fs.ensureFile(
      getShipChatMemoryPrimaryPath(this.projectRoot, this.chatKey),
    );
    await fs.appendFile(
      this.getHistoryFilePath(),
      JSON.stringify(full) + "\n",
      "utf8",
    );
  }

  /**
   * 加载最近的消息记录（转换为纯文本格式）
   * @param limit 加载条数限制，默认10条
   * @param maxChars 最大字符数限制，超过时从旧消息开始截断
   * @returns 格式化的对话历史文本
   */
  async loadRecentMessagesAsText(limit: number = 10, maxChars?: number): Promise<string> {
    const safeLimit = Math.max(1, Math.min(5000, Math.floor(limit)));
    const file = this.getHistoryFilePath();

    if (!(await fs.pathExists(file))) return "";

    try {
      const raw = await fs.readFile(file, "utf8");
      const lines = raw.split("\n").filter(Boolean);
      const recentLines = lines.slice(-safeLimit);

      // 先解析所有条目
      const entries: Array<{role: string; text: string}> = [];
      for (const line of recentLines) {
        try {
          const obj = JSON.parse(line) as Partial<ChatLogEntryV1>;
          if (!obj || typeof obj !== "object") continue;
          if (obj.v !== 1) continue;
          if (obj.chatKey !== this.chatKey) continue;
          if (typeof obj.role !== "string") continue;

          entries.push({
            role: obj.role,
            text: typeof obj.text === "string" ? obj.text : "",
          });
        } catch {
          // ignore invalid lines
        }
      }

      // 找到并移除最后一条 user 消息（避免与当前请求的 user message 重复）
      let lastUserIndex = -1;
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].role === "user") {
          lastUserIndex = i;
          break;
        }
      }
      if (lastUserIndex >= 0) {
        entries.splice(lastUserIndex, 1);
      }

      // 格式化剩余条目
      const historyLines: string[] = [];
      for (const entry of entries) {
        const role = entry.role;
        const text = entry.text;

        if (role === "user") {
          historyLines.push(`User: ${text}`);
        } else if (role === "assistant") {
          if (text.trim()) {
            historyLines.push(`Assistant: ${text}`);
          }
        } else if (role === "tool") {
          // 解析工具调用并格式化为文本
          try {
            const toolCalls = JSON.parse(text);
            if (Array.isArray(toolCalls) && toolCalls.length > 0) {
              const toolLines: string[] = [];
              for (const tc of toolCalls) {
                if (!tc || typeof tc !== "object" || typeof tc.tool !== "string") continue;

                // 格式化工具调用
                const toolName = tc.tool;
                const inputStr = typeof tc.input === "object" && tc.input !== null
                  ? JSON.stringify(tc.input)
                  : "{}";
                const outputStr = typeof tc.output === "string"
                  ? tc.output
                  : (tc.output !== undefined && tc.output !== null)
                    ? JSON.stringify(tc.output)
                    : "";

                toolLines.push(`[Tool] ${toolName}(${inputStr}) → ${outputStr}`);
              }
              if (toolLines.length > 0) {
                historyLines.push(toolLines.join("\n"));
              }
            }
          } catch {
            // 如果解析失败，忽略该条
          }
        } else if (role === "system") {
          historyLines.push(`[System] ${text}`);
        }
      }

      if (historyLines.length === 0) return "";

      let result = "=== Chat History ===\n\n" + historyLines.join("\n\n") + "\n\n=====================";

      // 字符截断：如果设置了 maxChars 且超长，从头部开始截断
      if (typeof maxChars === "number" && maxChars > 0 && result.length > maxChars) {
        const header = "=== Chat History ===\n\n";
        const footer = "\n\n=====================";
        const availableChars = maxChars - header.length - footer.length - 50; // 留50字符给截断提示

        if (availableChars > 0) {
          // 从后往前保留消息，确保最新的消息被保留
          let truncated = "";
          for (let i = historyLines.length - 1; i >= 0; i--) {
            const line = historyLines[i] + "\n\n";
            if (truncated.length + line.length > availableChars) break;
            truncated = line + truncated;
          }
          result = header + "(注：历史过长已截断)\n\n" + truncated + footer;
        }
      }

      return result;
    } catch {
      return "";
    }
  }

  /**
   * 加载最近的原始日志条目
   * @param limit 加载条数限制，默认20条
   */
  async loadRecentEntries(limit: number = 20): Promise<ChatLogEntryV1[]> {
    const safeLimit = Math.max(1, Math.min(5000, Math.floor(limit)));
    const file = this.getHistoryFilePath();

    if (!(await fs.pathExists(file))) return [];

    const raw = await fs.readFile(file, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const out: ChatLogEntryV1[] = [];

    for (let i = Math.max(0, lines.length - safeLimit); i < lines.length; i++) {
      const line = lines[i];
      try {
        const obj = JSON.parse(line) as Partial<ChatLogEntryV1>;
        if (!obj || typeof obj !== "object") continue;
        if (obj.v !== 1) continue;
        if (obj.chatKey !== this.chatKey) continue;
        if (typeof obj.ts !== "number") continue;
        if (typeof obj.role !== "string") continue;
        if (typeof obj.text !== "string") continue;
        out.push(obj as ChatLogEntryV1);
      } catch {
        // ignore invalid lines
      }
    }

    return out;
  }

  /**
   * 获取总记录数
   */
  async getTotalEntryCount(): Promise<number> {
    const file = this.getHistoryFilePath();
    if (!(await fs.pathExists(file))) return 0;

    try {
      const raw = await fs.readFile(file, "utf8");
      const lines = raw.split("\n").filter(Boolean);
      return lines.length;
    } catch {
      return 0;
    }
  }

  /**
   * 加载指定范围的记录（用于记忆提取）
   * @param startIndex 起始索引（从0开始）
   * @param endIndex 结束索引（不包含）
   */
  async loadEntriesByRange(
    startIndex: number,
    endIndex: number
  ): Promise<ChatLogEntryV1[]> {
    const file = this.getHistoryFilePath();
    if (!(await fs.pathExists(file))) return [];

    try {
      const raw = await fs.readFile(file, "utf8");
      const lines = raw.split("\n").filter(Boolean);
      const targetLines = lines.slice(startIndex, endIndex);

      const entries: ChatLogEntryV1[] = [];
      for (const line of targetLines) {
        try {
          const obj = JSON.parse(line) as Partial<ChatLogEntryV1>;
          if (!obj || typeof obj !== "object") continue;
          if (obj.v !== 1) continue;
          if (obj.chatKey !== this.chatKey) continue;
          if (typeof obj.ts !== "number") continue;
          if (typeof obj.role !== "string") continue;
          if (typeof obj.text !== "string") continue;
          entries.push(obj as ChatLogEntryV1);
        } catch {
          // ignore invalid lines
        }
      }
      return entries;
    } catch {
      return [];
    }
  }

  /**
   * 加载指定范围的记录并格式化为文本（用于记忆提取）
   */
  async loadEntriesByRangeAsText(
    startIndex: number,
    endIndex: number
  ): Promise<string> {
    const entries = await this.loadEntriesByRange(startIndex, endIndex);

    const historyLines: string[] = [];
    for (const entry of entries) {
      const role = entry.role;
      const text = entry.text;

      if (role === "user") {
        historyLines.push(`User: ${text}`);
      } else if (role === "assistant") {
        if (text.trim()) {
          historyLines.push(`Assistant: ${text}`);
        }
      } else if (role === "tool") {
        // Tool 消息已在保存时截断，这里跳过以节省上下文
        continue;
      } else if (role === "system") {
        historyLines.push(`[System] ${text}`);
      }
    }

    if (historyLines.length === 0) return "";
    return historyLines.join("\n\n");
  }
}
