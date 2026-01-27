import { Logger } from './logger.js';
export interface TaskDefinition {
    id: string;
    name: string;
    cron: string;
    notify?: string;
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
export declare class TaskScheduler {
    private tasks;
    private cronJobs;
    private projectRoot;
    private logger;
    private taskHandler;
    private executions;
    constructor(projectRoot: string, logger: Logger, taskHandler: TaskHandler);
    loadTasks(): Promise<void>;
    private parseTaskFile;
    start(): void;
    private executeTask;
    runTaskNow(taskId: string): Promise<boolean>;
    getTasks(): TaskDefinition[];
    getTask(id: string): TaskDefinition | undefined;
    getTaskExecutions(taskId: string): TaskExecution[];
    getAllExecutions(): Map<string, TaskExecution[]>;
    stop(): void;
}
export declare function createTaskScheduler(projectRoot: string, logger: Logger, taskHandler: TaskHandler): TaskScheduler;
export {};
//# sourceMappingURL=scheduler.d.ts.map