/**
 * Chat 命令协议类型。
 *
 * 关键点（中文）
 * - chat 模块自有请求/响应类型放在 chat/types
 * - 避免所有业务类型集中堆到全局 types/
 */

export type ChatContextSnapshot = {
  chatKey?: string;
  channel?: string;
  chatId?: string;
  messageThreadId?: number;
  chatType?: string;
  userId?: string;
  messageId?: string;
  requestId?: string;
};

export type ChatSendRequest = {
  text: string;
  chatKey?: string;
};

export type ChatSendResponse = {
  success: boolean;
  chatKey?: string;
  error?: string;
};
