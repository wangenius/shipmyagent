import fs from 'fs-extra';
import path from 'path';
import cron from 'node-cron';
import { getTimestamp, getTasksDirPath } from '../utils.js';
export class TaskScheduler {
    tasks = new Map();
    cronJobs = new Map();
    projectRoot;
    logger;
    taskHandler;
    executions = new Map();
    constructor(projectRoot, logger, taskHandler) {
        this.projectRoot = projectRoot;
        this.logger = logger;
        this.taskHandler = taskHandler;
    }
    async loadTasks() {
        const tasksDir = getTasksDirPath(this.projectRoot);
        if (!fs.existsSync(tasksDir)) {
            this.logger.info('任务目录不存在，跳过加载任务');
            return;
        }
        const files = await fs.readdir(tasksDir);
        const taskFiles = files.filter(f => f.endsWith('.md'));
        for (const file of taskFiles) {
            try {
                const content = await fs.readFile(path.join(tasksDir, file), 'utf-8');
                const task = this.parseTaskFile(file.replace('.md', ''), content);
                if (task) {
                    this.tasks.set(task.id, task);
                    this.logger.info(`加载任务: ${task.name} (${task.id})`);
                }
            }
            catch (error) {
                this.logger.warn(`加载任务文件失败: ${file}`, { error: String(error) });
            }
        }
        this.logger.info(`共加载 ${this.tasks.size} 个任务`);
    }
    parseTaskFile(id, content) {
        // 解析 YAML 前置元数据
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) {
            return {
                id,
                name: id,
                cron: '0 9 * * *', // 默认每天 9 点
                enabled: true,
            };
        }
        try {
            const frontmatter = frontmatterMatch[1];
            const metadata = {};
            for (const line of frontmatter.split('\n')) {
                const match = line.match(/^(\w+):\s*(.*)$/);
                if (match) {
                    metadata[match[1]] = match[2].trim();
                }
            }
            return {
                id: metadata['id'] || id,
                name: metadata['name'] || id,
                cron: metadata['cron'] || '0 9 * * *',
                notify: metadata['notify'],
                description: content.replace(/^---\n[\s\S]*?\n---/, '').trim(),
                enabled: metadata['enabled'] !== 'false',
            };
        }
        catch (error) {
            return null;
        }
    }
    start() {
        for (const [id, task] of this.tasks) {
            if (!task.enabled) {
                this.logger.info(`任务 ${task.name} 已禁用，跳过`);
                continue;
            }
            try {
                const cronJob = cron.schedule(task.cron, async () => {
                    await this.executeTask(task);
                });
                this.cronJobs.set(id, cronJob);
                this.logger.info(`任务 ${task.name} 已调度 (${task.cron})`);
            }
            catch (error) {
                this.logger.warn(`调度任务失败: ${task.name}`, { error: String(error) });
            }
        }
        this.logger.info(`调度器启动，共 ${this.cronJobs.size} 个活跃任务`);
    }
    async executeTask(task) {
        const execution = {
            taskId: task.id,
            startTime: getTimestamp(),
            status: 'running',
        };
        // 记录执行
        if (!this.executions.has(task.id)) {
            this.executions.set(task.id, []);
        }
        this.executions.get(task.id).push(execution);
        this.logger.action(`开始执行任务: ${task.name}`);
        try {
            await this.taskHandler(task);
            execution.status = 'completed';
            execution.endTime = getTimestamp();
            this.logger.info(`任务执行完成: ${task.name}`);
        }
        catch (error) {
            execution.status = 'failed';
            execution.endTime = getTimestamp();
            execution.error = String(error);
            this.logger.error(`任务执行失败: ${task.name}`, { error: String(error) });
        }
    }
    async runTaskNow(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) {
            return false;
        }
        await this.executeTask(task);
        return true;
    }
    getTasks() {
        return Array.from(this.tasks.values());
    }
    getTask(id) {
        return this.tasks.get(id);
    }
    getTaskExecutions(taskId) {
        return this.executions.get(taskId) || [];
    }
    getAllExecutions() {
        return this.executions;
    }
    stop() {
        for (const [id, cronJob] of this.cronJobs) {
            cronJob.stop();
            this.logger.info(`任务已停止: ${id}`);
        }
        this.cronJobs.clear();
    }
}
export function createTaskScheduler(projectRoot, logger, taskHandler) {
    return new TaskScheduler(projectRoot, logger, taskHandler);
}
//# sourceMappingURL=scheduler.js.map