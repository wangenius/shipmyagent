import type { ShipConfig } from "../../utils.js";

export interface AgentContext {
  projectRoot: string;
  config: ShipConfig;
  agentMd: string;
}

export interface AgentResult {
  success: boolean;
  output: string;
  toolCalls: Array<{
    tool: string;
    input: Record<string, unknown>;
    output: string;
  }>;
}

export interface AgentRunInput {
  /**
   * Stable chat key for isolating conversation history and memory.
   *
   * This is the only identifier AgentRuntime needs for multi-user operation.
   */
  chatKey: string;
  instructions: string;
  onStep?: (event: {
    type: string;
    text: string;
    data?: Record<string, unknown>;
  }) => Promise<void>;
}

export interface ConversationMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: string;
  timestamp: number;
}
