/**
 * Chat egress dispatcher registry（按 channel 路由回包能力）。
 *
 * 关键点（中文）
 * - tool（如 `chat_send`）通过 dispatcher 把消息发回对应平台
 * - dispatcher 本身不关心 chatKey/history，只关心“怎么把一段 text 发出去”
 */
export type {
  ChatDispatchChannel,
  ChatDispatcher,
} from "../../../types/chat-dispatcher.js";

import type {
  ChatDispatchChannel,
  ChatDispatcher,
} from "../../../types/chat-dispatcher.js";

const dispatchers = new Map<ChatDispatchChannel, ChatDispatcher>();

export function registerChatSender(
  channel: ChatDispatchChannel,
  dispatcher: ChatDispatcher,
): void {
  dispatchers.set(channel, dispatcher);
}

export function getChatSender(channel: ChatDispatchChannel): ChatDispatcher | undefined {
  return dispatchers.get(channel);
}
