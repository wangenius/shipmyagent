/**
 * Chat Messages Meta（随 chatKey 持久化的元信息）。
 *
 * 关键点（中文）
 * - 存储位置：`.ship/chat/<encodedChatKey>/messages/meta.json`
 * - 该文件用于保存 “history compact 元数据” 与 “当前 chat 固定注入的 skills”等信息
 * - 这是工程内部状态：不面向最终用户直接编辑
 */

export type ShipChatMessagesMetaV1 = {
  v: 1;
  chatKey: string;
  updatedAt: number;

  /**
   * 已 pin 的 skill ids（每次 run 自动注入）。
   */
  pinnedSkillIds: string[];

  /**
   * compact 元数据（可选，便于排查）
   */
  lastArchiveId?: string;
  keepLastMessages?: number;
  maxInputTokensApprox?: number;
};

