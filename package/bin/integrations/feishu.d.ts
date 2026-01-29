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
    private sessions;
    private sessionTimeouts;
    private readonly SESSION_TIMEOUT;
    private projectRoot;
    constructor(appId: string, appSecret: string, domain: string | undefined, logger: Logger, taskExecutor: TaskExecutor, projectRoot: string);
    /**
     * 获取或创建会话
     */
    private getOrCreateSession;
    /**
     * 重置会话超时
     */
    private resetSessionTimeout;
    /**
     * 清除会话
     */
    clearSession(chatId: string, chatType: string): void;
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