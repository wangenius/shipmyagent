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
        this.logger.info(`执行任务: ${task.name}`);
        this.logger.debug(`任务指令: ${instructions}`);
        try {
            // 读取任务定义文件
            const taskFilePath = path.join(getProjectRoot('.'), '.ship', 'tasks', `${task.id}.md`);
            if (fs.existsSync(taskFilePath)) {
                const taskContent = await fs.readFile(taskFilePath, 'utf-8');
                const taskInstructions = taskContent.replace(/^---\n[\s\S]*?\n---/, '').trim();
                // 使用 Agent Runtime 执行任务
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
            // 如果没有任务文件，直接使用 Agent 执行
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
            this.logger.error(`任务执行失败: ${task.name}`, { error: String(error) });
            return {
                success: false,
                output: `任务执行失败: ${String(error)}`,
                duration: Date.now() - startTime,
                toolCalls,
            };
        }
    }
    async executeInstructions(instructions, sessionId) {
        const startTime = Date.now();
        const toolCalls = [];
        this.logger.action(`执行指令: ${instructions}`);
        try {
            // 使用 Agent Runtime 执行指令
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
            this.logger.error(`指令执行失败`, { error: String(error) });
            return {
                success: false,
                output: `指令执行失败: ${String(error)}`,
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