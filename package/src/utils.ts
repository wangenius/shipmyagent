import dotenv from "dotenv";
import fs from "fs-extra";
import path from "path";
import { nanoid } from "nanoid";
export interface ShipConfig {
  $schema?: string;
  name: string;
  version: string;
  description?: string;
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
  /**
   * 上下文与历史管理（工程向配置）。
   *
   * 说明
   * - ChatStore 负责落盘“用户视角对话历史”（.ship/chat/<chatKey>/conversations/history.jsonl）。
   * - Agent 每次执行时会从 ChatStore 抽取“最近的对话 transcript”，并以“一条 assistant message”注入上下文。
   */
  context?: {
    /**
     * Chat transcript 注入策略（把 ChatStore 历史作为对话式上下文注入）。
     */
    chatHistory?: {
      /**
       * 从 ChatStore（仅 user/assistant）注入的最大消息条数。
       * 默认：30
       */
      transcriptMaxMessages?: number;
      /**
       * 注入内容的最大字符数（超出会截断并提示）。
       * 默认：12000
       */
      transcriptMaxChars?: number;
    };
    /**
     * Chat 消息调度（按 chatKey 分 lane）。
     *
     * 设计目标
     * - 同一 chatKey 串行：避免上下文错乱/工具竞态
     * - 不同 chatKey 可并发：提升整体吞吐
     *
     * 注意
     * - 这是工程运行时行为配置，修改后需重启服务生效。
     */
    chatQueue?: {
      /**
       * 全局最大并发（不同 chatKey 之间）。
       * 默认：2
       */
      maxConcurrency?: number;
      /**
       * 是否启用“快速补充/纠正”：当一次执行尚未结束时，如果该 chatKey 又收到新消息，
       * 会把新消息合并注入当前 in-flight userMessage，帮助模型及时修正。
       * 默认：true
       */
      enableCorrectionMerge?: boolean;
      /**
       * 每次请求最多合并注入多少轮（以 step_finish 为触发点）。
       * 默认：2
       */
      correctionMaxRounds?: number;
      /**
       * 每轮最多合并多少条新消息。
       * 默认：5
       */
      correctionMaxMergedMessages?: number;
      /**
       * 每轮合并注入的最大字符数（超出会截断并提示）。
       * 默认：3000
       */
      correctionMaxChars?: number;
    };
  };
  permissions?: {
    read_repo: boolean | { paths?: string[] };
    write_repo?:
      | boolean
      | {
          paths?: string[];
          requiresApproval: boolean;
        };
    exec_shell?:
      | boolean
      | {
          deny?: string[];
          allow?: string[];
          requiresApproval: boolean;
          denyRequiresApproval?: boolean;
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
  context: {
    chatHistory: {
      transcriptMaxMessages: 30,
      transcriptMaxChars: 12000,
    },
    chatQueue: {
      maxConcurrency: 2,
      enableCorrectionMerge: true,
      correctionMaxRounds: 2,
      correctionMaxMergedMessages: 5,
      correctionMaxChars: 3000,
    },
  },
  permissions: {
    read_repo: true,
    write_repo: {
      requiresApproval: false,
    },
    exec_shell: {
      deny: ["rm"],
      requiresApproval: false,
      denyRequiresApproval: true,
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
  return nanoid(16);
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

export function getShipConfigDirPath(cwd: string): string {
  return path.join(getShipDirPath(cwd), "config");
}

export function getLogsDirPath(cwd: string): string {
  return path.join(getShipDirPath(cwd), "logs");
}

export function getCacheDirPath(cwd: string): string {
  return path.join(getShipDirPath(cwd), ".cache");
}

export function getShipProfileDirPath(cwd: string): string {
  return path.join(getShipDirPath(cwd), "profile");
}

export function getShipProfilePrimaryPath(cwd: string): string {
  return path.join(getShipProfileDirPath(cwd), "Primary.md");
}

export function getShipProfileOtherPath(cwd: string): string {
  return path.join(getShipProfileDirPath(cwd), "other.md");
}

export function getShipDataDirPath(cwd: string): string {
  return path.join(getShipDirPath(cwd), "data");
}

export function getShipChatRootDirPath(cwd: string): string {
  return path.join(getShipDirPath(cwd), "chat");
}

export function getShipChatDirPath(cwd: string, chatKey: string): string {
  return path.join(getShipChatRootDirPath(cwd), encodeURIComponent(chatKey));
}

export function getShipChatConversationsDirPath(cwd: string, chatKey: string): string {
  return path.join(getShipChatDirPath(cwd, chatKey), "conversations");
}

export function getShipChatHistoryPath(cwd: string, chatKey: string): string {
  return path.join(getShipChatConversationsDirPath(cwd, chatKey), "history.jsonl");
}

export function getShipChatArchivePath(cwd: string, chatKey: string, archiveIndex: number): string {
  return path.join(
    getShipChatConversationsDirPath(cwd, chatKey),
    `archive-${archiveIndex}.jsonl`,
  );
}

export function getShipChatMemoryDirPath(cwd: string, chatKey: string): string {
  return path.join(getShipChatDirPath(cwd, chatKey), "memory");
}

export function getShipChatMemoryPrimaryPath(cwd: string, chatKey: string): string {
  return path.join(getShipChatMemoryDirPath(cwd, chatKey), "Primary.md");
}

export function getShipPublicDirPath(cwd: string): string {
  return path.join(getShipDirPath(cwd), "public");
}

export function getShipTasksDirPath(cwd: string): string {
  return path.join(getShipDirPath(cwd), "task");
}

export function getShipDebugDirPath(cwd: string): string {
  return path.join(getShipDirPath(cwd), ".debug");
}

export function getShipMcpConfigPath(cwd: string): string {
  return path.join(getShipConfigDirPath(cwd), "mcp.json");
}

export function getShipMcpSchemaPath(cwd: string): string {
  return path.join(getShipDirPath(cwd), "schema", "mcp.schema.json");
}
