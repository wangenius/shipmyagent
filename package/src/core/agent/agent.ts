import {
  stepCountIs,
  ToolLoopAgent,
  type LanguageModel,
  type ModelMessage,
} from "ai";
import { withLlmRequestContext } from "../../telemetry/index.js";
import { generateId } from "../../utils.js";
import { getContactBook } from "../chat/index.js";
import {
  buildContextSystemPrompt,
  transformPromptsIntoSystemMessages,
} from "./prompt.js";
import { createModel } from "./model.js";
import {
  extractUserFacingTextFromStep,
  emitToolSummariesFromStep,
} from "./tool-step.js";
import type {
  AgentConfigurations,
  AgentRunInput,
  AgentResult,
  ConversationMessage,
} from "../../types/agent.js";
import { getLogger, type Logger } from "../../telemetry/index.js";
import type { ShipConfig } from "../../utils.js";
import { chatRequestContext } from "../chat/request-context.js";
import { withToolExecutionContext } from "../tools/builtin/execution-context.js";
import { createAgentToolSet } from "../tools/set/toolset.js";
import { ContextStore } from "./context-store.js";

/**
 * Stop condition: stop the tool loop after too many consecutive `chat_send` calls.
 *
 * 为什么需要这个兜底：
 * - 在 tool-strict 的 chat 集成里，模型会用 `chat_send` 发消息。
 * - 但部分模型会把 `chat_send` 当成“流式输出接口”，每段话都调用一次，
 *   于是 ToolLoopAgent 会继续下一步 -> 再调用 `chat_send` -> 无限重复，最终刷屏直到 stepCount 上限。
 * - 对用户而言，一次用户消息的回复可能需要拆成少量多条（长文/附件说明），但不应无限刷屏。
 */
function stopAfterConsecutiveChatSends(
  options: { steps: any[] },
  maxConsecutive: number,
): boolean {
  const store = chatRequestContext.getStore();
  // 非聊天触发（例如 CLI / API）时，不要因为 chat_send 而提前终止。
  if (!store?.channel) return false;
  if (!Number.isFinite(maxConsecutive) || maxConsecutive <= 0) return false;

  const steps = Array.isArray(options.steps) ? options.steps : [];
  let streak = 0;

  // 只看“结尾连续”的 chat_send 成功调用：一旦出现其它工具/无工具/失败，就认为不再连续。
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i];
    const toolResults = Array.isArray((step as any)?.toolResults)
      ? ((step as any).toolResults as any[])
      : [];

    if (toolResults.length === 0) break;

    let allChatSendSuccess = true;
    for (const tr of toolResults) {
      const toolName = String((tr as any)?.toolName || "");
      if (toolName !== "chat_send") {
        allChatSendSuccess = false;
        break;
      }
      const out = (tr as any)?.output;
      if (!(out && typeof out === "object" && (out as any).success === true)) {
        allChatSendSuccess = false;
        break;
      }
    }

    if (!allChatSendSuccess) break;

    // 一般每 step 只有 1 次 chat_send；如果同一步多次 chat_send，也算进 streak。
    streak += toolResults.length;
    if (streak >= maxConsecutive) return true;
  }

  return false;
}

/**
 * AgentRuntime orchestrates a single "agent brain" for a project.
 *
 * Responsibilities:
 * - Build the runtime prompt (system prompt + user instructions + memory).
 * - Run the AI SDK ToolLoopAgent and stream step/tool summaries via `onStep`.
 * - Persist execution telemetry via the unified Logger (incl. LLM request/response blocks).
 * - Maintain per-chatKey in-memory conversation context (for the next turn).
 * - Persist lightweight agent execution context (engineering-oriented) under `.ship/memory/`.
 *
 * Note: AgentRuntime is transport-agnostic; chat adapters/server APIs provide delivery tools (e.g. dispatcher + chat_send).
 */
export class Agent {
  // 配置
  private configs: AgentConfigurations;
  // 是否初始化
  private initialized: boolean = false;
  // 模型
  private model: LanguageModel | null = null;
  // Agent 执行逻辑
  private agent: ToolLoopAgent<never, any, any> | null = null;

  /**
   * ContextStore（统一上下文存储）。
   *
   * - in-memory：LLM 的会话 messages（按 chatKey）
   * - persisted：agent 执行摘要（.ship/memory/agent-context）
   */
  private contextStore: ContextStore;

  constructor(configs: AgentConfigurations) {
    this.configs = configs;
    this.contextStore = new ContextStore(this.configs.projectRoot);
  }

  setConversationHistory(chatKey: string, messages: unknown[]): void {
    this.contextStore.setChatSession(chatKey, messages);
  }

  getConversationHistory(chatKey?: string): ConversationMessage[] {
    return this.contextStore.getConversationHistory(chatKey);
  }

  clearConversationHistory(chatKey?: string): void {
    this.contextStore.clearChatSessions(chatKey);
  }

  getConfig(): ShipConfig {
    return this.configs.config;
  }

  getProjectRoot(): string {
    return this.configs.projectRoot;
  }

  getLogger(): Logger {
    return getLogger(this.configs.projectRoot, "info");
  }

  async initialize(): Promise<void> {
    const logger = this.getLogger();
    try {
      await logger.log(
        "info",
        "Initializing Agent Runtime with ToolLoopAgent (AI SDK v6)",
      );
      await logger.log(
        "info",
        `Agent.md content length: ${this.configs.systems?.length || 0} chars`,
      );

      const tools = createAgentToolSet({
        projectRoot: this.configs.projectRoot,
        config: this.configs.config,
        logger,
        contacts: getContactBook(this.configs.projectRoot),
      });

      this.model = await createModel({
        config: this.configs.config,
        logger,
      });

      this.agent = new ToolLoopAgent({
        model: this.model,
        instructions: transformPromptsIntoSystemMessages(this.configs.systems),
        tools,
        stopWhen: [(o) => stopAfterConsecutiveChatSends(o, 8), stepCountIs(30)],
      });

      this.initialized = true;

      await logger.log("info", "Agent Runtime initialized with ToolLoopAgent");
    } catch (error) {
      await logger.log("error", "Agent Runtime initialization failed", {
        error: String(error),
      });
    }
  }

  async run(input: AgentRunInput): Promise<AgentResult> {
    const { instructions, chatKey, onStep } = input;
    const startTime = Date.now();
    const requestId = generateId();
    const logger = this.getLogger();

    const chatCtx = chatRequestContext.getStore();
    const extraContextLines: string[] = [];
    if (chatCtx?.channel)
      extraContextLines.push(`- Channel: ${chatCtx.channel}`);
    if (chatCtx?.chatId) extraContextLines.push(`- ChatId: ${chatCtx.chatId}`);
    if (chatCtx?.userId) extraContextLines.push(`- UserId: ${chatCtx.userId}`);
    if (chatCtx?.username)
      extraContextLines.push(`- Username: ${chatCtx.username}`);

    await logger.log("debug", `ChatKey: ${chatKey}`);
    await logger.log("info", "Agent request started", {
      requestId,
      chatKey,
      instructionsPreview: instructions?.slice(0, 200),
      projectRoot: this.configs.projectRoot,
    });

    const runtimeSystemPrompt = buildContextSystemPrompt({
      projectRoot: this.configs.projectRoot,
      chatKey,
      requestId,
      extraContextLines,
    });

    const userText = String(instructions ?? "");

    if (this.initialized && this.agent) {
      return this.runWithToolLoopAgent(
        runtimeSystemPrompt,
        userText,
        startTime,
        chatKey,
        {
          onStep,
          requestId,
        },
      );
    }

    return {
      success: false,
      output:
        "LLM is not configured (or runtime not initialized). Please configure `ship.json.llm` (model + apiKey) and restart.",
      toolCalls: [],
    };
  }

  private async runWithToolLoopAgent(
    systemPrompt: string,
    userText: string,
    startTime: number,
    chatKey: string,
    opts?: {
      compactionAttempts?: number;
      onStep?: AgentRunInput["onStep"];
      requestId?: string;
    },
  ): Promise<AgentResult> {
    const toolCalls: AgentResult["toolCalls"] = [];
    let hadToolFailure = false;
    const toolFailureSummaries: string[] = [];
    const compactionAttempts = opts?.compactionAttempts ?? 0;
    const onStep = opts?.onStep;
    const requestId = opts?.requestId || "";
    const logger = this.getLogger();

    const emitStep = async (
      type: string,
      text: string,
      data?: Record<string, unknown>,
    ) => {
      if (!onStep) return;
      try {
        await onStep({ type, text, data });
      } catch {
        // ignore
      }
    };

    if (!this.initialized || !this.agent) {
      throw new Error("Agent not initialized");
    }

    const history = this.contextStore.getOrCreateChatSession(chatKey);
    const beforeLen = history.length;
    let lastEmittedAssistant = "";

    try {
      // Build in-flight messages for this request:
      // - system: runtime prompt (chatKey/requestId/来源等)
      // - history: in-memory prior turns (user/assistant/tool)
      // - user: current raw user message
      const inFlightMessages: ModelMessage[] = [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: userText },
      ];

      // system messages 需要保持聚合在 messages 开头，工具注入 system 指令时应插到它们之后。
      let systemMessageInsertIndex = 0;
      while (
        systemMessageInsertIndex < inFlightMessages.length &&
        (inFlightMessages[systemMessageInsertIndex] as any)?.role === "system"
      ) {
        systemMessageInsertIndex += 1;
      }

      const currentUserMessageIndex = inFlightMessages.length - 1;

      const result = await withToolExecutionContext(
        {
          systemMessageInsertIndex,
          messages: inFlightMessages,
          currentUserMessageIndex,
          injectedFingerprints: new Set(),
          maxInjectedMessages: 120,
        },
        () =>
          withLlmRequestContext({ chatKey, requestId }, () =>
            this.agent!.generate({
              messages: inFlightMessages,
              onStepFinish: async (step) => {
                try {
                  const userTextFromStep = extractUserFacingTextFromStep(step);
                  if (
                    userTextFromStep &&
                    userTextFromStep !== lastEmittedAssistant
                  ) {
                    lastEmittedAssistant = userTextFromStep;
                    await emitStep("assistant", userTextFromStep, {
                      requestId,
                      chatKey,
                    });
                  }
                } catch {
                  // ignore
                }
                if (!onStep) return;
                try {
                  await emitToolSummariesFromStep(step, emitStep, {
                    requestId,
                    chatKey,
                  });
                } catch {
                  // ignore
                }
              },
            }),
          ),
      );

      try {
        const responseMessages = (result.response?.messages ||
          []) as ModelMessage[];
        await logger.log(
          "info",
          [
            "===== LLM RESPONSE BEGIN =====",
            ...(requestId ? [`requestId: ${requestId}`] : []),
            `chatKey: ${chatKey}`,
            `historyBefore: ${beforeLen}`,
            `responseMessages: ${responseMessages.length}`,
            responseMessages.length
              ? `\n${this.contextStore.formatModelMessagesForLog(responseMessages)}`
              : "",
            "===== LLM RESPONSE END =====",
          ]
            .filter(Boolean)
            .join("\n"),
          {
            kind: "llm_response",
            chatKey,
            requestId,
            historyBefore: beforeLen,
            responseMessages: responseMessages.length,
          },
        );
      } catch {
        // ignore
      }

      // Persist turn into in-memory history (exclude the per-request system message).
      history.push({ role: "user", content: userText });
      history.push(...(result.response.messages as ModelMessage[]));

      // Simple bound: keep recent N messages (并在必要时压缩更早 messages)。
      const maxHistoryMessages =
        typeof this.configs.config?.context?.chatHistory
          ?.inMemoryMaxMessages === "number"
          ? this.configs.config.context.chatHistory.inMemoryMaxMessages
          : 60;
      if (history.length > maxHistoryMessages) {
        this.compactChatHistory(chatKey, history, {
          keepLast:
            typeof this.configs.config?.context?.chatHistory
              ?.compactKeepLastMessages === "number"
              ? this.configs.config.context.chatHistory.compactKeepLastMessages
              : 30,
        });
      }

      for (const step of result.steps || []) {
        for (const tr of step.toolResults || []) {
          toolCalls.push({
            tool: String((tr as any).toolName || "unknown_tool"),
            input: ((tr as any).input || {}) as Record<string, unknown>,
            output: JSON.stringify((tr as any).output),
          });

          const out = (tr as any).output;
          if (
            out &&
            typeof out === "object" &&
            "success" in out &&
            !out.success
          ) {
            hadToolFailure = true;
            const err =
              (out as any).error || (out as any).stderr || "unknown error";
            toolFailureSummaries.push(
              `${String((tr as any).toolName)}: ${String(err)}`.slice(0, 200),
            );
          }
        }

        for (const part of step.content || []) {
          if ((part as any)?.type !== "tool-error") continue;
          toolCalls.push({
            tool: String((part as any).toolName || "unknown_tool"),
            input: ((part as any).input || {}) as Record<string, unknown>,
            output: JSON.stringify({ error: (part as any).error }),
          });
          hadToolFailure = true;
          toolFailureSummaries.push(
            `${String((part as any).toolName)}: ${String((part as any).error)}`.slice(
              0,
              200,
            ),
          );
        }
      }

      const duration = Date.now() - startTime;
      await logger.log("info", "Agent execution completed", {
        duration,
        toolCallsTotal: toolCalls.length,
      });
      await emitStep("done", "done", { requestId, chatKey });

      // 记录 agent 执行上下文（持久化摘要），并按 window 自动 compact。
      try {
        const windowEntries =
          typeof this.configs.config?.context?.agentContext?.windowEntries ===
          "number"
            ? this.configs.config.context.agentContext.windowEntries
            : 200;

        await this.contextStore.appendAgentExecution({
          chatKey,
          requestId,
          userPreview: userText,
          outputPreview: String(result.text || ""),
          toolCalls: toolCalls.map((tc) => {
            const outRaw = String(tc.output ?? "");
            let success: boolean | undefined = undefined;
            let error: string | undefined = undefined;
            try {
              const parsed = JSON.parse(outRaw);
              if (parsed && typeof parsed === "object" && "success" in parsed) {
                success = Boolean((parsed as any).success);
                if (!success) {
                  error =
                    typeof (parsed as any).error === "string"
                      ? (parsed as any).error
                      : typeof (parsed as any).stderr === "string"
                        ? (parsed as any).stderr
                        : undefined;
                }
              }
            } catch {
              // ignore
            }
            return {
              tool: String(tc.tool || ""),
              ...(typeof success === "boolean" ? { success } : {}),
              ...(error ? { error: String(error).slice(0, 200) } : {}),
            };
          }),
        });
        await this.contextStore.compactAgentExecutionIfNeeded(
          chatKey,
          windowEntries,
        );
      } catch {
        // ignore
      }

      return {
        success: !hadToolFailure,
        output: [
          result.text || "Execution completed",
          hadToolFailure
            ? `\n\nTool errors:\n${toolFailureSummaries.map((s) => `- ${s}`).join("\n")}`
            : "",
        ].join(""),
        toolCalls,
      };
    } catch (error) {
      const errorMsg = String(error);
      if (
        errorMsg.includes("context_length") ||
        errorMsg.includes("too long") ||
        errorMsg.includes("maximum context") ||
        errorMsg.includes("context window")
      ) {
        const currentHistory =
          this.contextStore.getOrCreateChatSession(chatKey);
        await logger.log(
          "warn",
          "Context length exceeded, compacting history",
          {
            chatKey,
            currentMessages: currentHistory.length,
            error: errorMsg,
            compactionAttempts,
          },
        );
        await emitStep("compaction", "上下文过长，已自动压缩历史记录后继续。", {
          requestId,
          chatKey,
          compactionAttempts,
        });

        if (compactionAttempts >= 3) {
          this.contextStore.deleteChatSession(chatKey);
          return {
            success: false,
            output:
              "Context length exceeded and compaction failed. History cleared. Please resend your question.",
            toolCalls,
          };
        }

        // 压缩策略：把更早的对话 messages 合并到一条 assistant summary，保留最后 N 条。
        const h = this.contextStore.getOrCreateChatSession(chatKey);
        const keepLast =
          typeof this.configs.config?.context?.chatHistory
            ?.compactKeepLastMessages === "number"
            ? this.configs.config.context.chatHistory.compactKeepLastMessages
            : 30;
        const ok = this.compactChatHistory(chatKey, h, { keepLast });
        if (!ok) {
          this.contextStore.deleteChatSession(chatKey);
          return {
            success: false,
            output:
              "Context length exceeded and compaction was not possible. History cleared. Please resend your question.",
            toolCalls,
          };
        }

        return this.runWithToolLoopAgent(
          systemPrompt,
          userText,
          startTime,
          chatKey,
          {
            compactionAttempts: compactionAttempts + 1,
            onStep,
            requestId,
          },
        );
      }

      await logger.log("error", "Agent execution failed", {
        error: errorMsg,
      });
      return {
        success: false,
        output: `Execution failed: ${errorMsg}`,
        toolCalls,
      };
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 压缩 chat session 的 in-memory messages。
   *
   * 目标
   * - 把更早的 user/assistant/tool messages 合并成一条 assistant summary
   * - 保留最后 keepLast 条 messages（更贴近当前任务）
   *
   * 返回值
   * - true：完成压缩
   * - false：无法压缩（历史太短或输入不合法）
   */
  compactChatHistory(
    chatKey: string,
    history: ModelMessage[],
    opts: { keepLast: number },
  ): boolean {
    const keepLast = Math.max(1, Math.min(5000, Math.floor(opts.keepLast)));
    if (!Array.isArray(history)) return false;
    if (history.length <= keepLast + 2) return false;

    const cut = Math.max(1, history.length - keepLast);
    const older = history.slice(0, cut);
    const recent = history.slice(cut);

    const lines: string[] = [];
    lines.push("（已压缩更早的对话上下文，供参考）");
    lines.push(`- chatKey: ${chatKey}`);
    lines.push(`- olderMessages: ${older.length}`);
    lines.push("");

    const maxLines = 120;
    for (const m of older) {
      const role = String((m as any)?.role || "");
      const content = (m as any)?.content;
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? JSON.stringify(content).slice(0, 400)
            : String(content ?? "");
      if (!role || !text) continue;
      lines.push(`${role}: ${text.replace(/\s+$/g, "")}`.slice(0, 600));
      if (lines.length >= maxLines) {
        lines.push("…（省略更多压缩内容）");
        break;
      }
    }

    const summary: ModelMessage = {
      role: "assistant",
      content: lines.join("\n"),
    };

    history.splice(0, history.length, summary, ...recent);
    return true;
  }
}
