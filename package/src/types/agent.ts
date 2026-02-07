import type { ShipConfig } from "../utils.js";

export interface AgentConfigurations {
  /**
   * 工程根目录（projectRoot）。
   *
   * 关键点（中文）
   * - 我们约束“一个进程只服务一个 projectRoot”，但 Agent 仍需要知道落盘路径
   * - 这里作为配置显式字段，便于在构造时一次性注入
   */
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
   * Lane "快速矫正"合并：在每个 LLM step 之前检查当前 chatKey lane 是否有新消息，
   * 若有则合并为一段文本并返回，Agent 会把它追加到"本轮的 user message"末尾（保持只有一条 user）。
   *
   * 同时（关键点，中文）
   * - 新消息"无法抢占"正在进行的模型调用；只能在下一次模型调用前并入（例如工具调用完成后进入下一 step）。
   *
   * 关键点（中文）
   * - 由调度器（ChatLaneScheduler）提供实现（它掌握 lane 队列）
   * - Agent 通过 `prepareStep` 调用该函数，实现 step 间的快速并入处理
   */
  drainLaneMergedText?: () => Promise<string | null>;

  /**
   * ChatRuntime 引用，用于实时保存和记忆检查。
   *
   * 关键点（中文）
   * - Agent 在每个 step 完成后会立即保存 tool 和 assistant 消息到 ChatStore
   * - 保存后会异步检查是否需要提取记忆（不阻塞）
   */
  chatRuntime?: any; // 使用 any 避免循环依赖，实际类型是 ChatRuntime
}

export interface ConversationMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: string;
  timestamp: number;
}
