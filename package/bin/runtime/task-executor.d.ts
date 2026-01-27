import { Logger } from './logger.js';
import { ToolExecutor } from './tools.js';
import { TaskDefinition } from './scheduler.js';
import { AgentRuntime } from './agent.js';
export interface ExecutionResult {
    success: boolean;
    output: string;
    duration: number;
    error?: string;
    toolCalls?: Array<{
        tool: string;
        args: Record<string, unknown>;
        result: string;
    }>;
}
export declare class TaskExecutor {
    private toolExecutor;
    private logger;
    private agentRuntime;
    private projectRoot;
    constructor(toolExecutor: ToolExecutor, logger: Logger, agentRuntime: AgentRuntime, projectRoot: string);
    executeTask(task: TaskDefinition, instructions: string): Promise<ExecutionResult>;
    executeInstructions(instructions: string): Promise<ExecutionResult>;
}
export declare function createTaskExecutor(toolExecutor: ToolExecutor, logger: Logger, agentRuntime: AgentRuntime, projectRoot: string): TaskExecutor;
//# sourceMappingURL=task-executor.d.ts.map