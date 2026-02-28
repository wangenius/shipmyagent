import type { Logger } from "../../../../utils/logger/logger.js";
import type { TelegramUpdate, TelegramUser } from "./shared.js";

/**
 * Telegram command/callback handlers。
 *
 * 关键点（中文）
 * - handler 通过参数接收 logger，不依赖全局 runtime
 * - 方便在不同运行环境复用（server / test）
 */

/**
 * Telegram 指令处理上下文。
 *
 * 说明（中文）
 * - 采用显式注入，避免 handler 反向依赖 server/core 单例
 */
export type TelegramHandlerContext = {
  logger: Logger;
  buildChatKey: (chatId: string, messageThreadId?: number) => string;
  runInChat: (chatKey: string, fn: () => Promise<void>) => Promise<void>;
  sendMessage: (
    chatId: string,
    text: string,
    opts?: { messageThreadId?: number },
  ) => Promise<void>;
  clearChat: (chatKey: string) => void;
};

/**
 * 处理 Telegram 斜杠命令。
 *
 * 说明（中文）
 * - 当前只处理少量内置命令，其他消息走常规会话链路
 */
export async function handleTelegramCommand(
  ctx: TelegramHandlerContext,
  params: {
    chatId: string;
    command: string;
    from?: TelegramUser;
    messageThreadId?: number;
  },
): Promise<void> {
  const username = params.from?.username || "Unknown";
  ctx.logger.info(`Received command: ${params.command} (${username})`);

  const [commandToken] = params.command.trim().split(/\s+/);
  const cmd = (commandToken || "").split("@")[0]?.toLowerCase();
  const chatKey = ctx.buildChatKey(params.chatId, params.messageThreadId);

  switch (cmd) {
    case "/start":
    case "/help":
      await ctx.sendMessage(
        params.chatId,
        `🤖 ShipMyAgent Bot

Available commands:
- /status - View agent status
- /clear - Clear conversation history
- <any message> - Execute instruction`,
      );
      break;

    case "/status":
      await ctx.sendMessage(params.chatId, "📊 Agent status: Running");
      break;

    case "/clear":
      ctx.clearChat(chatKey);
      await ctx.sendMessage(params.chatId, "✅ Conversation history cleared", {
        messageThreadId: params.messageThreadId,
      });
      break;

    default:
      await ctx.sendMessage(params.chatId, `Unknown command: ${params.command}`);
  }
}

/**
 * 处理 callback_query（按钮回调）。
 *
 * 当前策略（中文）
 * - 预留扩展点；默认不执行任何业务逻辑
 */
export async function handleTelegramCallbackQuery(
  ctx: TelegramHandlerContext,
  callbackQuery: TelegramUpdate["callback_query"],
): Promise<void> {
  void ctx;
  void callbackQuery;
}
