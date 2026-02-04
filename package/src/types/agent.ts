import type { ShipConfig } from "../utils.js";

export interface AgentConfigurations {
  // 当前项目的根目录地址
  projectRoot: string;
  // ship 的配置
  config: ShipConfig;
  // 多个系统提示词 ： Agent.md | ShipMyAgentPreset | Skills | CurrentContextSummary
  systems: string[];
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
  query: string;
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
