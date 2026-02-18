/**
 * Chat egress dispatcher types（对外回包能力的类型定义）。
 *
 * 关键点（中文）
 * - dispatcher 只关心“怎么把消息/动作发回平台”
 * - sendText 是必需能力；sendAction（如 typing）是可选能力
 */

export type ChatDispatchChannel = "telegram" | "feishu" | "qq";

export type ChatDispatchAction = "typing";

export type ChatDispatchSendTextParams = {
  chatId: string;
  text: string;
  messageThreadId?: number;
  chatType?: string;
  messageId?: string;
};

export type ChatDispatchSendActionParams = {
  chatId: string;
  action: ChatDispatchAction;
  messageThreadId?: number;
  chatType?: string;
  messageId?: string;
};

export interface ChatDispatcher {
  sendText(params: ChatDispatchSendTextParams): Promise<{
    success: boolean;
    error?: string;
  }>;

  sendAction?(params: ChatDispatchSendActionParams): Promise<{
    success: boolean;
    error?: string;
  }>;
}
