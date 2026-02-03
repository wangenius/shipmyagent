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

export interface AgentInput {
  instructions: string;
  context?: {
    source?: "telegram" | "feishu" | "qq" | "cli" | "api";
    userId?: string;
    /**
     * Stable chat key for isolating conversation history.
     */
    chatKey?: string;
    actorId?: string;
    chatType?: string;
    actorUsername?: string;
    messageThreadId?: number;
    messageId?: string;
    replyMode?: "auto" | "tool";
  };
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
