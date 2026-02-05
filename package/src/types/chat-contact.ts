/**
 * 联系人簿（ContactBook）里存储的联系人结构。
 *
 * 设计目标：
 * - 为工具（如 `chat_contact_lookup` / `chat_contact_send`）提供“脱离当前上下文”的收件人映射。
 * - 允许用户为联系人补充人类可读的昵称（`nickname`），用于检索与展示。
 *
 * 注意：
 * - `username` 是“平台侧可见”的标识（可能为空/变化/冲突），因此仅做 best-effort 匹配。
 * - `nickname` 是用户自定义字段，不参与平台投递，但可用于搜索/显示。
 */

export type ContactChannel = "telegram" | "feishu" | "qq";

export type ChatContact = {
  channel: ContactChannel;
  /**
   * 平台 chat id（群 id / 私聊 id / 频道 id）。
   */
  chatId: string;
  /**
   * 运行时 chatKey，用于隔离会话历史。
   */
  chatKey: string;
  /**
   * 最新收到的消息 id（best-effort）。
   *
   * 关键点：部分平台（如 QQ）被动回复需要携带 `messageId`，因此落盘保存以便工具调用。
   */
  messageId?: string;
  /**
   * 平台用户 id（best-effort，群聊场景更有用）。
   */
  userId?: string;
  /**
   * 平台侧的用户名 / handle（用于查找）。
   */
  username: string;
  /**
   * 用户自定义昵称（用于查找与展示）。
   */
  nickname?: string;
  chatType?: string;
  messageThreadId?: number;
  updatedAt: number;
};

