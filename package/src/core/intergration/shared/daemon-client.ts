/**
 * Daemon API client helpers.
 *
 * 关键点（中文）
 * - CLI 子命令优先通过本地 Agent Server API 执行业务动作
 * - 地址解析优先级：CLI 覆盖参数 > 环境变量 > ship.json.start > 默认值
 * - 这里不强依赖 daemon pid 文件，前台 `sma run` 场景同样可访问 HTTP API
 */

import fs from "fs-extra";
import { getShipJsonPath, loadShipConfig } from "../../../utils.js";

export type DaemonEndpoint = {
  host: string;
  port: number;
  baseUrl: string;
};

function parsePortLike(input: unknown): number | undefined {
  if (input === undefined || input === null || input === "") return undefined;
  const raw = typeof input === "number" ? input : Number.parseInt(String(input), 10);
  if (!Number.isFinite(raw) || Number.isNaN(raw)) return undefined;
  if (!Number.isInteger(raw) || raw <= 0 || raw > 65535) return undefined;
  return raw;
}

function normalizeHost(input: unknown): string | undefined {
  const host = typeof input === "string" ? input.trim() : "";
  if (!host) return undefined;
  if (host === "0.0.0.0" || host === "::") return "127.0.0.1";
  return host;
}

export function resolveDaemonEndpoint(params: {
  projectRoot: string;
  host?: string;
  port?: number;
}): DaemonEndpoint {
  const explicitHost = normalizeHost(params.host);
  const explicitPort = parsePortLike(params.port);

  const envHost =
    normalizeHost(process.env.SMA_SERVER_HOST) ||
    normalizeHost(process.env.SMA_CTX_SERVER_HOST);
  const envPort =
    parsePortLike(process.env.SMA_SERVER_PORT) ||
    parsePortLike(process.env.SMA_CTX_SERVER_PORT);

  let configHost: string | undefined;
  let configPort: number | undefined;
  try {
    const shipJsonPath = getShipJsonPath(params.projectRoot);
    if (fs.existsSync(shipJsonPath)) {
      const cfg = loadShipConfig(params.projectRoot);
      configHost = normalizeHost(cfg.start?.host);
      configPort = parsePortLike(cfg.start?.port);
    }
  } catch {
    // ignore config errors, fallback to defaults
  }

  const host = explicitHost || envHost || configHost || "127.0.0.1";
  const port = explicitPort || envPort || configPort || 3000;

  return {
    host,
    port,
    baseUrl: `http://${host}:${port}`,
  };
}

export async function callDaemonJsonApi<T>(params: {
  projectRoot: string;
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  host?: string;
  port?: number;
}): Promise<{ success: boolean; status?: number; data?: T; error?: string }> {
  const endpoint = resolveDaemonEndpoint({
    projectRoot: params.projectRoot,
    host: params.host,
    port: params.port,
  });

  const url = new URL(params.path, endpoint.baseUrl).toString();
  const method = params.method || "GET";
  const hasBody = params.body !== undefined && method !== "GET";

  try {
    const response = await fetch(url, {
      method,
      headers: hasBody ? { "Content-Type": "application/json" } : undefined,
      body: hasBody ? JSON.stringify(params.body) : undefined,
    });

    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      const messageFromData =
        data && typeof data === "object" && typeof (data as any).error === "string"
          ? String((data as any).error)
          : data && typeof data === "object" && typeof (data as any).message === "string"
            ? String((data as any).message)
            : `HTTP ${response.status}`;
      return {
        success: false,
        status: response.status,
        error: messageFromData,
      };
    }

    return {
      success: true,
      status: response.status,
      data: data as T,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to call ${url}: ${String(error)}`,
    };
  }
}
