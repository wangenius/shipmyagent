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
   * 默认会扫描：
   * - 项目内：`.ship/skills/`
   * - 用户目录：`~/.ship/skills/`
   */
  skills?: {
    /**
     * Extra skill root directories to scan. Relative paths are resolved from project root.
     * Example: [".ship/skills", ".my/skills"]
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
   * - 历史以 UIMessage[] 为唯一事实源（.ship/context/<contextId>/messages/history.jsonl）。
   * - Agent 每次执行直接把 UIMessage[] 转成 ModelMessage[] 作为 messages 输入。
   * - 超出上下文窗口时会自动 compact（更早段压缩为摘要 + 保留最近窗口）。
   */
  context?: {
    /**
     * History（唯一历史来源）的 compact 策略。
     */
    history?: {
      /**
       * compact 后保留最近多少条消息（user/assistant 都计入）。
       * 默认：30
       */
      keepLastMessages?: number;
      /**
       * 输入预算（近似 token 数）。
       *
       * 说明（中文）
       * - 这里是近似值，用于在调用 provider 前提前触发 compact
       * - 实际超窗仍会被 provider 拒绝并进入 retry（更激进 compact）
       *
       * 默认：12000
       */
      maxInputTokensApprox?: number;
      /**
       * compact 时是否归档被折叠的原始消息段（写入 messages/archive/）。
       * 默认：true
       */
      archiveOnCompact?: boolean;
    };
    /**
     * Chat 消息调度（按 contextId 分 lane）。
     *
     * 设计目标
     * - 同一 contextId 串行：避免上下文错乱/工具竞态
     * - 不同 contextId 可并发：提升整体吞吐
     *
     * 注意
     * - 这是工程运行时行为配置，修改后需重启服务生效。
     */
    contextQueue?: {
      /**
       * 全局最大并发（不同 contextId 之间）。
       * 默认：2
       */
      maxConcurrency?: number;
      /**
       * 是否启用“快速补充/纠正”：当一次执行尚未结束时，如果该 contextId 又收到新消息，
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
    };

    /**
     * 记忆管理配置。
     *
     * 设计目标
     * - 自动提取对话摘要到 memory/Primary.md
     * - 智能压缩避免记忆文件过长
     * - 异步处理不阻塞主对话流程
     */
    memory?: {
      /**
       * 是否启用自动记忆提取。
       * 默认：true
       */
      autoExtractEnabled?: boolean;
      /**
       * 触发记忆提取的最小未记忆化记录数。
       * 默认：40
       */
      extractMinEntries?: number;
      /**
       * memory/Primary.md 的最大字符数，超过时触发压缩。
       * 默认：15000
       */
      maxPrimaryChars?: number;
      /**
       * 超过阈值时是否自动压缩（使用 LLM）。
       * 默认：true
       */
      compressOnOverflow?: boolean;
      /**
       * 压缩前是否备份到 memory/backup/。
       * 默认：true
       */
      backupBeforeCompress?: boolean;
    };

    /**
     * Chat 出站（egress）控制：用于限制工具发送、避免重复与无限循环刷屏。
     *
     * 设计动机（中文）
     * - 模型在 tool-loop 中可能重复调用 `chat_send`（甚至参数完全相同）。
     * - 这里提供“允许多次发送，但有上限 + 幂等去重”的机制，避免在某些异常提示/对齐失败时刷屏。
     */
    chatEgress?: {
      /**
       * 单次 agent run 内，`chat_send` 允许调用的最大次数。
       *
       * 建议
       * - 默认 30：允许较长的分段输出，但仍可避免进入无限循环刷屏。
       */
      chatSendMaxCallsPerRun?: number;

      /**
       * 是否启用 `chat_send` 幂等去重（基于 inbound messageId + 回复内容 hash）。
       * 默认：true
       */
      chatSendIdempotency?: boolean;
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
    exec_command?:
      | boolean
      | {
          deny?: string[];
          allow?: string[];
          requiresApproval: boolean;
          denyRequiresApproval?: boolean;
          /**
           * `exec_command` / `write_stdin` 返回给模型的输出最大字符数。
           *
           * 说明（中文）
           * - 工具结果会进入下一轮 LLM messages。
           * - 过大时可能触发 provider 参数校验失败。
           * 默认值：12000。
           */
          maxOutputChars?: number;
          /**
           * `exec_command` / `write_stdin` 返回给模型的输出最大行数。
           * 默认值：200。
           */
          maxOutputLines?: number;
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
      groupAccess?: "initiator_or_admin" | "anyone";
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
    history: {
      keepLastMessages: 30,
      maxInputTokensApprox: 12000,
      archiveOnCompact: true,
    },
    contextQueue: {
      maxConcurrency: 2,
      enableCorrectionMerge: true,
      correctionMaxRounds: 2,
      correctionMaxMergedMessages: 5,
    },
  },
  permissions: {
    read_repo: true,
    write_repo: {
      requiresApproval: false,
    },
    exec_command: {
      deny: ["rm"],
      requiresApproval: false,
      denyRequiresApproval: true,
      maxOutputChars: 12000,
      maxOutputLines: 200,
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

export function getShipContextRootDirPath(cwd: string): string {
  return path.join(getShipDirPath(cwd), "context");
}

export function getShipContextDirPath(cwd: string, contextId: string): string {
  return path.join(getShipContextRootDirPath(cwd), encodeURIComponent(contextId));
}

/**
 * History Messages（对话历史，唯一事实源）。
 *
 * 关键点（中文）
 * - `.ship/context/<encodedContextId>/messages/history.jsonl`：每行一个 UIMessage（user/assistant）
 * - compact 会把被折叠的原始段写入 `messages/archive/*`（可审计）
 */
export function getShipContextMessagesDirPath(cwd: string, contextId: string): string {
  return path.join(getShipContextDirPath(cwd, contextId), "messages");
}

export function getShipContextHistoryPath(cwd: string, contextId: string): string {
  return path.join(getShipContextMessagesDirPath(cwd, contextId), "history.jsonl");
}

export function getShipContextHistoryMetaPath(cwd: string, contextId: string): string {
  return path.join(getShipContextMessagesDirPath(cwd, contextId), "meta.json");
}

export function getShipContextHistoryArchiveDirPath(cwd: string, contextId: string): string {
  return path.join(getShipContextMessagesDirPath(cwd, contextId), "archive");
}

export function getShipContextHistoryArchivePath(
  cwd: string,
  contextId: string,
  archiveId: string,
): string {
  return path.join(
    getShipContextHistoryArchiveDirPath(cwd, contextId),
    `${encodeURIComponent(String(archiveId || "").trim())}.json`,
  );
}

export function getShipContextMemoryDirPath(cwd: string, contextId: string): string {
  return path.join(getShipContextDirPath(cwd, contextId), "memory");
}

export function getShipContextMemoryPrimaryPath(cwd: string, contextId: string): string {
  return path.join(getShipContextMemoryDirPath(cwd, contextId), "Primary.md");
}

export function getShipContextMemoryBackupDirPath(cwd: string, contextId: string): string {
  return path.join(getShipContextMemoryDirPath(cwd, contextId), "backup");
}

export function getShipContextMemoryBackupPath(
  cwd: string,
  contextId: string,
  timestamp: number,
): string {
  return path.join(
    getShipContextMemoryBackupDirPath(cwd, contextId),
    `Primary-${timestamp}.md`,
  );
}

export function getShipContextMemoryMetaPath(cwd: string, contextId: string): string {
  return path.join(getShipContextMemoryDirPath(cwd, contextId), ".meta.json");
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
