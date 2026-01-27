import { Hono } from 'hono';
import { Logger } from '../runtime/logger.js';
import { PermissionEngine } from '../runtime/permission.js';
import { TaskScheduler } from '../runtime/scheduler.js';
import { TaskExecutor } from '../runtime/task-executor.js';
import { ToolExecutor } from '../runtime/tools.js';
export interface ServerContext {
    projectRoot: string;
    logger: Logger;
    permissionEngine: PermissionEngine;
    taskScheduler: TaskScheduler;
    taskExecutor: TaskExecutor;
    toolExecutor: ToolExecutor;
}
export interface StartOptions {
    port: number;
    host: string;
}
export declare class AgentServer {
    private app;
    private context;
    private server;
    constructor(context: ServerContext);
    private setupRoutes;
    start(options: StartOptions): Promise<void>;
    stop(): Promise<void>;
    getApp(): Hono;
}
export declare function createServer(context: ServerContext): AgentServer;
//# sourceMappingURL=index.d.ts.map