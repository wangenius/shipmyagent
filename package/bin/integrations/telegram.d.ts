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
    constructor(botToken: string, chatId: string | undefined, logger: Logger, taskExecutor: TaskExecutor);
    start(): Promise<void>;
    private pollUpdates;
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