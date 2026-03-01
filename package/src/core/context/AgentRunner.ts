/**
 * ContextAgentRunner：单会话 Agent 执行器。
 *
 * 关键职责（中文）
 * - 组装 system prompt（运行时上下文 + providers）。
 * - 执行 tool-loop，并把 assistant/tool 调用结果回写 context 消息。
 * - 在上下文超窗时按策略逐步收紧 compact 参数并重试。
 */

import {
  streamText,
  stepCountIs,
  Tool,
  type LanguageModel,
  type ModelMessage,
  type SystemModelMessage,
} from "ai";
import { withLlmRequestContext } from "../../utils/logger/Context.js";
import { generateId } from "../../main/utils/Id.js";
import {
  buildContextSystemPrompt,
  transformPromptsIntoSystemMessages,
} from "../prompts/System.js";
import { createModel } from "../llm/CreateModel.js";
import type { AgentRunInput, AgentResult } from "../types/Agent.js";
import type { Logger } from "../../utils/logger/Logger.js";
import {
  contextRequestContext,
  type ContextRequestContext,
} from "./RequestContext.js";
import { openai } from "@ai-sdk/openai";
import type {
  ShipContextChannel,
  ShipContextMessageV1,
  ShipContextMetadataV1,
} from "../types/ContextMessage.js";
import {
  getShipRuntimeContext,
  getRuntimeContextBase,
} from "../../main/runtime/ShipRuntimeContext.js";
import type { ContextAgent } from "../types/ContextAgent.js";
import { collectSystemPromptProviderResult } from "../prompts/SystemProvider.js";
import type { ContextStore } from "./ContextStore.js";
import { loadProjectDotenv } from "../../main/project/Config.js";
import { shellTools } from "../shell/Tool.js";

function toShipContextChannel(
  chat: ContextRequestContext["chat"] | undefined,
): ShipContextChannel {
  return chat ?? "api";
}

export class ContextAgentRunner implements ContextAgent {
  // 是否初始化
  private initialized: boolean = false;
  // 模型
  private model: LanguageModel = openai("gpt-5.2");

  private tools: Record<string, Tool> = {};
  /**
   * contextId 绑定检查。
   *
   * 关键点（中文）
   * - 运行时策略是"一个 contextId 一个 Agent 实例"（由 ContextManager 保证）
   * - 本实例一旦首次 run 绑定到某个 contextId，后续必须一致，避免上下文串线
   */
  private boundContextId: string | null = null;

  constructor() {}

  /**
   * 获取运行时 logger。
   */
  getLogger(): Logger {
    return getRuntimeContextBase().logger;
  }

  /**
   * 初始化 Agent 运行依赖。
   *
   * 流程（中文）
   * 1) 构建工具集合
   * 2) 根据 ship.json 创建模型实例
   * 3) 标记 initialized=true
   */
  async initialize(): Promise<void> {
    try {
      // 注意：不要在模块顶层读取 runtime context，否则像 `sma -v` 这种只打印版本号的场景也会因为未初始化而崩溃
      const runtime = getShipRuntimeContext();
      loadProjectDotenv(runtime.rootPath);
      this.tools = { ...shellTools };

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

  /**
   * run：对外统一入口。
   *
   * 流程（中文）
   * 1) 记录 requestId 与日志
   * 2) 检查初始化状态
   * 3) 进入 tool-loop 主流程
   */
  async run(input: AgentRunInput): Promise<AgentResult> {
    const { query, contextId, drainLaneMerged } = input;
    const startTime = Date.now();
    const requestId = generateId();
    const logger = this.getLogger();

    await logger.log("debug", `ContextId: ${contextId}`);
    await logger.log("info", "Agent request started", {
      requestId,
      contextId,
      instructionsPreview: query?.slice(0, 200),
      rootPath: getShipRuntimeContext().rootPath,
    });
    if (this.initialized) {
      return this.runWithToolLoopAgent(query, startTime, contextId, {
        requestId,
        drainLaneMerged,
      });
    }

    let contextStore: ContextStore | null = null;
    try {
      contextStore = getShipRuntimeContext().contextManager.getContextStore(
        contextId,
      );
    } catch {
      contextStore = null;
    }
    return {
      success: false,
      assistantMessage: this.buildFallbackAssistantMessage({
        contextId,
        requestId,
        contextStore,
        text:
          "LLM is not configured (or runtime not initialized). Please configure `ship.json.llm` (model + apiKey) and restart.",
        note: "agent_not_initialized",
      }),
    };
  }

  /**
   * 绑定 contextId（单实例单会话约束）。
   */
  private bindContextId(contextId: string): string {
    const key = String(contextId || "").trim();
    if (!key) throw new Error("Agent.run requires a non-empty contextId");
    if (this.boundContextId && this.boundContextId !== key) {
      // 关键点（中文）：一个 Agent 实例只允许服务一个 contextId，避免上下文串线。
      throw new Error(
        `Agent is already bound to contextId=${this.boundContextId}, got contextId=${key}`,
      );
    }
    this.boundContextId = key;
    return key;
  }

  /**
   * tool-loop 主执行流程。
   *
   * 算法步骤（中文）
   * - 绑定 contextId，防止一个实例跨会话串线。
   * - 读取/补齐用户消息到 context store（防止入口未写入）。
   * - 收集 system prompt providers，得到 activeTools 与附加系统消息。
   * - 执行模型调用；若超窗则按 compact policy 递进重试。
   */
  private async runWithToolLoopAgent(
    userText: string,
    startTime: number,
    contextId: string,
    opts?: {
      retryAttempts?: number;
      requestId?: string;
      drainLaneMerged?: AgentRunInput["drainLaneMerged"];
    },
  ): Promise<AgentResult> {
    let contextStore: ContextStore | null = null;
    const retryAttempts = opts?.retryAttempts ?? 0;
    const requestId = opts?.requestId || "";
    const drainLaneMerged = opts?.drainLaneMerged;
    const logger = this.getLogger();
    if (!this.initialized) {
      throw new Error("Agent not initialized");
    }

    try {
      this.bindContextId(contextId);

      const runtime = getShipRuntimeContext();
      // phase 0（中文）：装配 context store 与 runtime/system prompt 基础上下文。
      contextStore = runtime.contextManager.getContextStore(contextId);

      const runtimeSystemMessages = this.buildRuntimeSystemMessages({
        projectRoot: runtime.rootPath,
        contextId,
        requestId,
      });

      const staticSystemMessages = transformPromptsIntoSystemMessages([
        ...runtime.systems,
      ]);
      let currentProviderResult = await collectSystemPromptProviderResult({
        projectRoot: runtime.rootPath,
        contextId,
        requestId,
        allToolNames: Object.keys(this.tools),
      });
      let currentBaseSystemMessages: SystemModelMessage[] = [
        ...runtimeSystemMessages,
        ...staticSystemMessages,
        ...currentProviderResult.messages,
      ];

      const compactPolicy = this.resolveCompactPolicy(retryAttempts);
      let compacted = false;
      try {
        const compactResult = await contextStore.compactIfNeeded({
          model: this.model,
          system: currentBaseSystemMessages,
          keepLastMessages: compactPolicy.keepLastMessages,
          maxInputTokensApprox: compactPolicy.maxInputTokensApprox,
          archiveOnCompact: compactPolicy.archiveOnCompact,
        });
        compacted = Boolean(compactResult.compacted);
      } catch {
        // ignore compact failure; fallback to un-compacted context messages
      }
      if (compacted) {
        // 关键点（中文）：compact 后重新聚合 provider，保证 prompt 与 activeTools 同步最新状态。
        currentProviderResult = await collectSystemPromptProviderResult({
          projectRoot: runtime.rootPath,
          contextId,
          requestId,
          allToolNames: Object.keys(this.tools),
        });
        currentBaseSystemMessages = [
          ...runtimeSystemMessages,
          ...staticSystemMessages,
          ...currentProviderResult.messages,
        ];
      }

      let baseModelMessages: ModelMessage[] =
        await contextStore.toModelMessages({
          tools: this.tools,
        });
      if (!Array.isArray(baseModelMessages) || baseModelMessages.length === 0) {
        baseModelMessages = [{ role: "user", content: userText }];
      }

      await logger.log("debug", "Context selected", {
        contextId,
        historySource: "messages_jsonl",
        modelMessages: baseModelMessages.length,
        keepLastMessages: compactPolicy.keepLastMessages,
        maxInputTokensApprox: compactPolicy.maxInputTokensApprox,
      });

      // 关键点（中文）
      // - 在 step 边界尝试合并新消息，保证下一步使用最新输入。
      // - 保留 tool-loop 的 in-flight 后缀消息（工具调用链）。
      let lastAppliedBasePrefixLen = baseModelMessages.length;
      let needsLaneResync = false;

      const appendMergedLaneMessages = (
        messages: Array<{ text: string }> | undefined,
      ): { added: number } => {
        if (!Array.isArray(messages) || messages.length === 0)
          return { added: 0 };
        const toAppend: ModelMessage[] = [];
        for (const m of messages) {
          const text = String(m?.text ?? "").trim();
          if (!text) continue;
          toAppend.push({ role: "user", content: text });
        }
        if (toAppend.length > 0) {
          baseModelMessages = [...baseModelMessages, ...toAppend];
        }
        return { added: toAppend.length };
      };

      const reloadModelMessages = async (
        trigger: string,
      ): Promise<{ reloaded: boolean; drained?: number; added?: number }> => {
        if (typeof drainLaneMerged !== "function") return { reloaded: false };
        try {
          const r = await drainLaneMerged();
          const drained = r && typeof r.drained === "number" ? r.drained : 0;
          if (drained <= 0) return { reloaded: false, drained: 0 };
          const mergedMessages = Array.isArray(r?.messages) ? r.messages : [];
          const appended = appendMergedLaneMessages(mergedMessages);
          needsLaneResync = true;
          void logger.log(
            "debug",
            "Lane merged messages detected; appended queued user messages for next step",
            {
              contextId,
              requestId,
              trigger,
              drained,
              appended: appended.added,
            },
          );
          return {
            reloaded: true,
            drained,
            added: appended.added,
          };
        } catch {
          return { reloaded: false };
        }
      };

      // phase 2（中文）：进入 tool-loop。
      const result = await withLlmRequestContext(
        { contextId, requestId },
        () => {
          return streamText({
            model: this.model,
            system: currentBaseSystemMessages,
            prepareStep: async ({ messages }) => {
              const incomingMessages: ModelMessage[] = Array.isArray(messages)
                ? messages
                : [];
              const suffix =
                incomingMessages.length >= lastAppliedBasePrefixLen
                  ? incomingMessages.slice(lastAppliedBasePrefixLen)
                  : [];

              await reloadModelMessages("before_step");

              let outMessages: ModelMessage[] | undefined;
              if (needsLaneResync) {
                outMessages = [...baseModelMessages, ...suffix];
                needsLaneResync = false;
                lastAppliedBasePrefixLen = Array.isArray(baseModelMessages)
                  ? baseModelMessages.length
                  : 0;
              }

              const stepOverrides: {
                system?: Array<SystemModelMessage>;
                activeTools?: string[];
              } = {
                system: currentBaseSystemMessages,
              };
              if (
                Array.isArray(currentProviderResult.activeTools) &&
                currentProviderResult.activeTools.length > 0
              ) {
                stepOverrides.activeTools = currentProviderResult.activeTools;
              }
              return {
                ...stepOverrides,
                ...(Array.isArray(outMessages)
                  ? { messages: outMessages }
                  : {}),
              };
            },
            messages: baseModelMessages,
            tools: this.tools,
            stopWhen: [stepCountIs(30)],
          });
        },
      );

      // phase 3（中文）：把 stream 结果固化为最终 assistant UIMessage。
      // 关键点（中文）：用 ai-sdk v6 的 UIMessage 流来生成最终 assistant UIMessage（包含 tool parts），避免手工拼装。
      let finalAssistantUiMessage: ShipContextMessageV1 | null = null;
      try {
        const ctx = contextRequestContext.getStore();
        const channel = toShipContextChannel(ctx?.chat);
        const targetId = String(ctx?.targetId || contextId);
        const md: ShipContextMetadataV1 = {
          v: 1,
          ts: Date.now(),
          contextId,
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

        const uiStream = result.toUIMessageStream<ShipContextMessageV1>({
          sendReasoning: false,
          sendSources: false,
          generateMessageId: () => `a:${contextId}:${generateId()}`,
          // 关键点（中文）：metadata 通过 ai-sdk 的 UIMessage 生成管线注入，避免我们手工改写最终 message。
          messageMetadata: () => md,
          onFinish: (event) => {
            finalAssistantUiMessage = event.responseMessage ?? null;
          },
        });
        // 关键点（中文）：必须消费完整 UIMessage stream，onFinish 才会触发并产出 responseMessage。
        for await (const _ of uiStream) {
          // ignore chunks
        }
      } catch {
        finalAssistantUiMessage = null;
      }

      // phase 4（中文）：统计结果并返回标准 AgentResult。
      const duration = Date.now() - startTime;
      await logger.log("info", "Agent execution completed", {
        duration,
      });
      // 关键点（中文）：对话消息由 ContextManager 管理并写入 messages（messages.jsonl）

      if (!finalAssistantUiMessage) {
        let assistantText = "";
        try {
          assistantText = String((await result.text) ?? "").trim();
        } catch {
          assistantText = "";
        }
        finalAssistantUiMessage = this.buildFallbackAssistantMessage({
          contextId,
          requestId,
          contextStore,
          text: assistantText || "Execution completed",
          note: "assistant_message_fallback",
        });
      }
      return {
        success: true,
        assistantMessage: finalAssistantUiMessage,
      };
    } catch (error) {
      const errorMsg = String(error);
      // 超窗重试策略（中文）：识别 context window 类错误并触发 compact 递进重试。
      if (
        errorMsg.includes("context_length") ||
        errorMsg.includes("too long") ||
        errorMsg.includes("maximum context") ||
        errorMsg.includes("context window")
      ) {
        await logger.log(
          "warn",
          "Context length exceeded, retry with messages compaction",
          {
            contextId,
            error: errorMsg,
            retryAttempts,
          },
        );
        if (retryAttempts >= 3) {
          return {
            success: false,
            assistantMessage: this.buildFallbackAssistantMessage({
              contextId,
              requestId,
              contextStore,
              text:
                "Context length exceeded and retries failed. Please resend your question (or tune context.messages.* compaction settings).",
              note: "context_length_exceeded",
            }),
          };
        }

        return this.runWithToolLoopAgent(userText, startTime, contextId, {
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
        assistantMessage: this.buildFallbackAssistantMessage({
          contextId,
          requestId,
          contextStore,
          text: `Execution failed: ${errorMsg}`,
          note: "agent_execution_failed",
        }),
      };
    }
  }

  /**
   * 构建运行时 system message。
   *
   * 关键点（中文）
   * - 将 context request-context（channel/target/user）注入到 system prompt。
   */
  private buildRuntimeSystemMessages(input: {
    projectRoot: string;
    contextId: string;
    requestId: string;
  }): SystemModelMessage[] {
    const contextCtx = contextRequestContext.getStore();
    const runtimeExtraContextLines: string[] = [];

    if (contextCtx?.chat)
      runtimeExtraContextLines.push(`- Channel: ${contextCtx.chat}`);
    if (contextCtx?.targetId)
      runtimeExtraContextLines.push(`- TargetId: ${contextCtx.targetId}`);
    if (contextCtx?.actorId)
      runtimeExtraContextLines.push(`- UserId: ${contextCtx.actorId}`);
    if (contextCtx?.actorName)
      runtimeExtraContextLines.push(`- Username: ${contextCtx.actorName}`);

    return [
      {
        role: "system",
        content: buildContextSystemPrompt({
          projectRoot: input.projectRoot,
          contextId: input.contextId,
          requestId: input.requestId,
          extraContextLines: runtimeExtraContextLines,
        }),
      },
    ];
  }

  /**
   * 构造 fallback assistant 消息。
   *
   * 关键点（中文）
   * - 仅在 UIMessage 生成失败/异常时兜底使用
   * - metadata 尽量与正常 assistant 消息保持一致
   */
  private buildFallbackAssistantMessage(params: {
    contextId: string;
    text: string;
    requestId?: string;
    contextStore?: ContextStore | null;
    note: string;
  }): ShipContextMessageV1 {
    const ctx = contextRequestContext.getStore();
    const channel = toShipContextChannel(ctx?.chat);
    const targetId = String(ctx?.targetId || params.contextId);
    const metadata: Omit<ShipContextMetadataV1, "v" | "ts"> = {
      contextId: params.contextId,
      channel,
      targetId,
      actorId: "bot",
      actorName: ctx?.actorName,
      messageId: ctx?.messageId,
      threadId: typeof ctx?.threadId === "number" ? ctx.threadId : undefined,
      targetType: ctx?.targetType,
      requestId: params.requestId,
      extra: { note: params.note },
    };
    const finalText = String(params.text ?? "").trim() || "Execution completed";
    const store = params.contextStore || null;
    if (store) {
      return store.createAssistantTextMessage({
        text: finalText,
        metadata,
        kind: "normal",
        source: "egress",
      });
    }
    const md: ShipContextMetadataV1 = {
      v: 1,
      ts: Date.now(),
      ...metadata,
      source: "egress",
      kind: "normal",
    };
    return {
      id: `a:${params.contextId}:${generateId()}`,
      role: "assistant",
      metadata: md,
      parts: [{ type: "text", text: finalText }],
    };
  }

  /**
   * 计算 compact 重试策略。
   *
   * 算法说明（中文）
   * - retry 次数越高，keepLastMessages/maxInputTokensApprox 越小（指数收缩）。
   * - 目标是在不直接失败的前提下，尽量保留可用上下文。
   */
  private resolveCompactPolicy(retryAttempts: number): {
    keepLastMessages: number;
    maxInputTokensApprox: number;
    archiveOnCompact: boolean;
  } {
    const runtime = getShipRuntimeContext();
    const contextMessagesConfig = runtime.config.context?.messages;

    const baseKeepLastMessages =
      typeof contextMessagesConfig?.keepLastMessages === "number"
        ? Math.max(
            6,
            Math.min(5000, Math.floor(contextMessagesConfig.keepLastMessages)),
          )
        : 30;
    const baseMaxInputTokensApprox =
      typeof contextMessagesConfig?.maxInputTokensApprox === "number"
        ? Math.max(
            2000,
            Math.min(
              200_000,
              Math.floor(contextMessagesConfig.maxInputTokensApprox),
            ),
          )
        : 16000;

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
      contextMessagesConfig?.archiveOnCompact === undefined
        ? true
        : Boolean(contextMessagesConfig.archiveOnCompact);

    return {
      keepLastMessages,
      maxInputTokensApprox,
      archiveOnCompact,
    };
  }

  /**
   * 是否已完成初始化。
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}
