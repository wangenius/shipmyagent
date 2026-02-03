import { createHash } from "crypto";
import dotenv from "dotenv";
import fs from "fs-extra";
import path from "path";

export interface ShipConfig {
  $schema?: string;
  name: string;
  version: string;
  description?: string;
  /**
   * Object storage configuration (S3-compatible, e.g. Cloudflare R2).
   * When configured, the runtime will expose the built-in `s3_upload` tool.
   */
  oss?: {
    /**
     * Enable/disable object storage tools.
     * Default: true when `oss` block is present and complete.
     */
    enabled?: boolean;
    /**
     * Provider type (currently only S3-compatible is supported).
     */
    provider?: "s3";
    /**
     * S3 endpoint (e.g. https://<account-id>.r2.cloudflarestorage.com).
     */
    endpoint?: string;
    /**
     * Access key id.
     */
    accessKeyId?: string;
    /**
     * Secret access key.
     */
    secretAccessKey?: string;
    /**
     * SigV4 region (R2 typically uses "auto").
     */
    region?: string;
    /**
     * Default bucket name for uploading files.
     * Used by higher-level cloud file tools (e.g. `cloud_file_upload`).
     */
    bucket?: string;
  };
  /**
   * Cloud file serving configuration.
   * Used by higher-level cloud file tools to generate public URLs for `/public/*`.
   */
  cloudFiles?: {
    /**
     * Public base URL of your deployed ShipMyAgent server, e.g. https://agent.example.com
     * (No trailing slash recommended).
     */
    publicBaseUrl?: string;
    /**
     * Route prefix for serving `.ship/public/*`. Default: "/public".
     */
    publicRoutePrefix?: string;
  };
  /**
   * Runtime startup configuration used by `shipmyagent start` / `shipmyagent .`.
   * CLI flags (if provided) take precedence over this config.
   */
  start?: {
    port?: number;
    host?: string;
    interactiveWeb?: boolean;
    interactivePort?: number;
  };
  /**
   * Optional Claude Code-compatible skills configuration.
   * By default we look for project skills under `.claude/skills/`.
   */
  skills?: {
    /**
     * Extra skill root directories to scan. Relative paths are resolved from project root.
     * Example: [".claude/skills", ".my/skills"]
     */
    paths?: string[];
    /**
     * Allow scanning skill paths outside the project root (absolute paths or `~`).
     * Default: false.
     */
    allowExternalPaths?: boolean;
  };
  // LLM 配置
  llm: {
    provider: string;
    model: string;
    baseUrl: string;
    apiKey?: string;
    // Debug: log every request payload sent to the LLM
    logMessages?: boolean;
    // 模型参数
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    // 特定模型配置
    anthropicVersion?: string;
  };
  permissions: {
    read_repo: boolean | { paths?: string[] };
    write_repo?: {
      paths?: string[];
      requiresApproval: boolean;
    };
    exec_shell?: {
      deny?: string[];
      allow?: string[];
      requiresApproval: boolean;
    };
    open_pr?: boolean;
    merge?: boolean;
  };
  adapters?: {
    telegram?: {
      enabled: boolean;
      botToken?: string;
      chatId?: string;
      /**
       * Group follow-up window in milliseconds.
       * When a user has just talked to the bot (mention/reply/command), allow
       * non-mention follow-up messages within this time window.
       * Default: 10 minutes.
       */
      followupWindowMs?: number;
      /**
       * Who can interact with the bot in group chats.
       * - "initiator_or_admin" (default): only the first person who talked to the bot in that chat/topic,
       *   or group admins, can use it.
       * - "anyone": any group member can talk to the bot (when addressed).
       */
      groupAccess?: "initiator_or_admin" | "anyone";
    };
    discord?: {
      enabled: boolean;
      botToken?: string;
    };
    feishu?: {
      enabled: boolean;
      appId?: string;
      appSecret?: string;
      domain?: string;
    };
    qq?: {
      enabled: boolean;
      appId?: string; // 机器人ID
      appSecret?: string; // 密钥
      sandbox?: boolean; // 是否使用沙箱环境
    };
  };
}

// 模型配置模板
export const MODEL_CONFIGS = {
  // Claude 系列
  "claude-sonnet-4-5": {
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
  },
  "claude-haiku": {
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
  },
  "claude-3-5-sonnet-20241022": {
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
  },
  "claude-3-opus-20240229": {
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
  },
  // OpenAI GPT 系列
  "gpt-4": {
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
  },
  "gpt-4-turbo": {
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
  },
  "gpt-4o": {
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
  },
  "gpt-3.5-turbo": {
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
  },
  // DeepSeek
  "deepseek-chat": {
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
  },
  // 自定义模型
  custom: {
    provider: "custom",
    baseUrl: "",
  },
};

export const DEFAULT_SHIP_JSON: ShipConfig = {
  $schema: "./.ship/schema/ship.schema.json",
  name: "shipmyagent",
  version: "1.0.0",
  start: {
    port: 3000,
    host: "0.0.0.0",
    interactiveWeb: false,
    interactivePort: 3001,
  },
  llm: {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: "${API_KEY}",
    temperature: 0.7,
  },
  permissions: {
    read_repo: true,
    write_repo: {
      paths: ["src/**", "**/*.md"],
      requiresApproval: true,
    },
    exec_shell: {
      deny: ["rm"],
      requiresApproval: false,
    },
  },
  adapters: {
    telegram: {
      enabled: false,
      botToken: undefined,
      chatId: undefined,
    },
  },
};

export function loadProjectDotenv(projectRoot: string): void {
  // Only load the project's .env (do not search upwards)
  dotenv.config({ path: path.join(projectRoot, ".env") });
}

function resolveEnvPlaceholdersDeep(value: unknown): unknown {
  if (typeof value === "string") {
    const match = value.match(/^\$\{([A-Z0-9_]+)\}$/);
    if (!match) return value;
    const envVar = match[1];
    return process.env[envVar];
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveEnvPlaceholdersDeep(item));
  }

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = resolveEnvPlaceholdersDeep(v);
    }
    return out;
  }

  return value;
}

export function loadShipConfig(projectRoot: string): ShipConfig {
  loadProjectDotenv(projectRoot);

  const shipJsonPath = getShipJsonPath(projectRoot);
  const raw = fs.readJsonSync(shipJsonPath) as unknown;
  return resolveEnvPlaceholdersDeep(raw) as ShipConfig;
}

export function generateId(): string {
  return createHash("md5")
    .update(Date.now().toString())
    .digest("hex")
    .slice(0, 8);
}

export function getProjectRoot(cwd: string): string {
  return path.resolve(cwd);
}

export async function ensureDir(dir: string): Promise<void> {
  if (!fs.existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true });
  }
}

export async function saveJson(filePath: string, data: unknown): Promise<void> {
  await fs.writeJson(filePath, data, { spaces: 2 });
}

export async function loadJson<T>(filePath: string): Promise<T | null> {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readJson(filePath) as Promise<T>;
}

export function getTimestamp(): string {
  return new Date().toISOString();
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function getAgentMdPath(cwd: string): string {
  return path.join(cwd, "Agent.md");
}

export function getShipJsonPath(cwd: string): string {
  return path.join(cwd, "ship.json");
}

export function getShipDirPath(cwd: string): string {
  return path.join(cwd, ".ship");
}

export function getShipSchemaPath(cwd: string): string {
  return path.join(getShipDirPath(cwd), "schema", "ship.schema.json");
}

export function getTasksDirPath(cwd: string): string {
  return path.join(cwd, ".ship", "tasks");
}

export function getRunsDirPath(cwd: string): string {
  return path.join(cwd, ".ship", "runs");
}

export function getQueueDirPath(cwd: string): string {
  return path.join(cwd, ".ship", "queue");
}

export function getRoutesDirPath(cwd: string): string {
  return path.join(cwd, ".ship", "routes");
}

export function getApprovalsDirPath(cwd: string): string {
  return path.join(cwd, ".ship", "approvals");
}

export function getLogsDirPath(cwd: string): string {
  return path.join(cwd, ".ship", "logs");
}

export function getCacheDirPath(cwd: string): string {
  return path.join(cwd, ".ship", ".cache");
}

export function getChatsDirPath(cwd: string): string {
  return path.join(cwd, ".ship", "chats");
}

export function getMcpDirPath(cwd: string): string {
  return path.join(cwd, ".ship", "mcp");
}
