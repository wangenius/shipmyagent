/**
 * Session Messages Meta（随 sessionId 持久化的元信息）。
 *
 * 关键点（中文）
 * - 存储位置：`.ship/session/<encodedSessionId>/messages/meta.json`
 * - 用于保存 compact 元数据与固定注入的 skills 信息
 */

export type ShipSessionMessagesMetaV1 = {
  v: 1;
  sessionId: string;
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
