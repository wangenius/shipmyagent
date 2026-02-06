/**
 * Chat egress dispatcher registry（按 channel 路由回包能力）。
 *
 * 关键点（中文）
 * - tool（如 `chat_send`）通过 dispatcher 把消息发回对应平台
 * - dispatcher 本身不关心 chatKey/history，只关心“怎么把一段 text 发出去”
 */
export type ChatDispatchChannel = "telegram" | "feishu" | "qq";

export interface ChatDispatcher {
  sendText(params: {
    chatId: string;
    text: string;
    messageThreadId?: number;
    chatType?: string;
    messageId?: string;
  }): Promise<{ success: boolean; error?: string }>;
}

const dispatchers = new Map<ChatDispatchChannel, ChatDispatcher>();

export function registerChatDispatcher(
  channel: ChatDispatchChannel,
  dispatcher: ChatDispatcher,
): void {
  dispatchers.set(channel, dispatcher);
}

export function getChatDispatcher(channel: ChatDispatchChannel): ChatDispatcher | undefined {
  return dispatchers.get(channel);
}
