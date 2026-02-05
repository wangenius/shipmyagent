/**
 * Init 命令相关类型定义（集中管理，避免散落各处）。
 */

export interface InitOptions {
  /**
   * 强制覆盖已有初始化文件（Agent.md / ship.json）。
   */
  force?: boolean;
}

/**
 * init 交互中可选的 adapter key。
 *
 * 注意
 * - 这里仅用于 init 生成配置时的选择集合；运行时可支持更多 adapters。
 */
export type AdapterKey = "telegram" | "feishu" | "qq";

