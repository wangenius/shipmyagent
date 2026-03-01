import type { JsonValue } from "../../types/json.js";

/**
 * Daemon API 类型定义。
 *
 * 关键点（中文）
 * - 统一描述 CLI → daemon 的远程调用契约
 * - services 仅依赖协议类型，不依赖 core 运行时实现
 */

/**
 * Daemon 服务端点。
 */
export type DaemonEndpoint = {
  host: string;
  port: number;
  baseUrl: string;
};

/**
 * Daemon HTTP 方法白名单。
 */
export type DaemonHttpMethod = "GET" | "POST" | "PUT" | "DELETE";

/**
 * JSON API 调用参数。
 *
 * 关键点（中文）
 * - `projectRoot` 用于解析 ship.json 与默认 endpoint。
 * - `host/port` 可显式覆盖自动解析结果。
 */
export type DaemonJsonApiCallParams = {
  projectRoot: string;
  path: string;
  method?: DaemonHttpMethod;
  body?: JsonValue;
  host?: string;
  port?: number;
};

/**
 * JSON API 通用返回结构。
 *
 * 语义（中文）
 * - `success=true` 时读取 `data`。
 * - `success=false` 时读取 `error`（可选 `status`）。
 */
export type DaemonJsonApiCallResult<T> = {
  success: boolean;
  status?: number;
  data?: T;
  error?: string;
};
