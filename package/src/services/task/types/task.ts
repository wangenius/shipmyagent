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
  /** 执行结果回发目标（contextId） */
  contextId: string;
  /** 启停状态 */
  status: ShipTaskStatus;
  /** 可选时区（IANA，如 Asia/Shanghai） */
  timezone?: string;
  /** 要求在 run 目录存在的产物文件（相对 run 目录） */
  requiredArtifacts?: string[];
  /** 最小输出长度（按字符数；0 表示允许空输出） */
  minOutputChars?: number;
  /** 执行 agent 与模拟用户 agent 的最大对话轮数（>=1） */
  maxDialogueRounds?: number;
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
export type ShipTaskRunExecutionStatusV1 = "success" | "failure" | "skipped";
export type ShipTaskRunResultStatusV1 = "valid" | "invalid" | "not_checked";

export type ShipTaskRunMetaV1 = {
  /** schema 版本 */
  v: 1;
  /** 任务 ID */
  taskId: string;
  /** 本次 run 时间戳（目录名） */
  timestamp: string;
  /** 通知回发目标 */
  contextId: string;
  /** 触发来源 */
  trigger: ShipTaskRunTriggerV1;
  /** 最终状态（综合执行阶段 + 结果校验） */
  status: ShipTaskRunStatusV1;
  /** 执行阶段状态（agent run 是否成功） */
  executionStatus: ShipTaskRunExecutionStatusV1;
  /** 结果校验状态（产物/输出是否满足要求） */
  resultStatus: ShipTaskRunResultStatusV1;
  /** 结果校验错误摘要（可选） */
  resultErrors?: string[];
  /** 实际执行的双边对话轮数 */
  dialogueRounds: number;
  /** 模拟用户在最终轮是否判定“满意” */
  userSimulatorSatisfied: boolean;
  /** 模拟用户的最终回复（可选） */
  userSimulatorReply?: string;
  /** 模拟用户的最终理由（可选） */
  userSimulatorReason?: string;
  /** 模拟用户的最终评分（0-10，可选） */
  userSimulatorScore?: number;
  /** 开始时间（ms） */
  startedAt: number;
  /** 结束时间（ms） */
  endedAt: number;
  /** 失败摘要（可选） */
  error?: string;
};
