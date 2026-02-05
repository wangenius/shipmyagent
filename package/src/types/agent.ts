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

  /**
   * Lane “快速矫正”合并：在每个 LLM step 之前检查当前 chatKey lane 是否有新消息，
   * 若有则合并为一段文本并返回，Agent 会把它追加到当前 user message 的末尾。
   *
   * 关键点（中文）
   * - 由调度器（ChatLaneScheduler）提供实现（它掌握 lane 队列）
   * - Agent 通过 `prepareStep` 调用该函数，实现 step 间的快速并入处理
   */
  drainLaneMergedText?: () => Promise<string | null>;
}

export interface ConversationMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: string;
  timestamp: number;
}
