/**
 * ContextAgentRunner：单会话 Agent 执行器。
 *
 * 关键职责（中文）
 * - 组装 system prompt（运行时上下文 + providers）。
 * - 执行 tool-loop，并把 assistant/tool 调用结果回写 context 消息。
 * - 在上下文超窗时按策略逐步收紧 compact 参数并重试。
 */

import {
  generateText,
  streamText,
  stepCountIs,
  Tool,
  type LanguageModel,
  type ModelMessage,
  type SystemModelMessage,
} from "ai";
import { withLlmRequestContext } from "../../logger/index.js";
import { generateId } from "../../utils.js";
import {
  buildContextSystemPrompt,
  transformPromptsIntoSystemMessages,
} from "../prompts/system.js";
import { createModel } from "../llm/create-model.js";
import type { AgentRunInput, AgentResult } from "../types/agent.js";
import type { Logger } from "../../logger/index.js";
import { contextRequestContext } from "../context/request-context.js";
import { createAgentTools } from "../tools/agent-tools.js";
import { openai } from "@ai-sdk/openai";
import type { ShipContextMetadataV1 } from "../types/context-message.js";
import {
  getShipRuntimeContext,
  getShipRuntimeContextBase,
} from "../../server/ShipRuntimeContext.js";
import type { ContextAgent } from "../types/context-agent.js";
import { collectSystemPromptProviderResult } from "../prompts/index.js";
import {
  extractTextFromUiMessage,
  extractToolCallsFromUiMessage,
} from "./ui-message.js";
import type { SystemPromptProviderResult } from "../types/system-prompt-provider.js";

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
    return getShipRuntimeContextBase().logger;
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

    return {
      success: false,
      output:
        "LLM is not configured (or runtime not initialized). Please configure `ship.json.llm` (model + apiKey) and restart.",
      toolCalls: [],
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
      laneMergeAttempts?: number;
      drainLaneMerged?: AgentRunInput["drainLaneMerged"];
      requestId?: string;
    },
  ): Promise<AgentResult> {
    const toolCalls: AgentResult["toolCalls"] = [];
    let hadToolFailure = false;
    const toolFailureSummaries: string[] = [];
    const retryAttempts = opts?.retryAttempts ?? 0;
    const laneMergeAttempts = opts?.laneMergeAttempts ?? 0;
    const drainLaneMerged = opts?.drainLaneMerged;
    const requestId = opts?.requestId || "";
    const logger = this.getLogger();
    if (!this.initialized) {
      throw new Error("Agent not initialized");
    }

    try {
      this.bindContextId(contextId);

      const runtime = getShipRuntimeContext();
      // phase 0（中文）：装配 context store 与 runtime/system prompt 基础上下文。
      const contextStore = runtime.contextManager.getContextStore(contextId);

      const runtimeSystemMessages = this.buildRuntimeSystemMessages({
        projectRoot: runtime.rootPath,
        contextId,
        requestId,
      });

      // 先确保本轮 user 已写入 context store（best-effort）
      await this.ensureCurrentUserRecorded({
        contextStore,
        userText,
        contextId,
        requestId,
      });

      // phase 1（中文）：收集 provider 结果（附加系统消息 + activeTools）。
      const providerResult = await collectSystemPromptProviderResult({
        projectRoot: runtime.rootPath,
        contextId,
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
        const compactResult = await contextStore.compactIfNeeded({
          model: this.model,
          system: baseSystemMessages,
          keepLastMessages: compactPolicy.keepLastMessages,
          maxInputTokensApprox: compactPolicy.maxInputTokensApprox,
          archiveOnCompact: compactPolicy.archiveOnCompact,
        });
        compacted = Boolean((compactResult as any)?.compacted);
      } catch {
        // ignore compact failure; fallback to un-compacted context messages
      }

      let currentProviderResult = providerResult;
      if (compacted) {
        // 关键点（中文）：compact 后重新聚合 provider，保证 prompt 与 activeTools 同步最新状态。
        currentProviderResult = await collectSystemPromptProviderResult({
          projectRoot: runtime.rootPath,
          contextId,
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
        (await contextStore.toModelMessages({ tools: this.tools })) as any;
      if (!Array.isArray(baseModelMessages) || baseModelMessages.length === 0) {
        baseModelMessages = [{ role: "user", content: userText } as any];
      }

      await logger.log("debug", "Context selected", {
        contextId,
        historySource: "messages_jsonl",
        modelMessages: baseModelMessages.length,
        keepLastMessages: compactPolicy.keepLastMessages,
        maxInputTokensApprox: compactPolicy.maxInputTokensApprox,
      });

      // 关键点（中文）
      // - AI SDK 的 tool-loop 会把 tool call / tool output 以 messages 的形式串起来（in-flight）。
      // - lane merge 到来时，我们需要把“新入队 user 消息”并入前缀，并保留后缀 tool 链。
      let lastAppliedBasePrefixLen = baseModelMessages.length;
      let needsLaneResync = false;

      const appendMergedLaneMessages = (
        messages: Array<{ text: string }> | undefined,
      ): { added: number; latestUserText?: string } => {
        if (!Array.isArray(messages) || messages.length === 0) return { added: 0 };
        const toAppend: ModelMessage[] = [];
        let latestUserText: string | undefined;
        for (const m of messages) {
          const text = String((m as any)?.text ?? "").trim();
          if (!text) continue;
          toAppend.push({ role: "user", content: text } as any);
          latestUserText = text;
        }
        if (toAppend.length > 0) {
          baseModelMessages = [...baseModelMessages, ...toAppend] as any;
        }
        return { added: toAppend.length, latestUserText };
      };

      const reloadModelMessages = async (
        trigger: string,
      ): Promise<{
        reloaded: boolean;
        drained?: number;
        added?: number;
        latestUserText?: string;
      }> => {
        if (typeof drainLaneMerged !== "function") return { reloaded: false };
        try {
          const r = await drainLaneMerged();
          const drained =
            r && typeof (r as any).drained === "number"
              ? (r as any).drained
              : 0;
          if (drained <= 0) return { reloaded: false, drained: 0 };
          const mergedMessages = Array.isArray((r as any)?.messages)
            ? ((r as any).messages as Array<{ text: string }>)
            : [];
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
            ...(appended.latestUserText
              ? { latestUserText: appended.latestUserText }
              : {}),
          };
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
              // 关键点（中文）：工具结束后立即检查 lane 是否有新消息；若有则并入消息前缀。
              await reloadModelMessages(`after_tool:${toolName}`);
            }
          },
        } as any;
      }

      // phase 2（中文）：进入 tool-loop。
      const result = await withLlmRequestContext({ contextId, requestId }, () => {
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

            // 1) 在每个 step 前先检查 lane 是否有新消息；若有则从队列并入 user 消息。
            await reloadModelMessages("before_step");

            // 2) messages：默认保留 tool-loop 的 in-flight messages（包含 tool call/output 链）。
            // 若 lane 已变化，则替换“前缀 base”，并保留后缀 tool 链。
            let outMessages: ModelMessage[] | undefined;
            if (needsLaneResync) {
              outMessages = [...(baseModelMessages as any), ...suffix] as any;
              needsLaneResync = false;
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

      // phase 3（中文）：把 stream 结果固化为最终 assistant UIMessage。
      // 关键点（中文）：用 ai-sdk v6 的 UIMessage 流来生成最终 assistant UIMessage（包含 tool parts），避免手工拼装。
      let finalAssistantUiMessage: any = null;
      try {
        const ctx = contextRequestContext.getStore();
        const channel = (ctx?.channel as any) || "api";
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

        const uiStream = (result as any).toUIMessageStream({
          sendReasoning: false,
          sendSources: false,
          generateMessageId: () => `a:${contextId}:${generateId()}`,
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

      // 关键点（中文）
      // - 对“无工具调用的单轮 LLM”场景，若本轮结束时 lane 收到新消息，
      //   当前结果通常已经过时；这里做一次轻量重跑（最多 2 轮）来吸收最新输入。
      // - 仅在 toolCalls=0 时启用，避免重复执行工具带来副作用。
      if (
        toolCalls.length === 0 &&
        laneMergeAttempts < 2 &&
        typeof drainLaneMerged === "function"
      ) {
        const postRunMerge = await reloadModelMessages("after_llm_complete");
        if (postRunMerge.reloaded) {
          const latestUserText = String(
            postRunMerge.latestUserText || userText || "",
          );
          await logger.log(
            "info",
            "Detected new lane messages right after LLM completion; rerunning once to absorb latest input",
            {
              contextId,
              requestId,
              drained: postRunMerge.drained || 0,
              laneMergeAttempts,
            },
          );
          return this.runWithToolLoopAgent(latestUserText, startTime, contextId, {
            retryAttempts,
            laneMergeAttempts: laneMergeAttempts + 1,
            requestId,
            drainLaneMerged,
          });
        }
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

      // phase 4（中文）：统计结果并返回标准 AgentResult。
      const duration = Date.now() - startTime;
      await logger.log("info", "Agent execution completed", {
        duration,
        toolCallsTotal: toolCalls.length,
      });
      // 关键点（中文）：对话消息由 ContextManager 管理并写入 messages（messages.jsonl）

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
        output: assistantText || "Execution completed",
        toolCalls,
        ...(finalAssistantUiMessage
          ? { assistantMessage: finalAssistantUiMessage }
          : {}),
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
            output:
              "Context length exceeded and retries failed. Please resend your question (or tune context.messages.* compaction settings).",
            toolCalls,
          };
        }

        return this.runWithToolLoopAgent(userText, startTime, contextId, {
          retryAttempts: retryAttempts + 1,
          laneMergeAttempts,
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

    if (contextCtx?.channel)
      runtimeExtraContextLines.push(`- Channel: ${contextCtx.channel}`);
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
   * 构造 step 覆盖配置。
   *
   * 关键点（中文）
   * - provider 有 messages 时，用运行时系统消息替换默认系统消息。
   * - provider 有 activeTools 时，收敛可用工具集合。
   */
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

    const baseKeepLastMessages =
      typeof (runtime.config as any)?.context?.messages?.keepLastMessages ===
      "number"
        ? Math.max(
            6,
            Math.min(
              5000,
              Math.floor((runtime.config as any).context.messages.keepLastMessages),
            ),
          )
        : 30;
    const baseMaxInputTokensApprox =
      typeof (runtime.config as any)?.context?.messages?.maxInputTokensApprox ===
      "number"
        ? Math.max(
            2000,
            Math.min(
              200_000,
              Math.floor(
                (runtime.config as any).context.messages.maxInputTokensApprox,
              ),
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
      (runtime.config as any)?.context?.messages?.archiveOnCompact === undefined
        ? true
        : Boolean((runtime.config as any).context.messages.archiveOnCompact);

    return {
      keepLastMessages,
      maxInputTokensApprox,
      archiveOnCompact,
    };
  }

  /**
   * 确保当前用户消息已经落盘。
   *
   * 关键点（中文）
   * - 某些入口可能未提前 append user message；这里兜底补写。
   * - 通过“最后一条 user 文本相等”做幂等，避免重复写入。
   */
  private async ensureCurrentUserRecorded(params: {
    contextStore: ReturnType<typeof getShipRuntimeContext>["contextManager"] extends {
      getContextStore: (...args: any[]) => infer T;
    }
      ? T
      : any;
    userText: string;
    contextId: string;
    requestId: string;
  }): Promise<void> {
    const { contextStore, userText, contextId, requestId } = params;
    try {
      const msgs = await contextStore.loadAll();
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

      const ctx = contextRequestContext.getStore();
      const channel = (ctx?.channel as any) || "api";
      const targetId = String(ctx?.targetId || contextId);
      const msg = contextStore.createUserTextMessage({
        text: userText,
        metadata: {
          contextId,
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
      await contextStore.append(msg);
    } catch {
      // ignore
    }
  }

  /**
   * 是否已完成初始化。
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}
