import {
  stepCountIs,
  ToolLoopAgent,
  type LanguageModel,
  type ModelMessage,
} from "ai";
import { withLlmRequestContext } from "../../telemetry/index.js";
import {
  generateId,
  getShipChatMemoryPrimaryPath,
  getShipProfileOtherPath,
  getShipProfilePrimaryPath,
} from "../../utils.js";
import { getContactBook } from "../../chat/index.js";
import { transformPromptsIntoSystemMessages } from "./prompt.js";
import { createModel } from "./model.js";
import fs from "fs-extra";
import {
  extractUserFacingTextFromStep,
  emitToolSummariesFromStep,
} from "./tool-step.js";
import type {
  AgentConfigurations,
  AgentRunInput,
  AgentResult,
} from "../../types/agent.js";
import { getLogger, type Logger } from "../../telemetry/index.js";
import { chatRequestContext } from "../../chat/request-context.js";
import { withToolExecutionContext } from "../tools/builtin/execution-context.js";
import { createAgentToolSet } from "../tools/set/toolset.js";
import { loadChatTranscriptAsOneAssistantMessage } from "../../chat/transcript.js";
import type { AgentToolRegistry } from "../tools/set/tool-registry.js";

export class Agent {
  // 配置
  private configs: AgentConfigurations;
  // 是否初始化
  private initialized: boolean = false;
  // 模型
  private model: LanguageModel | null = null;
  // Agent 执行逻辑
  private agent: ToolLoopAgent<never, any, any> | null = null;
  // 工具注册表（支持运行中 toolset_load 追加工具）
  private toolRegistry: AgentToolRegistry | null = null;

  constructor(configs: AgentConfigurations) {
    this.configs = configs;
  }

  clearConversationHistory(chatKey?: string): void {
    // 关键点：不再维护“跨轮 in-memory history”。
    // - 上下文来源以 ChatStore transcript（落盘）为准
    // - 本方法保留为兼容接口，但实际无需清理任何内存状态
    void chatKey;
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
      this.toolRegistry = tools.registry;

      this.model = await createModel({
        config: this.configs.config,
        logger,
      });

      this.agent = new ToolLoopAgent({
        model: this.model,
        instructions: transformPromptsIntoSystemMessages([
          ...this.configs.systems,
        ]),
        tools: tools.tools,
        stopWhen: [stepCountIs(30)],
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
    const { query, chatKey, onStep } = input;
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
      instructionsPreview: query?.slice(0, 200),
      projectRoot: this.configs.projectRoot,
    });
    if (this.initialized && this.agent) {
      return this.runWithToolLoopAgent(query, startTime, chatKey, {
        onStep,
        requestId,
      });
    }

    return {
      success: false,
      output:
        "LLM is not configured (or runtime not initialized). Please configure `ship.json.llm` (model + apiKey) and restart.",
      toolCalls: [],
    };
  }

  private async runWithToolLoopAgent(
    userText: string,
    startTime: number,
    chatKey: string,
    opts?: {
      retryAttempts?: number;
      onStep?: AgentRunInput["onStep"];
      requestId?: string;
    },
  ): Promise<AgentResult> {
    const toolCalls: AgentResult["toolCalls"] = [];
    let hadToolFailure = false;
    const toolFailureSummaries: string[] = [];
    const retryAttempts = opts?.retryAttempts ?? 0;
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

    let lastEmittedAssistant = "";

    try {
      const systemExtras: ModelMessage[] = [];
      const readOptionalMd = async (filePath: string): Promise<string> => {
        try {
          if (!(await fs.pathExists(filePath))) return "";
          const content = String(await fs.readFile(filePath, "utf-8")).trim();
          return content;
        } catch {
          return "";
        }
      };

      const profilePrimary = await readOptionalMd(
        getShipProfilePrimaryPath(this.configs.projectRoot),
      );
      if (profilePrimary) {
        systemExtras.push({
          role: "system",
          content: ["# Profile / Primary", profilePrimary].join("\n\n"),
        });
      }

      const profileOther = await readOptionalMd(
        getShipProfileOtherPath(this.configs.projectRoot),
      );
      if (profileOther) {
        systemExtras.push({
          role: "system",
          content: ["# Profile / Other", profileOther].join("\n\n"),
        });
      }

      const chatMemoryPrimary = await readOptionalMd(
        getShipChatMemoryPrimaryPath(this.configs.projectRoot, chatKey),
      );
      if (chatMemoryPrimary) {
        systemExtras.push({
          role: "system",
          content: ["# Chat Memory / Primary", chatMemoryPrimary].join("\n\n"),
        });
      }

      // 关键点：已加载的 ToolSets 需要在每次 run 默认生效（system prompt）。
      // toolset_load 在“本次 run”里会即时注入一次；这里负责“后续 run 的默认注入”。
      const toolSetsSystem = this.toolRegistry?.buildLoadedToolSetsSystemPrompt() || "";
      if (toolSetsSystem.trim()) {
        systemExtras.push({ role: "system", content: toolSetsSystem });
      }

      // 从 ChatStore 抽取 transcript，并以“一条 assistant message”注入。
      // 关键点：这里不是“持久化 in-memory history”，而是每次 run 都以落盘 transcript 作为历史来源。
      const transcriptMaxMessages =
        typeof this.configs.config?.context?.chatHistory
          ?.transcriptMaxMessages === "number"
          ? this.configs.config.context.chatHistory.transcriptMaxMessages
          : 30;
      const transcriptMaxChars =
        typeof this.configs.config?.context?.chatHistory?.transcriptMaxChars ===
        "number"
          ? this.configs.config.context.chatHistory.transcriptMaxChars
          : 12_000;

      const transcriptCount =
        typeof opts?.retryAttempts === "number" && opts.retryAttempts > 0
          ? Math.max(0, Math.floor(transcriptMaxMessages / (opts.retryAttempts + 1)))
          : transcriptMaxMessages;

      const transcript = await loadChatTranscriptAsOneAssistantMessage({
        projectRoot: this.configs.projectRoot,
        chatKey,
        options: {
          count: transcriptCount,
          maxChars: transcriptMaxChars,
        },
      });

      // Build in-flight messages for this request:
      // - system: runtime prompt (chatKey/requestId/来源等)
      // - history: ChatStore transcript（单条 assistant 注入）
      // - user: current raw user message
      const inFlightMessages: ModelMessage[] = [
        ...systemExtras,
        ...(transcript.message ? [transcript.message] : []),
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
                try {
                  // 关键点：为调度器提供“step 完成”的可靠信号。
                  // onStepFinish 内部可能 emit 多个事件（assistant/tool summaries），调度器需要一个去抖触发点。
                  await emitStep("step_finish", "", { requestId, chatKey });
                } catch {
                  // ignore
                }
              },
            }),
          ),
      );

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
        await logger.log(
          "warn",
          "Context length exceeded, retry with smaller transcript injection",
          {
            chatKey,
            error: errorMsg,
            retryAttempts,
          },
        );
        await emitStep("compaction", "上下文过长，已减少注入的对话历史后继续。", {
          requestId,
          chatKey,
          retryAttempts,
        });

        if (retryAttempts >= 3) {
          return {
            success: false,
            output:
              "Context length exceeded and retries failed. Please resend your question (or reduce context.chatHistory.transcriptMaxMessages).",
            toolCalls,
          };
        }

        return this.runWithToolLoopAgent(userText, startTime, chatKey, {
          retryAttempts: retryAttempts + 1,
          onStep,
          requestId,
        });
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
}
