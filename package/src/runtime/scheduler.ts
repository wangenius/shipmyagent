import fs from 'fs-extra';
import path from 'path';
import cron from 'node-cron';
import { getTimestamp, getTasksDirPath, getProjectRoot } from '../utils.js';
import { Logger } from './logger.js';

export interface TaskDefinition {
  id: string;
  name: string;
  cron: string;
  notify?: string;
  source?: 'telegram' | 'feishu';
  chatId?: string;
  description?: string;
  enabled?: boolean;
}

export interface TaskExecution {
  taskId: string;
  startTime: string;
  endTime?: string;
  status: 'running' | 'completed' | 'failed';
  output?: string;
  error?: string;
}

type TaskHandler = (task: TaskDefinition) => Promise<void>;

export class TaskScheduler {
  private tasks: Map<string, TaskDefinition> = new Map();
  private cronJobs: Map<string, cron.ScheduledTask> = new Map();
  private projectRoot: string;
  private logger: Logger;
  private taskHandler: TaskHandler;
  private executions: Map<string, TaskExecution[]> = new Map();

  constructor(
    projectRoot: string,
    logger: Logger,
    taskHandler: TaskHandler
  ) {
    this.projectRoot = projectRoot;
    this.logger = logger;
    this.taskHandler = taskHandler;
  }

  async loadTasks(): Promise<void> {
    const tasksDir = getTasksDirPath(this.projectRoot);

    if (!fs.existsSync(tasksDir)) {
      this.logger.info('Tasks directory does not exist, skipping task loading');
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
          this.logger.info(`Loaded task: ${task.name} (${task.id})`);
        }
      } catch (error) {
        this.logger.warn(`Failed to load task file: ${file}`, { error: String(error) });
      }
    }

    this.logger.info(`Loaded ${this.tasks.size} tasks in total`);
  }

  private parseTaskFile(id: string, content: string): TaskDefinition | null {
    // Parse YAML front matter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

    if (!frontmatterMatch) {
      return {
        id,
        name: id,
        cron: '0 9 * * *', // Default: 9 AM daily
        enabled: true,
      };
    }

    try {
      const frontmatter = frontmatterMatch[1];
      const metadata: Record<string, string> = {};
      
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
        source: metadata['source'] === 'telegram' ? 'telegram' : metadata['source'] === 'feishu' ? 'feishu' : undefined,
        chatId: metadata['chatId'] || metadata['chat_id'],
        description: content.replace(/^---\n[\s\S]*?\n---/, '').trim(),
        enabled: metadata['enabled'] !== 'false',
      };
    } catch (error) {
      return null;
    }
  }

  start(): void {
    for (const [id, task] of this.tasks) {
      if (!task.enabled) {
        this.logger.info(`Task ${task.name} is disabled, skipping`);
        continue;
      }

      try {
        const cronJob = cron.schedule(task.cron, async () => {
          await this.executeTask(task);
        });

        this.cronJobs.set(id, cronJob);
        this.logger.info(`Task ${task.name} scheduled (${task.cron})`);
      } catch (error) {
        this.logger.warn(`Failed to schedule task: ${task.name}`, { error: String(error) });
      }
    }

    this.logger.info(`Scheduler started, ${this.cronJobs.size} active tasks`);
  }

  private async executeTask(task: TaskDefinition): Promise<void> {
    const execution: TaskExecution = {
      taskId: task.id,
      startTime: getTimestamp(),
      status: 'running',
    };

    // Record execution
    if (!this.executions.has(task.id)) {
      this.executions.set(task.id, []);
    }
    this.executions.get(task.id)!.push(execution);

    this.logger.action(`Starting task execution: ${task.name}`);

    try {
      await this.taskHandler(task);

      execution.status = 'completed';
      execution.endTime = getTimestamp();

      this.logger.info(`Task execution completed: ${task.name}`);
    } catch (error) {
      execution.status = 'failed';
      execution.endTime = getTimestamp();
      execution.error = String(error);

      this.logger.error(`Task execution failed: ${task.name}`, { error: String(error) });
    }
  }

  async runTaskNow(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }

    await this.executeTask(task);
    return true;
  }

  getTasks(): TaskDefinition[] {
    return Array.from(this.tasks.values());
  }

  getTask(id: string): TaskDefinition | undefined {
    return this.tasks.get(id);
  }

  getTaskExecutions(taskId: string): TaskExecution[] {
    return this.executions.get(taskId) || [];
  }

  getAllExecutions(): Map<string, TaskExecution[]> {
    return this.executions;
  }

  stop(): void {
    for (const [id, cronJob] of this.cronJobs) {
      cronJob.stop();
      this.logger.info(`Task stopped: ${id}`);
    }
    this.cronJobs.clear();
  }
}

export function createTaskScheduler(
  projectRoot: string,
  logger: Logger,
  taskHandler: TaskHandler
): TaskScheduler {
  return new TaskScheduler(projectRoot, logger, taskHandler);
}
