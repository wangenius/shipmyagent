import path from 'path';
import fs from 'fs-extra';
import { getTimestamp, getShipJsonPath, getTasksDirPath } from '../utils.js';
import { Logger } from './logger.js';
import { PermissionEngine } from './permission.js';
import { ToolExecutor, ToolContext } from './tools.js';
import { TaskDefinition } from './scheduler.js';
import { AgentRuntime, createAgentRuntime, AgentInput } from './agent.js';

export interface ExecutionResult {
  success: boolean;
  output: string;
  duration: number;
  error?: string;
  pendingApproval?: any;
  toolCalls?: Array<{
    tool: string;
    args: Record<string, unknown>;
    result: string;
  }>;
}

export class TaskExecutor {
  private toolExecutor: ToolExecutor;
  private logger: Logger;
  private agentRuntime: AgentRuntime;
  private projectRoot: string;

  constructor(toolExecutor: ToolExecutor, logger: Logger, agentRuntime: AgentRuntime, projectRoot: string) {
    this.toolExecutor = toolExecutor;
    this.logger = logger;
    this.agentRuntime = agentRuntime;
    this.projectRoot = projectRoot;
  }

  async executeTask(task: TaskDefinition, instructions: string): Promise<ExecutionResult> {
    const startTime = Date.now();
    const toolCalls: ExecutionResult['toolCalls'] = [];

    this.logger.info(`Executing task: ${task.name}`);
    this.logger.debug(`Task instructions: ${instructions}`);

    try {
      // Read task definition file
      const taskFilePath = path.join(this.projectRoot, '.ship', 'tasks', `${task.id}.md`);

      if (fs.existsSync(taskFilePath)) {
        const taskContent = await fs.readFile(taskFilePath, 'utf-8');
        const taskInstructions = taskContent.replace(/^---\n[\s\S]*?\n---/, '').trim();

        // Use Agent Runtime to execute task
        const agentInput: AgentInput = {
          instructions: taskInstructions || instructions,
          context: {
            taskId: task.id,
            taskDescription: task.description,
          },
        };

        const result = await this.agentRuntime.run(agentInput);

        return {
          success: result.success,
          output: result.output,
          duration: Date.now() - startTime,
          pendingApproval: (result as any).pendingApproval,
          toolCalls: result.toolCalls.map(tc => ({
            tool: tc.tool,
            args: tc.input,
            result: tc.output,
          })),
        };
      }

      // If no task file, execute directly using Agent
      const agentInput: AgentInput = {
        instructions,
        context: {
          taskId: task.id,
          taskDescription: task.description,
        },
      };

      const result = await this.agentRuntime.run(agentInput);

      return {
        success: result.success,
        output: result.output,
        duration: Date.now() - startTime,
        pendingApproval: (result as any).pendingApproval,
        toolCalls: result.toolCalls.map(tc => ({
          tool: tc.tool,
          args: tc.input,
          result: tc.output,
        })),
      };
    } catch (error) {
      this.logger.error(`Task execution failed: ${task.name}`, { error: String(error) });

      return {
        success: false,
        output: `Task execution failed: ${String(error)}`,
        duration: Date.now() - startTime,
        toolCalls,
      };
    }
  }

  async executeInstructions(instructions: string, context?: AgentInput['context']): Promise<ExecutionResult> {
    const startTime = Date.now();
    const toolCalls: ExecutionResult['toolCalls'] = [];

    this.logger.action(`Executing instruction: ${instructions}`);

    try {
      // Use Agent Runtime to execute instruction
      const agentInput: AgentInput = {
        instructions,
        context,
      };

      const result = await this.agentRuntime.run(agentInput);

      return {
        success: result.success,
        output: result.output,
        duration: Date.now() - startTime,
        pendingApproval: (result as any).pendingApproval,
        toolCalls: result.toolCalls.map(tc => ({
          tool: tc.tool,
          args: tc.input,
          result: tc.output,
        })),
      };
    } catch (error) {
      this.logger.error(`Instruction execution failed`, { error: String(error) });

      return {
        success: false,
        output: `Instruction execution failed: ${String(error)}`,
        duration: Date.now() - startTime,
        toolCalls,
      };
    }
  }
}

export function createTaskExecutor(
  toolExecutor: ToolExecutor,
  logger: Logger,
  agentRuntime: AgentRuntime,
  projectRoot: string
): TaskExecutor {
  return new TaskExecutor(toolExecutor, logger, agentRuntime, projectRoot);
}
