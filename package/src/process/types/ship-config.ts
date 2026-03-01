/**
 * Ship 配置类型定义。
 *
 * 关键点（中文）
 * - 作为全局共享类型，不再挂在 process/server 目录下。
 * - 供 process/core/services/shared 多层复用，避免反向类型依赖。
 */

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
   * services 配置。
   *
   * 关键点（中文）
   * - 所有服务相关配置统一收敛到 `services` 下，避免顶层散落字段。
   * - 例如：`services.skills`、`services.chat.adapters`。
   */
  services?: {
    /**
     * Claude Code-compatible skills 配置。
     *
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
    /**
     * Chat service 配置。
     */
    chat?: {
      /**
       * 出站（egress）控制：用于限制工具发送、避免重复与无限循环刷屏。
       */
      egress?: {
        /**
         * 单次 agent run 内，`chat_send` 允许调用的最大次数。
         */
        chatSendMaxCallsPerRun?: number;
        /**
         * 是否启用 `chat_send` 幂等去重（基于 inbound messageId + 回复内容 hash）。
         */
        chatSendIdempotency?: boolean;
      };
      /**
       * 消息平台适配器配置。
       */
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
           * - "anyone": all group members can talk to the bot (when addressed).
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
    };
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
   * 上下文管理（工程向配置）。
   *
   * 说明
   * - 对话消息以 UIMessage[] 为唯一事实源（.ship/context/<contextId>/messages/messages.jsonl）。
   * - Agent 每次执行直接把 UIMessage[] 转成 ModelMessage[] 作为 messages 输入。
   * - 超出上下文窗口时会自动 compact（更早段压缩为摘要 + 保留最近窗口）。
   */
  context?: {
    /**
     * messages（唯一上下文消息来源）的 compact 策略。
     */
    messages?: {
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
       * 默认：16000
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
}
