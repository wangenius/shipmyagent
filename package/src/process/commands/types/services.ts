/**
 * service 管理命令类型。
 *
 * 关键点（中文）
 * - 统一描述 CLI -> daemon 的 service 管理协议
 * - 支持 lifecycle 控制与通用 command 转发
 */

import type { JsonValue } from "../../../types/json.js";

export type ServiceControlAction = "start" | "stop" | "restart" | "status";

export type ServiceRuntimeView = {
  name: string;
  state: "running" | "stopped" | "starting" | "stopping" | "error";
  updatedAt: number;
  lastError?: string;
  lastCommand?: string;
  lastCommandAt?: number;
  supportsLifecycle: boolean;
  supportsCommand: boolean;
};

export type ServiceListResponse = {
  success: boolean;
  services?: ServiceRuntimeView[];
  error?: string;
};

export type ServiceControlResponse = {
  success: boolean;
  service?: ServiceRuntimeView;
  error?: string;
};

export type ServiceCommandResponse = {
  success: boolean;
  service?: ServiceRuntimeView;
  message?: string;
  data?: JsonValue;
  error?: string;
};

export type ServiceCliBaseOptions = {
  path?: string;
  host?: string;
  port?: number;
  json?: boolean;
};
