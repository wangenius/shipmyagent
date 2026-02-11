/**
 * Daemon API 类型定义。
 *
 * 关键点（中文）
 * - 统一描述 CLI → daemon 的远程调用契约
 * - integrations 仅依赖协议类型，不依赖 core 运行时实现
 */

export type DaemonEndpoint = {
  host: string;
  port: number;
  baseUrl: string;
};

export type DaemonHttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export type DaemonJsonApiCallParams = {
  projectRoot: string;
  path: string;
  method?: DaemonHttpMethod;
  body?: unknown;
  host?: string;
  port?: number;
};

export type DaemonJsonApiCallResult<T> = {
  success: boolean;
  status?: number;
  data?: T;
  error?: string;
};

