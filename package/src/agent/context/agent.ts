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
import { ContextStore } from "./context-store.js";

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
   */
  private contextStore: ContextStore;

  constructor(configs: AgentConfigurations) {
    this.configs = configs;
    this.contextStore = new ContextStore();
  }

  clearConversationHistory(chatKey?: string): void {
    this.contextStore.clearChatSessions(chatKey);
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
        instructions: transformPromptsIntoSystemMessages([
          ...this.configs.systems,
        ]),
        tools,
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

      // Build in-flight messages for this request:
      // - system: runtime prompt (chatKey/requestId/来源等)
      // - history: in-memory prior turns (user/assistant/tool)
      // - user: current raw user message
      const historySystem = history.filter((m) => (m as any)?.role === "system");
      const historyNonSystem = history.filter((m) => (m as any)?.role !== "system");
      const inFlightMessages: ModelMessage[] = [
        ...systemExtras,
        ...historySystem,
        ...historyNonSystem,
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
        this.contextStore.compactChatHistory(chatKey, {
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
        const keepLast =
          typeof this.configs.config?.context?.chatHistory
            ?.compactKeepLastMessages === "number"
            ? this.configs.config.context.chatHistory.compactKeepLastMessages
            : 30;
        const ok = this.contextStore.compactChatHistory(chatKey, { keepLast });
        if (!ok) {
          this.contextStore.deleteChatSession(chatKey);
          return {
            success: false,
            output:
              "Context length exceeded and compaction was not possible. History cleared. Please resend your question.",
            toolCalls,
          };
        }

        return this.runWithToolLoopAgent(userText, startTime, chatKey, {
          compactionAttempts: compactionAttempts + 1,
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
