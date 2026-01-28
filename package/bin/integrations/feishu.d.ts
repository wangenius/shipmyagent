import { Logger } from '../runtime/logger.js';
import { TaskExecutor } from '../runtime/task-executor.js';
interface FeishuConfig {
    appId: string;
    appSecret: string;
    enabled: boolean;
    domain?: string;
}
export declare class FeishuBot {
    private appId;
    private appSecret;
    private domain?;
    private logger;
    private taskExecutor;
    private client;
    private wsClient;
    private isRunning;
    private processedMessages;
    private messageCleanupInterval;
    constructor(appId: string, appSecret: string, domain: string | undefined, logger: Logger, taskExecutor: TaskExecutor);
    start(): Promise<void>;
    private handleMessage;
    private handleCommand;
    private executeAndReply;
    private sendMessage;
    private sendErrorMessage;
    stop(): Promise<void>;
}
export declare function createFeishuBot(projectRoot: string, config: FeishuConfig, logger: Logger): Promise<FeishuBot | null>;
export {};
//# sourceMappingURL=feishu.d.ts.map