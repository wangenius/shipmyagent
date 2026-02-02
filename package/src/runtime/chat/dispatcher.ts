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

