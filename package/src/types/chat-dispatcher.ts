/**
 * Chat egress dispatcher types（对外回包能力的类型定义）。
 *
 * 关键点（中文）
 * - dispatcher 只关心“怎么把消息/动作发回平台”，不关心 chatKey/history/Agent
 * - sendText 是必需能力；sendAction（如 typing）是可选能力，平台不支持即可不实现
 */

export type ChatDispatchChannel = "telegram" | "feishu" | "qq";

/**
 * 对外可见的“平台动作”类型。
 *
 * 说明（中文）
 * - 当前仅需要 typing（用于 Telegram 的 sendChatAction）
 * - 后续如需扩展（upload_photo/record_voice 等），统一在这里追加
 */
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

  /**
   * 发送“平台动作”（可选）。
   *
   * 例如 Telegram 的 typing 指示器：在任务执行期间周期性调用，让用户感知 bot 正在处理。
   */
  sendAction?(params: ChatDispatchSendActionParams): Promise<{
    success: boolean;
    error?: string;
  }>;
}

