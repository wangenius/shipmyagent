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
        source?: 'telegram' | 'cli' | 'scheduler' | 'api';
        userId?: string;
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
/**
 * ToolLoopAgent-based Agent Runtime with Human-in-the-loop support
 */
export declare class AgentRuntime {
    private context;
    private initialized;
    private logger;
    private permissionEngine;
    private agent;
    constructor(context: AgentContext);
    /**
     * Initialize the Agent with ToolLoopAgent
     */
    initialize(): Promise<void>;
    /**
     * Check if a tool call requires approval
     */
    private checkToolCallApproval;
    /**
     * Create v6-style tools with permission checks and approval workflow
     */
    private createToolsV6;
    /**
     * Generate a diff between original and modified content
     */
    private generateDiff;
    /**
     * Run the agent with the given instructions
     */
    run(input: AgentInput): Promise<AgentResult>;
    /**
     * Run with ToolLoopAgent (v6)
     */
    private runWithToolLoopAgent;
    /**
     * Check if a checkpoint exists for the given task
     */
    private hasCheckpoint;
    /**
     * Get checkpoint data for resuming
     */
    private getCheckpoint;
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