import {
  generateText,
  streamText,
  stepCountIs,
  Tool,
  type LanguageModel,
  type ModelMessage,
  type SystemModelMessage,
} from "ai";
import { withLlmRequestContext } from "../../telemetry/index.js";
import { generateId } from "../../utils.js";
import {
  buildContextSystemPrompt,
  transformPromptsIntoSystemMessages,
} from "../prompts/system.js";
import { createModel } from "../llm/create-model.js";
import type { AgentRunInput, AgentResult } from "../../types/agent.js";
import type { Logger } from "../../telemetry/index.js";
import { sessionRequestContext } from "../session/request-context.js";
import { createAgentTools } from "../tools/agent-tools.js";
import { openai } from "@ai-sdk/openai";
import type { ShipSessionMetadataV1 } from "../../types/session-history.js";
import {
  getShipRuntimeContext,
  getShipRuntimeContextBase,
} from "../../server/ShipRuntimeContext.js";
import type { SessionAgent } from "../../types/session-agent.js";
import { collectSystemPromptProviderResult } from "../prompts/index.js";
import {
  extractTextFromUiMessage,
  extractToolCallsFromUiMessage,
} from "./ui-message.js";
import type { SystemPromptProviderResult } from "../../types/system-prompt-provider.js";

export class SessionAgentRunner implements SessionAgent {
  // 是否初始化
  private initialized: boolean = false;
  // 模型
  private model: LanguageModel = openai("gpt-5.2");

  private tools: Record<string, Tool> = {};
  /**
   * sessionId 绑定检查。
   *
   * 关键点（中文）
   * - 运行时策略是"一个 sessionId 一个 Agent 实例"（由 SessionManager 保证）
   * - 本实例一旦首次 run 绑定到某个 sessionId，后续必须一致，避免上下文串线
   */
  private boundSessionId: string | null = null;

  constructor() {}

  getLogger(): Logger {
    return getShipRuntimeContextBase().logger;
  }

  async initialize(): Promise<void> {
    try {
      this.tools = createAgentTools();

      this.model = await createModel({
        config: getShipRuntimeContext().config,
      });

      this.initialized = true;
    } catch (error) {
      const logger = this.getLogger();
      await logger.log("error", "Agent Runtime initialization failed", {
        error: String(error),
      });
    }
  }

  async run(input: AgentRunInput): Promise<AgentResult> {
    const { query, sessionId, drainLaneMerged } = input;
    const startTime = Date.now();
    const requestId = generateId();
    const logger = this.getLogger();

    await logger.log("debug", `SessionId: ${sessionId}`);
    await logger.log("info", "Agent request started", {
      requestId,
      sessionId,
      instructionsPreview: query?.slice(0, 200),
      rootPath: getShipRuntimeContext().rootPath,
    });
    if (this.initialized) {
      return this.runWithToolLoopAgent(query, startTime, sessionId, {
        requestId,
        drainLaneMerged,
      });
    }

    return {
      success: false,
      output:
        "LLM is not configured (or runtime not initialized). Please configure `ship.json.llm` (model + apiKey) and restart.",
      toolCalls: [],
    };
  }

  private bindSessionId(sessionId: string): string {
    const key = String(sessionId || "").trim();
    if (!key) throw new Error("Agent.run requires a non-empty sessionId");
    if (this.boundSessionId && this.boundSessionId !== key) {
      // 关键点（中文）：一个 Agent 实例只允许服务一个 sessionId，避免上下文串线。
      throw new Error(
        `Agent is already bound to sessionId=${this.boundSessionId}, got sessionId=${key}`,
      );
    }
    this.boundSessionId = key;
    return key;
  }

  private async runWithToolLoopAgent(
    userText: string,
    startTime: number,
    sessionId: string,
    opts?: {
      retryAttempts?: number;
      drainLaneMerged?: AgentRunInput["drainLaneMerged"];
      requestId?: string;
    },
  ): Promise<AgentResult> {
    const toolCalls: AgentResult["toolCalls"] = [];
    let hadToolFailure = false;
    const toolFailureSummaries: string[] = [];
    const retryAttempts = opts?.retryAttempts ?? 0;
    const drainLaneMerged = opts?.drainLaneMerged;
    const requestId = opts?.requestId || "";
    const logger = this.getLogger();
    if (!this.initialized) {
      throw new Error("Agent not initialized");
    }

    try {
      this.bindSessionId(sessionId);

      const runtime = getShipRuntimeContext();
      const historyStore = runtime.sessionManager.getHistoryStore(sessionId);

      const runtimeSystemMessages = this.buildRuntimeSystemMessages({
        projectRoot: runtime.rootPath,
        sessionId,
        requestId,
      });

      // 先确保本轮 user 已写入 history（best-effort）
      await this.ensureCurrentUserRecorded({
        historyStore,
        userText,
        sessionId,
        requestId,
      });

      const providerResult = await collectSystemPromptProviderResult({
        projectRoot: runtime.rootPath,
        sessionId,
        requestId,
        allToolNames: Object.keys(this.tools),
      });

      const staticSystemMessages = transformPromptsIntoSystemMessages([
        ...runtime.systems,
      ]);
      const baseSystemMessages: SystemModelMessage[] = [
        ...runtimeSystemMessages,
        ...staticSystemMessages,
        ...providerResult.messages,
      ];

      const compactPolicy = this.resolveCompactPolicy(retryAttempts);
      let compacted = false;
      try {
        const compactResult = await historyStore.compactIfNeeded({
          model: this.model,
          system: baseSystemMessages,
          keepLastMessages: compactPolicy.keepLastMessages,
          maxInputTokensApprox: compactPolicy.maxInputTokensApprox,
          archiveOnCompact: compactPolicy.archiveOnCompact,
        });
        compacted = Boolean((compactResult as any)?.compacted);
      } catch {
        // ignore compact failure; fallback to un-compacted history
      }

      let currentProviderResult = providerResult;
      if (compacted) {
        // 关键点（中文）：compact 后重新聚合 provider，保证 prompt 与 activeTools 同步最新状态。
        currentProviderResult = await collectSystemPromptProviderResult({
          projectRoot: runtime.rootPath,
          sessionId,
          requestId,
          allToolNames: Object.keys(this.tools),
        });
      }

      const currentBaseSystemMessages: SystemModelMessage[] = [
        ...runtimeSystemMessages,
        ...staticSystemMessages,
        ...currentProviderResult.messages,
      ];

      let baseModelMessages: ModelMessage[] =
        (await historyStore.toModelMessages({ tools: this.tools })) as any;
      if (!Array.isArray(baseModelMessages) || baseModelMessages.length === 0) {
        baseModelMessages = [{ role: "user", content: userText } as any];
      }

      await logger.log("debug", "Context selected", {
        sessionId,
        historySource: "history_jsonl",
        modelMessages: baseModelMessages.length,
        keepLastMessages: compactPolicy.keepLastMessages,
        maxInputTokensApprox: compactPolicy.maxInputTokensApprox,
      });

      // 关键点（中文）
      // - AI SDK 的 tool-loop 会把 tool call / tool output 以 messages 的形式串起来（in-flight）。
      // - lane merge 导致 history 更新时，我们需要“替换 messages 的前缀 history”，但必须保留后缀的 tool 链。
      let lastAppliedBasePrefixLen = baseModelMessages.length;
      let needsHistoryResync = false;

      const reloadModelMessages = async (
        trigger: string,
      ): Promise<{ reloaded: boolean; drained?: number }> => {
        if (typeof drainLaneMerged !== "function") return { reloaded: false };
        try {
          const r = await drainLaneMerged();
          const drained =
            r && typeof (r as any).drained === "number"
              ? (r as any).drained
              : 0;
          if (drained <= 0) return { reloaded: false, drained: 0 };
          baseModelMessages = (await historyStore.toModelMessages({
            tools: this.tools,
          })) as any;
          if (
            !Array.isArray(baseModelMessages) ||
            baseModelMessages.length === 0
          ) {
            baseModelMessages = [{ role: "user", content: userText } as any];
          }
          needsHistoryResync = true;
          void logger.log(
            "debug",
            "Lane merged messages detected; reloaded history for next step",
            {
              sessionId,
              requestId,
              trigger,
              drained,
            },
          );
          return { reloaded: true, drained };
        } catch {
          return { reloaded: false };
        }
      };

      const toolsWithLaneMerge: Record<string, Tool> = {};
      for (const [toolName, tool] of Object.entries(this.tools)) {
        const exec = (tool as any)?.execute;
        if (typeof exec !== "function") {
          toolsWithLaneMerge[toolName] = tool;
          continue;
        }

        toolsWithLaneMerge[toolName] = {
          ...(tool as any),
          execute: async (...args: any[]) => {
            try {
              return await exec.apply(tool, args);
            } finally {
              // 关键点（中文）：工具结束后立即检查 lane 是否有新消息；若有则重载 history。
              await reloadModelMessages(`after_tool:${toolName}`);
            }
          },
        } as any;
      }

      const result = await withLlmRequestContext({ sessionId, requestId }, () => {
        return streamText({
          model: this.model,
          system: currentBaseSystemMessages,
          prepareStep: async ({ messages }) => {
            const incomingMessages: ModelMessage[] = Array.isArray(messages)
              ? (messages as any)
              : [];
            const suffix =
              incomingMessages.length >= lastAppliedBasePrefixLen
                ? incomingMessages.slice(lastAppliedBasePrefixLen)
                : [];

            // 1) 在每个 step 前先检查 lane 是否有新消息；若有则重载 history。
            await reloadModelMessages("before_step");

            // 2) messages：默认保留 tool-loop 的 in-flight messages（包含 tool call/output 链）。
            // 若 history 已变化，则替换“前缀 history”，并保留后缀 tool 链。
            let outMessages: ModelMessage[] | undefined;
            if (needsHistoryResync) {
              outMessages = [...(baseModelMessages as any), ...suffix] as any;
              needsHistoryResync = false;
              lastAppliedBasePrefixLen = Array.isArray(baseModelMessages)
                ? baseModelMessages.length
                : 0;
            }

            const stepOverrides = this.buildStepOverrides({
              providerResult: currentProviderResult,
              baseSystemMessages: currentBaseSystemMessages,
            });

            return {
              ...stepOverrides,
              ...(Array.isArray(outMessages)
                ? { messages: outMessages }
                : {}),
            };
          },
          messages: baseModelMessages,
          tools: toolsWithLaneMerge,
          stopWhen: [stepCountIs(30)],
        });
      });

      // 关键点（中文）：用 ai-sdk v6 的 UIMessage 流来生成最终 assistant UIMessage（包含 tool parts），避免手工拼装。
      let finalAssistantUiMessage: any = null;
      try {
        const ctx = sessionRequestContext.getStore();
        const channel = (ctx?.channel as any) || "api";
        const targetId = String(ctx?.targetId || sessionId);
        const md: ShipSessionMetadataV1 = {
          v: 1,
          ts: Date.now(),
          sessionId,
          channel,
          targetId,
          actorId: "bot",
          actorName: ctx?.actorName,
          messageId: ctx?.messageId,
          threadId:
            typeof ctx?.threadId === "number" ? ctx.threadId : undefined,
          targetType: ctx?.targetType,
          requestId,
          source: "egress",
          kind: "normal",
          extra: { note: "ai_sdk_ui_message" },
        };

        const uiStream = (result as any).toUIMessageStream({
          sendReasoning: false,
          sendSources: false,
          generateMessageId: () => `a:${sessionId}:${generateId()}`,
          // 关键点（中文）：metadata 通过 ai-sdk 的 UIMessage 生成管线注入，避免我们手工改写最终 message。
          messageMetadata: () => md,
          onFinish: (e: any) => {
            finalAssistantUiMessage = e?.responseMessage ?? null;
          },
        });
        // 关键点（中文）：必须消费完整 UIMessage stream，onFinish 才会触发并产出 responseMessage。
        for await (const _ of uiStream as any) {
          // ignore chunks
        }
      } catch {
        finalAssistantUiMessage = null;
      }

      if (finalAssistantUiMessage) {
        toolCalls.push(...extractToolCallsFromUiMessage(finalAssistantUiMessage));
      }

      // 基于 toolCalls 统计失败摘要（保持旧行为）
      for (const tc of toolCalls) {
        const raw = String(tc.output || "").trim();
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          if (
            parsed &&
            typeof parsed === "object" &&
            "success" in parsed &&
            (parsed as any).success === false
          ) {
            hadToolFailure = true;
            const err =
              (parsed as any).error ||
              (parsed as any).stderr ||
              "unknown error";
            toolFailureSummaries.push(
              `${tc.tool}: ${String(err)}`.slice(0, 200),
            );
          }
        } catch {
          // ignore
        }
      }

      const duration = Date.now() - startTime;
      await logger.log("info", "Agent execution completed", {
        duration,
        toolCallsTotal: toolCalls.length,
      });
      // 关键点（中文）：对话历史由 SessionManager 管理并写入 history（history.jsonl）

      let assistantText = finalAssistantUiMessage
        ? extractTextFromUiMessage(finalAssistantUiMessage)
        : "";
      if (!assistantText) {
        try {
          assistantText = String((await (result as any)?.text) ?? "").trim();
        } catch {
          assistantText = "";
        }
      }
      return {
        success: !hadToolFailure,
        output: [
          assistantText || "Execution completed",
          hadToolFailure
            ? `\n\nTool errors:\n${toolFailureSummaries.map((s) => `- ${s}`).join("\n")}`
            : "",
        ].join(""),
        toolCalls,
        ...(finalAssistantUiMessage
          ? { assistantMessage: finalAssistantUiMessage }
          : {}),
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
          "Context length exceeded, retry with history compaction",
          {
            sessionId,
            error: errorMsg,
            retryAttempts,
          },
        );
        if (retryAttempts >= 3) {
          return {
            success: false,
            output:
              "Context length exceeded and retries failed. Please resend your question (or tune context.history.* compaction settings).",
            toolCalls,
          };
        }

        return this.runWithToolLoopAgent(userText, startTime, sessionId, {
          retryAttempts: retryAttempts + 1,
          requestId,
          drainLaneMerged,
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

  private buildRuntimeSystemMessages(input: {
    projectRoot: string;
    sessionId: string;
    requestId: string;
  }): SystemModelMessage[] {
    const sessionCtx = sessionRequestContext.getStore();
    const runtimeExtraContextLines: string[] = [];

    if (sessionCtx?.channel)
      runtimeExtraContextLines.push(`- Channel: ${sessionCtx.channel}`);
    if (sessionCtx?.targetId)
      runtimeExtraContextLines.push(`- TargetId: ${sessionCtx.targetId}`);
    if (sessionCtx?.actorId)
      runtimeExtraContextLines.push(`- UserId: ${sessionCtx.actorId}`);
    if (sessionCtx?.actorName)
      runtimeExtraContextLines.push(`- Username: ${sessionCtx.actorName}`);

    return [
      {
        role: "system",
        content: buildContextSystemPrompt({
          projectRoot: input.projectRoot,
          sessionId: input.sessionId,
          requestId: input.requestId,
          extraContextLines: runtimeExtraContextLines,
        }),
      },
    ];
  }

  private buildStepOverrides(input: {
    providerResult: SystemPromptProviderResult;
    baseSystemMessages: SystemModelMessage[];
  }): {
    system?: Array<SystemModelMessage>;
    activeTools?: string[];
  } {
    const out: {
      system?: Array<SystemModelMessage>;
      activeTools?: string[];
    } = {};

    if (Array.isArray(input.providerResult.messages)) {
      out.system = input.baseSystemMessages;
    }

    if (
      Array.isArray(input.providerResult.activeTools) &&
      input.providerResult.activeTools.length > 0
    ) {
      out.activeTools = input.providerResult.activeTools;
    }

    return out;
  }

  private resolveCompactPolicy(retryAttempts: number): {
    keepLastMessages: number;
    maxInputTokensApprox: number;
    archiveOnCompact: boolean;
  } {
    const runtime = getShipRuntimeContext();

    const baseKeepLastMessages =
      typeof (runtime.config as any)?.context?.history?.keepLastMessages ===
      "number"
        ? Math.max(
            6,
            Math.min(
              5000,
              Math.floor((runtime.config as any).context.history.keepLastMessages),
            ),
          )
        : 30;
    const baseMaxInputTokensApprox =
      typeof (runtime.config as any)?.context?.history?.maxInputTokensApprox ===
      "number"
        ? Math.max(
            2000,
            Math.min(
              200_000,
              Math.floor(
                (runtime.config as any).context.history.maxInputTokensApprox,
              ),
            ),
          )
        : 12000;

    // 关键点（中文）：当 provider 报错超窗时，会进入 retry；此时需要更激进的 compact。
    const retryFactor = Math.max(1, Math.pow(2, retryAttempts));
    const keepLastMessages = Math.max(
      6,
      Math.floor(baseKeepLastMessages / retryFactor),
    );
    const maxInputTokensApprox = Math.max(
      2000,
      Math.floor(baseMaxInputTokensApprox / retryFactor),
    );
    const archiveOnCompact =
      (runtime.config as any)?.context?.history?.archiveOnCompact === undefined
        ? true
        : Boolean((runtime.config as any).context.history.archiveOnCompact);

    return {
      keepLastMessages,
      maxInputTokensApprox,
      archiveOnCompact,
    };
  }

  private async ensureCurrentUserRecorded(params: {
    historyStore: ReturnType<typeof getShipRuntimeContext>["sessionManager"] extends {
      getHistoryStore: (...args: any[]) => infer T;
    }
      ? T
      : any;
    userText: string;
    sessionId: string;
    requestId: string;
  }): Promise<void> {
    const { historyStore, userText, sessionId, requestId } = params;
    try {
      const msgs = await historyStore.loadAll();
      const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      const lastText = (() => {
        if (!last || last.role !== "user") return "";
        const parts = Array.isArray((last as any).parts) ? (last as any).parts : [];
        return parts
          .filter((p: any) => p && typeof p === "object" && p.type === "text")
          .map((p: any) => String(p.text ?? ""))
          .join("\n")
          .trim();
      })();
      if (lastText && lastText === String(userText || "").trim()) return;

      const ctx = sessionRequestContext.getStore();
      const channel = (ctx?.channel as any) || "api";
      const targetId = String(ctx?.targetId || sessionId);
      const msg = historyStore.createUserTextMessage({
        text: userText,
        metadata: {
          sessionId,
          channel,
          targetId,
          actorId: ctx?.actorId,
          actorName: ctx?.actorName,
          messageId: ctx?.messageId,
          threadId: typeof ctx?.threadId === "number" ? ctx.threadId : undefined,
          targetType: ctx?.targetType,
          requestId,
          extra: { note: "injected_by_agent_run" },
        } as any,
      });
      await historyStore.append(msg);
    } catch {
      // ignore
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
