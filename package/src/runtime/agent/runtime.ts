import {
  type LanguageModel,
  type ModelMessage,
  type ToolLoopAgent,
} from "ai";
import { withLlmRequestContext } from "../../telemetry/index.js";
import { generateId } from "../../utils.js";
import { ContactBook } from "../chat/contacts.js";
import { McpManager } from "../mcp/manager.js";
import { buildDefaultSystemPrompt } from "./prompt.js";
import { AgentSessionStore } from "./session-store.js";
import { createModelAndAgent } from "./model.js";
import { createToolSet } from "./tools.js";
import {
  extractUserFacingTextFromStep,
  emitToolSummariesFromStep,
} from "./tool-step.js";
import type {
  AgentContext,
  AgentRunInput,
  AgentResult,
  ConversationMessage,
} from "./types.js";
import { createLogger, type Logger } from "../../telemetry/index.js";
import type { ShipConfig } from "../../utils.js";
import { chatRequestContext } from "../chat/request-context.js";
import { withToolExecutionContext } from "../tools/execution-context.js";

/**
 * AgentRuntime orchestrates a single "agent brain" for a project.
 *
 * Responsibilities:
 * - Build the runtime prompt (system prompt + user instructions + memory).
 * - Run the AI SDK ToolLoopAgent and stream step/tool summaries via `onStep`.
 * - Persist execution telemetry via the unified Logger (incl. LLM request/response blocks).
 * - Handle human-in-the-loop approvals and resume execution after decisions.
 * - Maintain per-chatKey conversation history and periodic long-term memory extraction.
 *
 * Note: AgentRuntime is transport-agnostic; chat adapters/server APIs provide delivery tools (e.g. dispatcher + chat_send).
 */
export class AgentRuntime {
  private context: AgentContext;
  private initialized: boolean = false;
  private logger: Logger;
  private mcpManager: McpManager | null = null;

  private model: LanguageModel | null = null;
  private agent: ToolLoopAgent<never, any, any> | null = null;

  private sessions: AgentSessionStore = new AgentSessionStore();
  private contacts: ContactBook;
  // Keep core: per-chatKey in-memory history + on-demand disk history loading tool.

  constructor(
    context: AgentContext,
    deps?: { mcpManager?: McpManager | null; logger?: Logger | null },
  ) {
    this.context = context;
    this.logger = deps?.logger ?? createLogger(context.projectRoot, "info");
    this.mcpManager = deps?.mcpManager ?? null;
    this.contacts = new ContactBook(context.projectRoot);
  }

  setConversationHistory(chatKey: string, messages: unknown[]): void {
    this.sessions.set(chatKey, messages);
  }

  getConversationHistory(chatKey?: string): ConversationMessage[] {
    return this.sessions.getConversationHistory(chatKey);
  }

  clearConversationHistory(chatKey?: string): void {
    this.sessions.clear(chatKey);
  }

  getContactBook(): ContactBook {
    return this.contacts;
  }

  getAgentMd(): string {
    return this.context.agentMd;
  }

  getConfig(): ShipConfig {
    return this.context.config;
  }

  getProjectRoot(): string {
    return this.context.projectRoot;
  }

  getLogger(): Logger {
    return this.logger;
  }

  async initialize(): Promise<void> {
    try {
      await this.logger.log(
        "info",
        "Initializing Agent Runtime with ToolLoopAgent (AI SDK v6)",
      );
      await this.logger.log(
        "info",
        `Agent.md content length: ${this.context.agentMd?.length || 0} chars`,
      );

      const tools = createToolSet({
        projectRoot: this.context.projectRoot,
        config: this.context.config,
        mcpManager: this.mcpManager,
        logger: this.logger,
        contacts: this.contacts,
      });

      const created = await createModelAndAgent({
        config: this.context.config,
        agentMd: this.context.agentMd,
        logger: this.logger,
        tools,
      });

      if (!created) return;
      this.model = created.model;
      this.agent = created.agent;
      this.initialized = true;

      await this.logger.log(
        "info",
        "Agent Runtime initialized with ToolLoopAgent",
      );
    } catch (error) {
      await this.logger.log("error", "Agent Runtime initialization failed", {
        error: String(error),
      });
    }
  }

  async run(input: AgentRunInput): Promise<AgentResult> {
    const { instructions, chatKey, onStep } = input;
    const startTime = Date.now();
    const requestId = generateId();

    const chatCtx = chatRequestContext.getStore();
    const extraContextLines: string[] = [];
    if (chatCtx?.channel) extraContextLines.push(`- Channel: ${chatCtx.channel}`);
    if (chatCtx?.chatId) extraContextLines.push(`- ChatId: ${chatCtx.chatId}`);
    if (chatCtx?.userId) extraContextLines.push(`- UserId: ${chatCtx.userId}`);
    if (chatCtx?.username) extraContextLines.push(`- Username: ${chatCtx.username}`);

    await this.logger.log(
      "debug",
      `Using system prompt (Agent.md): ${this.context.agentMd?.substring(0, 100)}...`,
    );
    await this.logger.log("debug", `ChatKey: ${chatKey}`);
    await this.logger.log("info", "Agent request started", {
      requestId,
      chatKey,
      instructionsPreview: instructions?.slice(0, 200),
      projectRoot: this.context.projectRoot,
    });

    const defaultPrompt = buildDefaultSystemPrompt({
      projectRoot: this.context.projectRoot,
      chatKey,
      requestId,
      extraContextLines,
    });

    const systemPrompt = [String(this.context.agentMd || "").trim(), defaultPrompt]
      .filter(Boolean)
      .join("\n\n");

    const userText = String(instructions ?? "");

    if (this.initialized && this.agent) {
      return this.runWithToolLoopAgent(systemPrompt, userText, startTime, chatKey, {
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

    const history = this.sessions.getOrCreate(chatKey);
    const beforeLen = history.length;
    let lastEmittedAssistant = "";

    try {
      // Build in-flight messages for this request:
      // - system: Agent.md + DefaultPrompt
      // - history: in-memory prior turns (user/assistant/tool)
      // - user: current raw user message
      const inFlightMessages: ModelMessage[] = [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: userText },
      ];

      const currentUserMessageIndex = inFlightMessages.length - 1;

      const result = await withToolExecutionContext(
        {
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
                  if (userTextFromStep && userTextFromStep !== lastEmittedAssistant) {
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
        await this.logger.log(
          "info",
          [
            "===== LLM RESPONSE BEGIN =====",
            ...(requestId ? [`requestId: ${requestId}`] : []),
            `chatKey: ${chatKey}`,
            `historyBefore: ${beforeLen}`,
            `responseMessages: ${responseMessages.length}`,
            responseMessages.length
              ? `\n${this.sessions.formatModelMessagesForLog(responseMessages)}`
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

      // Simple bound: keep recent N messages only to reduce runaway growth.
      const maxHistoryMessages = 60;
      if (history.length > maxHistoryMessages) {
        history.splice(0, history.length - maxHistoryMessages);
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
      await this.logger.log("info", "Agent execution completed", {
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
        const currentHistory = this.sessions.getOrCreate(chatKey);
        await this.logger.log(
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
          this.sessions.delete(chatKey);
          return {
            success: false,
            output:
              "Context length exceeded and compaction failed. History cleared. Please resend your question.",
            toolCalls,
          };
        }

        // Minimal compaction: drop oldest half of in-memory history and retry.
        const h = this.sessions.getOrCreate(chatKey);
        if (h.length >= 6) {
          const cut = Math.floor(h.length * 0.5);
          h.splice(0, cut);
        } else {
          this.sessions.delete(chatKey);
          return {
            success: false,
            output:
              "Context length exceeded and compaction was not possible. History cleared. Please resend your question.",
            toolCalls,
          };
        }

        return this.runWithToolLoopAgent(systemPrompt, userText, startTime, chatKey, {
          compactionAttempts: compactionAttempts + 1,
          onStep,
          requestId,
        });
      }

      await this.logger.log("error", "Agent execution failed", {
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

  async cleanup(): Promise<void> {
    if (this.mcpManager) await this.mcpManager.close();
  }
}
