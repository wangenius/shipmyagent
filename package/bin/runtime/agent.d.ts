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
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
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
declare class PermissionEngine {
    private context;
    constructor(context: AgentContext);
    /**
     * 检查是否允许执行某个操作
     */
    canPerform(action: string, data?: Record<string, unknown>): {
        allowed: boolean;
        requiresApproval: boolean;
        reason?: string;
    };
    /**
     * 创建审批请求
     */
    createApproval(type: 'write_repo' | 'exec_shell' | 'other', description: string, tool: string, input: Record<string, unknown>): Promise<ApprovalRequest>;
    /**
     * 获取待审批请求
     */
    getPendingApprovals(): Promise<ApprovalRequest[]>;
    /**
     * 审批操作
     */
    approve(approvalId: string, approvedBy: string): Promise<boolean>;
    /**
     * 拒绝操作
     */
    reject(approvalId: string, rejectedBy: string): Promise<boolean>;
}
export declare class AgentTools {
    private context;
    private permissionEngine;
    private logger;
    constructor(context: AgentContext);
    /**
     * 获取所有工具定义
     */
    getToolDefinitions(): ToolDefinition[];
    /**
     * 执行工具调用
     */
    executeTool(toolName: string, args: Record<string, unknown>): Promise<{
        success: boolean;
        result: unknown;
        error?: string;
        pendingApproval?: ApprovalRequest;
    }>;
    private toolReadFile;
    private toolListFiles;
    private toolSearchFiles;
    private toolWriteFile;
    private toolDeleteFile;
    private toolExecShell;
    private toolGetStatus;
    private toolGetTasks;
    private toolGetPendingApprovals;
    private toolApprove;
    private toolCreateDiff;
}
export declare class AgentRuntime {
    private context;
    private tools;
    private permissionEngine;
    private initialized;
    private logger;
    constructor(context: AgentContext);
    /**
     * 初始化 Agent
     */
    initialize(): Promise<void>;
    /**
     * 运行 Agent
     */
    run(input: AgentInput): Promise<AgentResult>;
    /**
     * 使用 AI SDK 运行真实 Agent
     */
    private runWithAI;
    /**
     * 创建 AI 工具定义
     */
    private createAITools;
    /**
     * 执行已审批的操作
     */
    executeApproved(approvalId: string): Promise<{
        success: boolean;
        result: unknown;
    }>;
    /**
     * 模拟模式（当 AI 不可用时）
     */
    private runSimulated;
    private generateStatusResponse;
    private generateTasksResponse;
    private generateScanResponse;
    private generateApprovalsResponse;
    /**
     * 获取工具实例
     */
    getTools(): AgentTools;
    /**
     * 获取权限引擎实例
     */
    getPermissionEngine(): PermissionEngine;
    /**
     * 获取配置
     */
    getConfig(): ShipConfig;
    /**
     * 检查是否已初始化
     */
    isInitialized(): boolean;
}
export declare function createAgentRuntime(context: AgentContext): AgentRuntime;
export declare function createAgentRuntimeFromPath(projectRoot: string): AgentRuntime;
export {};
//# sourceMappingURL=agent.d.ts.map