import type { ShipSessionMessageV1 } from "./session-history.js";

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
   */
  assistantMessage?: ShipSessionMessageV1;
}

export interface AgentRunInput {
  /**
   * 会话唯一标识（core 只认 session 语义）。
   */
  sessionId: string;
  query: string;
  /**
   * lane 快速矫正：在 step 前尝试 drain 当前 session 的后续消息。
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
