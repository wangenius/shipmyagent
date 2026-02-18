/**
 * Task System domain 类型。
 *
 * 关键点（中文）
 * - task 定义使用 markdown + frontmatter
 * - 每次执行产出 run 目录用于审计
 */

export type ShipTaskStatus = "enabled" | "paused" | "disabled";

export type ShipTaskFrontmatterV1 = {
  /** 任务标题（展示给用户） */
  title: string;
  /** cron 表达式，支持 @manual */
  cron: string;
  /** 任务描述（给执行器的意图说明） */
  description: string;
  /** 执行结果回发目标（chatKey） */
  chatKey: string;
  /** 启停状态 */
  status: ShipTaskStatus;
  /** 可选时区（IANA，如 Asia/Shanghai） */
  timezone?: string;
};

export type ShipTaskDefinitionV1 = {
  /** schema 版本 */
  v: 1;
  /** 稳定任务 ID */
  taskId: string;
  /** task.md frontmatter */
  frontmatter: ShipTaskFrontmatterV1;
  /** 任务正文（可直接作为执行 prompt） */
  body: string;
  /** 相对项目根目录的 task.md 路径 */
  taskMdPath: string;
};

export type ShipTaskRunTriggerV1 =
  | { type: "cron" }
  | { type: "manual"; reason?: string };

export type ShipTaskRunStatusV1 = "success" | "failure" | "skipped";

export type ShipTaskRunMetaV1 = {
  /** schema 版本 */
  v: 1;
  /** 任务 ID */
  taskId: string;
  /** 本次 run 时间戳（目录名） */
  timestamp: string;
  /** 通知回发目标 */
  chatKey: string;
  /** 触发来源 */
  trigger: ShipTaskRunTriggerV1;
  /** 执行状态 */
  status: ShipTaskRunStatusV1;
  /** 开始时间（ms） */
  startedAt: number;
  /** 结束时间（ms） */
  endedAt: number;
  /** 失败摘要（可选） */
  error?: string;
};
