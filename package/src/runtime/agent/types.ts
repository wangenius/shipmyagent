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
  pendingApproval?: {
    id: string;
    type: string;
    description: string;
    data: Record<string, unknown>;
  };
}

export interface AgentInput {
  instructions: string;
  context?: {
    taskId?: string;
    taskDescription?: string;
    source?: "telegram" | "feishu" | "qq" | "cli" | "scheduler" | "api";
    userId?: string;
    sessionId?: string;
    runId?: string;
    actorId?: string;
    chatType?: string;
    actorUsername?: string;
    messageThreadId?: number;
    messageId?: string;
    replyMode?: "auto" | "tool";
    initiatorId?: string;
  };
  onStep?: (event: {
    type: string;
    text: string;
    data?: Record<string, unknown>;
  }) => Promise<void>;
}

export interface ApprovalRequest {
  id: string;
  timestamp: string;
  type: "write_repo" | "exec_shell" | "other";
  description: string;
  tool: string;
  input: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  approvedBy?: string;
  approvedAt?: string;
}

export interface ConversationMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: string;
  timestamp: number;
}

export interface ApprovalDecisionResult {
  approvals?: Record<string, string>;
  refused?: Record<string, string>;
  pass?: Record<string, string>;
}

