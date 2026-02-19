/**
 * Context Messages Meta（随 contextId 持久化的元信息）。
 *
 * 关键点（中文）
 * - 存储位置：`.ship/context/<encodedContextId>/messages/meta.json`
 * - 用于保存 compact 元数据与固定注入的 skills 信息
 */

export type ShipContextMessagesMetaV1 = {
  v: 1;
  contextId: string;
  updatedAt: number;
  pinnedSkillIds: string[];
  lastArchiveId?: string;
  keepLastMessages?: number;
  maxInputTokensApprox?: number;
};
