/**
 * infra/utils 统一导出入口。
 *
 * 职责说明：
 * 1. 聚合配置、路径、存储、时间与 ID 工具。
 * 2. 对外暴露稳定导入路径，避免业务模块感知内部拆分细节。
 */
export * from "./config.js";
export * from "./id.js";
export * from "./paths.js";
export * from "./storage.js";
export * from "./time.js";
