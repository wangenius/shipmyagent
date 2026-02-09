/**
 * Task System types.
 *
 * 设计目标（中文）
 * - Task 用 markdown + YAML frontmatter 定义（task.md）
 * - 每次执行产生一个 run 目录（timestamp），并落盘 history.jsonl / output.md / result.md 等审计文件
 *
 * 注意
 * - 这里仅放“类型与枚举”，不放实现逻辑（实现位于 core/task-system/*）
 */

export type ShipTaskStatus = "enabled" | "paused" | "disabled";

export type ShipTaskFrontmatterV1 = {
  /**
   * 任务标题（必须）
   */
  title: string;
  /**
   * cron 表达式（必须）
   * - node-cron 兼容的 5 字段表达式，例如 "0 9 * * 1-5"
   * - 特殊值：@manual 表示仅手动触发，不参与 scheduler
   */
  cron: string;
  /**
   * 任务描述（必须）
   */
  description: string;
  /**
   * 执行结束后通知的 chatKey（必须）
   */
  chatKey: string;
  /**
   * enabled/paused/disabled（必须）
   */
  status: ShipTaskStatus;

  /**
   * 可选：时区（node-cron 支持 IANA TZ，如 "Asia/Shanghai"）
   */
  timezone?: string;
};

export type ShipTaskDefinitionV1 = {
  v: 1;
  taskId: string;
  frontmatter: ShipTaskFrontmatterV1;
  body: string;
  /**
   * 相对 project root 的路径（用于展示/审计）
   */
  taskMdPath: string;
};

export type ShipTaskRunTriggerV1 =
  | { type: "cron" }
  | { type: "manual"; reason?: string };

export type ShipTaskRunStatusV1 = "success" | "failure" | "skipped";

export type ShipTaskRunMetaV1 = {
  v: 1;
  taskId: string;
  timestamp: string;
  chatKey: string;
  trigger: ShipTaskRunTriggerV1;
  status: ShipTaskRunStatusV1;
  startedAt: number;
  endedAt: number;
  /**
   * 失败时的简要错误信息（避免写入超长堆栈到 meta）
   */
  error?: string;
};

