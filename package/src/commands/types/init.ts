/**
 * init 命令参数与选项类型。
 *
 * 关键点（中文）
 * - 保持命令参数定义集中，避免命令文件内散落重复字面量。
 */

export interface InitOptions {
  force?: boolean;
}

export type AdapterKey = "telegram" | "feishu" | "qq";
