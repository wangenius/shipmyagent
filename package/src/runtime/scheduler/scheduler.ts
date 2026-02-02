import fs from "fs-extra";
import path from "path";
import cron from "node-cron";
import { getTasksDirPath, getTimestamp } from "../../utils.js";
import type { Logger } from "../logging/index.js";
import { parseTaskFile } from "./task-file.js";
import type { TaskDefinition, TaskExecution, TaskHandler } from "./types.js";

export class TaskScheduler {
  private tasks: Map<string, TaskDefinition> = new Map();
  private cronJobs: Map<string, cron.ScheduledTask> = new Map();
  private projectRoot: string;
  private logger: Logger;
  private taskHandler: TaskHandler;
  private executions: Map<string, TaskExecution[]> = new Map();

  constructor(projectRoot: string, logger: Logger, taskHandler: TaskHandler) {
    this.projectRoot = projectRoot;
    this.logger = logger;
    this.taskHandler = taskHandler;
  }

  async loadTasks(): Promise<void> {
    const tasksDir = getTasksDirPath(this.projectRoot);
    if (!fs.existsSync(tasksDir)) {
      this.logger.info("Tasks directory does not exist, skipping task loading");
      return;
    }

    const files = await fs.readdir(tasksDir);
    const taskFiles = files.filter((f) => f.endsWith(".md"));

    for (const file of taskFiles) {
      try {
        const content = await fs.readFile(path.join(tasksDir, file), "utf-8");
        const task = parseTaskFile(file.replace(".md", ""), content);
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

  async runTaskNow(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;
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

  private async executeTask(task: TaskDefinition): Promise<void> {
    const execution: TaskExecution = {
      taskId: task.id,
      startTime: getTimestamp(),
      status: "running",
    };

    if (!this.executions.has(task.id)) this.executions.set(task.id, []);
    this.executions.get(task.id)!.push(execution);

    this.logger.action(`Starting task execution: ${task.name}`);

    try {
      await this.taskHandler(task);

      execution.status = "completed";
      execution.endTime = getTimestamp();
      this.logger.info(`Task execution completed: ${task.name}`);
    } catch (error) {
      execution.status = "failed";
      execution.endTime = getTimestamp();
      execution.error = String(error);
      this.logger.error(`Task execution failed: ${task.name}`, { error: String(error) });
    }
  }
}

export function createTaskScheduler(
  projectRoot: string,
  logger: Logger,
  taskHandler: TaskHandler,
): TaskScheduler {
  return new TaskScheduler(projectRoot, logger, taskHandler);
}
