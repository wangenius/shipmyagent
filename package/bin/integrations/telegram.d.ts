import { Logger } from '../runtime/logger.js';
import { TaskExecutor } from '../runtime/task-executor.js';
interface TelegramConfig {
    botToken: string;
    chatId?: string;
    enabled: boolean;
}
export declare class TelegramBot {
    private botToken;
    private chatId?;
    private logger;
    private taskExecutor;
    private lastUpdateId;
    private pollingInterval;
    private isRunning;
    private sessions;
    private sessionTimeouts;
    private readonly SESSION_TIMEOUT;
    private projectRoot;
    private readonly MAX_CONCURRENT;
    private currentConcurrent;
    constructor(botToken: string, chatId: string | undefined, logger: Logger, taskExecutor: TaskExecutor, projectRoot: string);
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
    clearSession(userId: number): void;
    start(): Promise<void>;
    private pollUpdates;
    /**
     * 带并发限制的消息处理
     */
    private processUpdateWithLimit;
    private handleMessage;
    private handleCommand;
    private handleCallbackQuery;
    private executeAndReply;
    sendMessage(chatId: string, text: string): Promise<void>;
    sendMessageWithInlineKeyboard(chatId: string, text: string, buttons: Array<{
        text: string;
        callback_data: string;
    }>): Promise<void>;
    private sendRequest;
    stop(): Promise<void>;
}
export declare function createTelegramBot(projectRoot: string, config: TelegramConfig, logger: Logger): TelegramBot | null;
export {};
//# sourceMappingURL=telegram.d.ts.map