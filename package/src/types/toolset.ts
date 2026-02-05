import type { ShipConfig } from "../utils.js";

/**
 * ToolSet 定义（可被运行时按需加载）。
 *
 * 设计目标：
 * - 把一组 tools 打包成可发现/可一次性加载的“工具集”。
 * - 每个 ToolSet 自带一段默认说明（`description`），在加载时以 system prompt 的方式注入，
 *   让模型立刻知道：这组工具的使用规范与边界。
 *
 * 注意：
 * - ToolSet 是“运行时概念”，不是技能（Skill）的磁盘结构；它更像运行时内置/可选模块。
 * - Tool 的类型在 AI SDK 中比较复杂，这里统一用 `Record<string, any>` 承载。
 */

export type ToolSetTools = Record<string, any>;

export type ToolSetBuildContext = {
  projectRoot: string;
  config: ShipConfig;
};

export type ToolSetDefinition = {
  /**
   * 稳定 id，用于 `toolset_load` 查找与持久化标识。
   */
  id: string;
  /**
   * 展示名称（可用于 list）。
   */
  name: string;
  /**
   * 默认说明：用于作为 system prompt 注入（加载时/后续 run 可复用）。
   */
  description: string;
  /**
   * 构造该 ToolSet 的 tools（允许根据运行时 config/projectRoot 初始化）。
   */
  build(ctx: ToolSetBuildContext): ToolSetTools;
};

