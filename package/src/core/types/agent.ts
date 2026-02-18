/**
 * Core Agent 运行结果与输入类型。
 *
 * 关键点（中文）
 * - 仅描述 core runtime 的最小输入/输出契约
 * - 不包含具体实现细节
 */

import type { ShipSessionMessageV1 } from "./session-history.js";

export interface AgentResult {
  success: boolean;
  output: string;
  toolCalls: Array<{
    tool: string;
    input: Record<string, unknown>;
    output: string;
  }>;
  assistantMessage?: ShipSessionMessageV1;
}

export interface AgentRunInput {
  sessionId: string;
  query: string;
  drainLaneMerged?: () => Promise<{ drained: number } | null>;
}

export interface ConversationMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: string;
  timestamp: number;
}
