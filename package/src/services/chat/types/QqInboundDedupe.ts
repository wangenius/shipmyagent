/**
 * QQ 入站去重快照类型。
 *
 * 关键点（中文）
 * - 持久化到本地 JSON 文件，用于重启后去重。
 */
export interface QqInboundDedupeSnapshotV1 {
  v: 1;
  updatedAt: number;
  ids: string[];
}

