#!/usr/bin/env node
/**
 * ShipMyAgent - Agent Runtime with Human-in-the-loop Support
 *
 * Uses ai-sdk v6 ToolLoopAgent for advanced tool calling and
 * built-in support for human-in-the-loop workflows.
 */
import { ShipConfig } from '../utils.js';
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
        source?: 'telegram' | 'feishu' | 'cli' | 'scheduler' | 'api';
        userId?: string;
        sessionId?: string;
    };
}
export interface ApprovalRequest {
    id: string;
    timestamp: string;
    type: 'write_repo' | 'exec_shell' | 'other';
    description: string;
    tool: string;
    input: Record<string, unknown>;
    status: 'pending' | 'approved' | 'rejected';
    approvedBy?: string;
    approvedAt?: string;
}
export interface ConversationMessage {
    role: 'user' | 'assistant' | 'tool';
    content: string;
    toolCallId?: string;
    toolName?: string;
    timestamp: number;
}
/**
 * ToolLoopAgent-based Agent Runtime with Human-in-the-loop support
 */
export declare class AgentRuntime {
    private context;
    private initialized;
    private logger;
    private permissionEngine;
    private agent;
    private conversationHistories;
    private readonly MAX_HISTORY_MESSAGES;
    constructor(context: AgentContext);
    /**
     * 获取对话历史
     */
    getConversationHistory(sessionId?: string): ConversationMessage[];
    /**
     * 清除对话历史
     */
    clearConversationHistory(sessionId?: string): void;
    /**
     * 添加消息到对话历史（带长度限制）
     */
    private addToHistory;
    /**
     * Initialize the Agent with generateText (legacy AI SDK)
     */
    initialize(): Promise<void>;
    /**
     * Check if a tool call requires approval
     */
    private checkToolCallApproval;
    /**
     * Create legacy-style tools with permission checks and approval workflow
     */
    private createTools;
    /**
     * Run the agent with the given instructions
     */
    run(input: AgentInput): Promise<AgentResult>;
    /**
     * Run with generateText and manual tool loop (legacy AI SDK)
     */
    private runWithGenerateText;
    /**
     * 构建对话上下文（将历史消息转换为提示词）
     */
    private buildConversationContext;
    /**
     * Simulation mode for when AI is not available
     */
    private runSimulated;
    private generateStatusResponse;
    private generateTasksResponse;
    private generateScanResponse;
    private generateApprovalsResponse;
    /**
     * Execute an approved operation (called after approval)
     */
    executeApproved(approvalId: string): Promise<{
        success: boolean;
        result: unknown;
    }>;
    /**
     * Execute a tool directly (for approved operations)
     */
    private executeTool;
    /**
     * Check if agent is initialized
     */
    isInitialized(): boolean;
}
export declare function createAgentRuntime(context: AgentContext): AgentRuntime;
export declare function createAgentRuntimeFromPath(projectRoot: string): AgentRuntime;
//# sourceMappingURL=agent.d.ts.map