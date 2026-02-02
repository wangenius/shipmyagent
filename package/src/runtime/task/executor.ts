import fs from "fs-extra";
import path from "path";
import { getTasksDirPath } from "../../utils.js";
import type { Logger } from "../logging/index.js";
import type { TaskDefinition } from "../scheduler/index.js";
import type { AgentInput, AgentRuntime } from "../agent/index.js";
import type { ToolExecutor } from "../tools/index.js";
import type { ExecutionResult } from "./types.js";

export class TaskExecutor {
  private toolExecutor: ToolExecutor;
  private logger: Logger;
  private agentRuntime: AgentRuntime | null;
  private projectRoot: string;

  constructor(
    toolExecutor: ToolExecutor,
    logger: Logger,
    agentRuntime: AgentRuntime | null,
    projectRoot: string,
  ) {
    this.toolExecutor = toolExecutor;
    this.logger = logger;
    this.agentRuntime = agentRuntime;
    this.projectRoot = projectRoot;
  }

  async executeTask(task: TaskDefinition, fallbackInstructions: string): Promise<ExecutionResult> {
    const startTime = Date.now();
    const toolCalls: ExecutionResult["toolCalls"] = [];

    this.logger.info(`Executing task: ${task.name}`);
    this.logger.debug(`Task instructions: ${fallbackInstructions}`);

    if (!this.agentRuntime) {
      return {
        success: false,
        output: "TaskExecutor requires an AgentRuntime instance to execute tasks",
        duration: Date.now() - startTime,
        toolCalls,
      };
    }

    try {
      const taskFilePath = path.join(getTasksDirPath(this.projectRoot), `${task.id}.md`);
      const fileInstructions = await this.readTaskBodyIfExists(taskFilePath);

      const agentInput: AgentInput = {
        instructions: fileInstructions || fallbackInstructions,
        context: { taskId: task.id, taskDescription: task.description },
      };

      const result = await this.agentRuntime.run(agentInput);
      return {
        success: result.success,
        output: result.output,
        duration: Date.now() - startTime,
        pendingApproval: (result as any).pendingApproval,
        toolCalls: result.toolCalls.map((tc) => ({
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

  async executeInstructions(
    instructions: string,
    context?: AgentInput["context"],
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const toolCalls: ExecutionResult["toolCalls"] = [];

    this.logger.action(`Executing instruction: ${instructions}`);

    if (!this.agentRuntime) {
      return {
        success: false,
        output: "TaskExecutor requires an AgentRuntime instance to execute instructions",
        duration: Date.now() - startTime,
        toolCalls,
      };
    }

    try {
      const agentInput: AgentInput = { instructions, context };
      const result = await this.agentRuntime.run(agentInput);
      return {
        success: result.success,
        output: result.output,
        duration: Date.now() - startTime,
        pendingApproval: (result as any).pendingApproval,
        toolCalls: result.toolCalls.map((tc) => ({
          tool: tc.tool,
          args: tc.input,
          result: tc.output,
        })),
      };
    } catch (error) {
      this.logger.error("Instruction execution failed", { error: String(error) });
      return {
        success: false,
        output: `Instruction execution failed: ${String(error)}`,
        duration: Date.now() - startTime,
        toolCalls,
      };
    }
  }

  private async readTaskBodyIfExists(taskFilePath: string): Promise<string> {
    if (!(await fs.pathExists(taskFilePath))) return "";
    const taskContent = await fs.readFile(taskFilePath, "utf-8");
    return taskContent.replace(/^---\n[\s\S]*?\n---/, "").trim();
  }
}

export function createTaskExecutor(
  toolExecutor: ToolExecutor,
  logger: Logger,
  agentRuntime: AgentRuntime | null,
  projectRoot: string,
): TaskExecutor {
  return new TaskExecutor(toolExecutor, logger, agentRuntime, projectRoot);
}
