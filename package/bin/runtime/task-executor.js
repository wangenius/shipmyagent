import path from 'path';
import fs from 'fs-extra';
import { getProjectRoot } from '../utils.js';
export class TaskExecutor {
    toolExecutor;
    logger;
    agentRuntime;
    projectRoot;
    constructor(toolExecutor, logger, agentRuntime, projectRoot) {
        this.toolExecutor = toolExecutor;
        this.logger = logger;
        this.agentRuntime = agentRuntime;
        this.projectRoot = projectRoot;
    }
    async executeTask(task, instructions) {
        const startTime = Date.now();
        const toolCalls = [];
        this.logger.info(`Executing task: ${task.name}`);
        this.logger.debug(`Task instructions: ${instructions}`);
        try {
            // Read task definition file
            const taskFilePath = path.join(getProjectRoot('.'), '.ship', 'tasks', `${task.id}.md`);
            if (fs.existsSync(taskFilePath)) {
                const taskContent = await fs.readFile(taskFilePath, 'utf-8');
                const taskInstructions = taskContent.replace(/^---\n[\s\S]*?\n---/, '').trim();
                // Use Agent Runtime to execute task
                const agentInput = {
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
                    toolCalls: result.toolCalls.map(tc => ({
                        tool: tc.tool,
                        args: tc.input,
                        result: tc.output,
                    })),
                };
            }
            // If no task file, execute directly using Agent
            const agentInput = {
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
                toolCalls: result.toolCalls.map(tc => ({
                    tool: tc.tool,
                    args: tc.input,
                    result: tc.output,
                })),
            };
        }
        catch (error) {
            this.logger.error(`Task execution failed: ${task.name}`, { error: String(error) });
            return {
                success: false,
                output: `Task execution failed: ${String(error)}`,
                duration: Date.now() - startTime,
                toolCalls,
            };
        }
    }
    async executeInstructions(instructions, sessionId) {
        const startTime = Date.now();
        const toolCalls = [];
        this.logger.action(`Executing instruction: ${instructions}`);
        try {
            // Use Agent Runtime to execute instruction
            const agentInput = {
                instructions,
                context: {
                    sessionId,
                },
            };
            const result = await this.agentRuntime.run(agentInput);
            return {
                success: result.success,
                output: result.output,
                duration: Date.now() - startTime,
                toolCalls: result.toolCalls.map(tc => ({
                    tool: tc.tool,
                    args: tc.input,
                    result: tc.output,
                })),
            };
        }
        catch (error) {
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
export function createTaskExecutor(toolExecutor, logger, agentRuntime, projectRoot) {
    return new TaskExecutor(toolExecutor, logger, agentRuntime, projectRoot);
}
//# sourceMappingURL=task-executor.js.map