import type { ShipMessageV1 } from "./chat-history.js";

export interface AgentResult {
  success: boolean;
  output: string;
  toolCalls: Array<{
    tool: string;
    input: Record<string, unknown>;
    output: string;
  }>;
  /**
   * 本次运行的最终 assistant UIMessage（包含 tool parts）。
   *
   * 关键点（中文）
   * - 用 ai-sdk v6 的 `toUIMessageStream()` 生成，避免手工拼 tool parts
   * - 由调用方落盘到 `.ship/chat/<chatKey>/messages/history.jsonl`
   */
  assistantMessage?: ShipMessageV1;
}

export interface AgentRunInput {
  /**
   * Stable chat key for isolating conversation history and memory.
   *
   * This is the only identifier AgentRuntime needs for multi-user operation.
   */
  chatKey: string;
  query: string;
  onStep?: (event: {
    type: string;
    text: string;
    data?: Record<string, unknown>;
  }) => Promise<void>;

  /**
   * Lane “快速矫正”：在每个 step 之前检查当前 chatKey lane 是否有新消息。
   *
   * 新设计（中文，关键点）
   * - 历史以 UIMessage[] 为唯一事实源；新消息会先被写入 history
   * - 本函数只负责“drain 本 lane 的后续消息”（避免它们在本次 time-slice 里被重复处理）
   * - Agent 会在检测到 drained>0 后重载 history，并把新的 messages 送入下一 step
   */
  drainLaneMerged?: () => Promise<{ drained: number } | null>;
}

export interface ConversationMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: string;
  timestamp: number;
}
