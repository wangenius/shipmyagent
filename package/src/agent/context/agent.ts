import {
  generateText,
  stepCountIs,
  Tool,
  type LanguageModel,
  type ModelMessage,
  type SystemModelMessage,
} from "ai";
import { withLlmRequestContext } from "../../telemetry/index.js";
import {
  generateId,
  getShipChatMemoryPrimaryPath,
  getShipProfileOtherPath,
  getShipProfilePrimaryPath,
} from "../../utils.js";
import {
  buildContextSystemPrompt,
  transformPromptsIntoSystemMessages,
} from "./prompt.js";
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
import { chatRequestContext } from "../../chat/context/request-context.js";
import { withToolExecutionContext } from "../tools/builtin/execution-context.js";
import { createAgentTools } from "../tools/set/agent-tools.js";
import { openai } from "@ai-sdk/openai";
import { toolExecutionContext } from "../tools/builtin/execution-context.js";
import { ChatStore } from "../../chat/store/store.js";

export function pickLastSuccessfulChatSendText(toolCalls: any[]): string {
  // 关键点（中文）：优先从 chat_send 的 input.text 还原"用户可见回复"，因为 tool-strict 下 result.text 可能为空。
  for (let i = toolCalls.length - 1; i >= 0; i -= 1) {
    const tc = toolCalls[i];
    if (!tc) continue;
    if (String(tc.tool || "") !== "chat_send") continue;
    const text = String((tc.input as any)?.text ?? "").trim();
    if (!text) continue;
    const raw = String(tc.output || "").trim();
    if (!raw) return text; // 无输出时 best-effort 认为成功
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && (parsed as any).success === true) return text;
    } catch {
      // unknown format：best-effort 使用 text
      return text;
    }
  }
  return "";
}

export class Agent {
  // 配置
  private configs: AgentConfigurations;
  // 是否初始化
  private initialized: boolean = false;
  // 模型
  private model: LanguageModel = openai("gpt-5.2");

  private tools: Record<string, Tool> = {};
  /**
   * chatKey 绑定检查。
   *
   * 关键点（中文）
   * - 运行时策略是"一个 chatKey 一个 Agent 实例"（由 ChatRuntime 保证）
   * - 本实例一旦首次 run 绑定到某个 chatKey，后续必须一致，避免上下文串线
   */
  private boundChatKey: string | null = null;

  constructor(configs: AgentConfigurations) {
    this.configs = configs;
  }

  getLogger(): Logger {
    return getLogger(this.configs.projectRoot, "info");
  }

  async initialize(): Promise<void> {
    try {
      this.tools = createAgentTools({
        projectRoot: this.configs.projectRoot,
        config: this.configs.config,
      });

      this.model = await createModel({
        config: this.configs.config,
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
    const { query, chatKey, onStep, drainLaneMergedText, chatRuntime } = input;
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
    if (this.initialized) {
      return this.runWithToolLoopAgent(query, startTime, chatKey, {
        onStep,
        drainLaneMergedText,
        requestId,
        chatRuntime,
      });
    }

    return {
      success: false,
      output:
        "LLM is not configured (or runtime not initialized). Please configure `ship.json.llm` (model + apiKey) and restart.",
      toolCalls: [],
    };
  }

  private bindChatKey(chatKey: string): string {
    const key = String(chatKey || "").trim();
    if (!key) throw new Error("Agent.run requires a non-empty chatKey");
    if (this.boundChatKey && this.boundChatKey !== key) {
      // 关键点（中文）：一个 Agent 实例只允许服务一个 chatKey，避免上下文串线。
      throw new Error(
        `Agent is already bound to chatKey=${this.boundChatKey}, got chatKey=${key}`,
      );
    }
    this.boundChatKey = key;
    return key;
  }

  private async runWithToolLoopAgent(
    userText: string,
    startTime: number,
    chatKey: string,
    opts?: {
      retryAttempts?: number;
      onStep?: AgentRunInput["onStep"];
      drainLaneMergedText?: AgentRunInput["drainLaneMergedText"];
      requestId?: string;
      chatRuntime?: any;
    },
  ): Promise<AgentResult> {
    const toolCalls: AgentResult["toolCalls"] = [];
    let hadToolFailure = false;
    const toolFailureSummaries: string[] = [];
    const retryAttempts = opts?.retryAttempts ?? 0;
    const onStep = opts?.onStep;
    const drainLaneMergedText = opts?.drainLaneMergedText;
    const requestId = opts?.requestId || "";
    const chatRuntime = opts?.chatRuntime;
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

    if (!this.initialized) {
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

      // 运行时 system prompt（每次请求都注入，包含 chatKey/requestId/来源等）。
      // 关键点：这段信息是“强时效/强关联本次请求”的上下文，不应该缓存到启动 prompts 里。
      const runtimeExtraContextLines: string[] = [];
      const chatCtx = chatRequestContext.getStore();
      if (chatCtx?.channel)
        runtimeExtraContextLines.push(`- Channel: ${chatCtx.channel}`);
      if (chatCtx?.chatId)
        runtimeExtraContextLines.push(`- ChatId: ${chatCtx.chatId}`);
      if (chatCtx?.userId)
        runtimeExtraContextLines.push(`- UserId: ${chatCtx.userId}`);
      if (chatCtx?.username)
        runtimeExtraContextLines.push(`- Username: ${chatCtx.username}`);

      systemExtras.push({
        role: "system",
        content: buildContextSystemPrompt({
          projectRoot: this.configs.projectRoot,
          chatKey,
          requestId,
          extraContextLines: runtimeExtraContextLines,
        }),
      });

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

      // 工作上下文来源（中文，关键点）
      // - 每次 run 都从 ChatStore 实时加载最近 10 条历史消息（纯文本格式）
      // - 简化策略：无内存缓存、无 active.jsonl、只从 history.jsonl 读取
      // - 文本格式避免了 tool_calls 的复杂格式转换问题
      // - 注意：历史对话会在 prepareStep 中注入，确保在所有 base system prompts 之后
      this.bindChatKey(chatKey);

      const chatStore = new ChatStore({
        projectRoot: this.configs.projectRoot,
        chatKey: chatKey,
      });

      // 从配置读取历史消息加载参数
      const historyLimit =
        this.configs.config?.context?.chatHistory?.transcriptMaxMessages ?? 50;
      const historyMaxChars =
        this.configs.config?.context?.chatHistory?.transcriptMaxChars ?? 25000;

      const historyText = await chatStore.loadRecentMessagesAsText(
        historyLimit,
        historyMaxChars,
      );

      // in-flight messages = 仅包含当前用户消息（历史已通过 system 注入）
      const currentUserMessage: ModelMessage = { role: "user", content: userText } as any;
      const inFlightMessages: ModelMessage[] = [currentUserMessage];

      await logger.log("debug", "Context injection selected", {
        chatKey,
        historySource: "history_jsonl",
        activeMessages: Array.isArray(inFlightMessages) ? inFlightMessages.length : 0,
      });

      // system messages 需要保持聚合在 messages 开头，工具注入 system 指令时应插到它们之后。
      let systemMessageInsertIndex = 0;

      // 关键点（中文）：system prompt 每次 run 独立注入，不污染历史记录。
      const runtimeSystemMessages: SystemModelMessage[] = systemExtras
        .filter((m) => (m as any)?.role === "system")
        .map((m) => ({ role: "system", content: String((m as any)?.content ?? "") }));

      const baseSystemMessages: SystemModelMessage[] = [
        ...runtimeSystemMessages,
        ...transformPromptsIntoSystemMessages([...this.configs.systems]),
      ];
      const allToolNames = Object.keys(this.tools);

      /**
       * lane "快速矫正"合并。
       *
       * 关键点（中文）
       * - 现在只维护一个简单的 user message（当前轮），lane 合并内容会追加到它末尾
       * - 由于历史已通过 system 注入，不再需要复杂的引用管理
       */
      let laneMergedAppendBlock = "";
      const baseCurrentUserContent = userText;

      const appendLaneMergedBlockToCurrentUser = (mergedText: string, trigger: string): void => {
        const trimmed = String(mergedText ?? "").trim();
        if (!trimmed) return;
        laneMergedAppendBlock += `\n\n---\n\n${trimmed}\n`;

        // 更新 currentUserMessage 的内容
        currentUserMessage.content = baseCurrentUserContent + laneMergedAppendBlock;

        void logger.log("debug", "Lane merged text appended to current user message", {
          chatKey,
          requestId,
          trigger,
          mergedChars: trimmed.length,
        });
      };

      const drainAndAppendLaneMergedTextIfNeeded = async (
        trigger: string,
      ): Promise<{ merged: boolean; mergedText?: string }> => {
        if (typeof drainLaneMergedText !== "function") return { merged: false };
        try {
          const mergedText = await drainLaneMergedText();
          if (!mergedText || !mergedText.trim()) return { merged: false };
          appendLaneMergedBlockToCurrentUser(mergedText, trigger);
          return { merged: true, mergedText: mergedText.trim() };
        } catch {
          // ignore
          return { merged: false };
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
              // 关键点（中文）：工具结束后立即 drain，一旦有新消息就并入当前 user message。
              const merged = await drainAndAppendLaneMergedTextIfNeeded(
                `after_tool:${toolName}`,
              );
              if (merged.merged && onStep) {
                try {
                  await emitStep("lane_merge", merged.mergedText || "", { requestId, chatKey });
                } catch {
                  // ignore
                }
              }
            }
          },
        } as any;
      }

      const buildLoadedSkillsSystemText = (
        loaded: Map<
          string,
          {
            id: string;
            name: string;
            skillMdPath: string;
            content: string;
            allowedTools: string[];
          }
        >,
      ): { systemText: string; activeTools?: string[] } | null => {
        if (!loaded || loaded.size === 0) return null;

        const skills = Array.from(loaded.values());
        const lines: string[] = [];
        lines.push("已加载 Skills（请严格遵循以下 SOP/约束）：");
        lines.push(`- count: ${skills.length}`);
        lines.push("");

        const unionAllowedTools = new Set<string>();
        let hasAnyAllowedTools = false;

        for (const s of skills) {
          lines.push(`## Skill: ${s.name}`);
          lines.push(`- id: ${s.id}`);
          lines.push(`- path: ${s.skillMdPath}`);
          if (Array.isArray(s.allowedTools) && s.allowedTools.length > 0) {
            hasAnyAllowedTools = true;
            for (const t of s.allowedTools) unionAllowedTools.add(String(t));
            lines.push(`- allowedTools: ${s.allowedTools.join(", ")}`);
          } else {
            lines.push(`- allowedTools: (not specified)`);
          }
          lines.push("");
          lines.push("SKILL.md 内容：");
          lines.push(s.content);
          lines.push("");
        }

        const activeTools = hasAnyAllowedTools
          ? Array.from(
              new Set([
                // 关键点（中文）：无论 skills 如何声明，chat_send 需要保底存在，否则无法对用户输出。
                "chat_send",
                ...Array.from(unionAllowedTools),
              ]),
            )
              .filter((n) => allToolNames.includes(n))
              .slice(0, 2000)
          : undefined;

        return { systemText: lines.join("\n").trim(), activeTools };
      };

      const computeChatSendBudgetGuard = (): {
        exceeded: boolean;
        maxCalls: number;
        calls: number;
      } => {
        const maxCalls =
          typeof this.configs.config?.context?.chatEgress
            ?.chatSendMaxCallsPerRun === "number" &&
          Number.isFinite(this.configs.config.context.chatEgress.chatSendMaxCallsPerRun) &&
          this.configs.config.context.chatEgress.chatSendMaxCallsPerRun > 0
            ? this.configs.config.context.chatEgress.chatSendMaxCallsPerRun
            : 30;
        const execCtx = toolExecutionContext.getStore();
        const calls = execCtx?.toolCallCounts.get("chat_send") ?? 0;
        return { exceeded: calls > maxCalls, maxCalls, calls };
      };

      const result = await withToolExecutionContext(
        {
          systemMessageInsertIndex,
          messages: inFlightMessages,
          currentUserMessageIndex: Math.max(0, inFlightMessages.length - 1),
          injectedFingerprints: new Set(),
          maxInjectedMessages: 120,
          toolCallCounts: new Map(),
          preparedSystemMessages: [],
          preparedAssistantMessages: [],
          loadedSkills: new Map(),
        },
        () =>
          withLlmRequestContext({ chatKey, requestId }, () => {
            return generateText({
              model: this.model,
              system: baseSystemMessages,
              prepareStep: async ({ messages }) => {
                const execCtx = toolExecutionContext.getStore();

                // 1) 在每个 step 前先检查 lane 是否有新消息，合并做快速矫正。
                const merged = await drainAndAppendLaneMergedTextIfNeeded("before_step");
                if (merged.merged && onStep) {
                  try {
                    await emitStep("lane_merge", merged.mergedText || "", { requestId, chatKey });
                  } catch {
                    // ignore
                  }
                }

                // 2) system prompt：按需叠加 skills / 预算 guard / 其它预备注入。
                const systemAdditions: SystemModelMessage[] = [];
                let activeTools: string[] | undefined;
                let toolChoice: "none" | undefined;

                if (execCtx?.preparedSystemMessages?.length) {
                  for (const item of execCtx.preparedSystemMessages) {
                    if (!item?.content?.trim()) continue;
                    systemAdditions.push({ role: "system", content: item.content });
                  }
                }

                if (execCtx?.loadedSkills?.size) {
                  const built = buildLoadedSkillsSystemText(execCtx.loadedSkills);
                  if (built) {
                    systemAdditions.push({ role: "system", content: built.systemText });
                    if (built.activeTools) activeTools = built.activeTools;
                  }
                }

                const budget = computeChatSendBudgetGuard();
                if (budget.exceeded) {
                  systemAdditions.push({
                    role: "system",
                    content:
                      `系统约束（重要）：你已经多次调用 chat_send（calls=${budget.calls}，max=${budget.maxCalls}）。现在禁止继续调用 chat_send；请停止工具调用并结束本次回复。`,
                  });
                  // 关键点（中文）：预算超限时，强制禁止继续工具调用，避免无意义循环消耗。
                  toolChoice = "none";
                  // 同时尽可能把 activeTools 缩到空集（防 provider 忽略 toolChoice 时仍能兜底）。
                  activeTools = [];
                }

                // 关键点（中文）：在所有 base system prompts 之后注入历史对话
                // 这样确保历史对话在用户自定义的 system prompts 之后
                if (historyText.trim()) {
                  systemAdditions.push({
                    role: "system",
                    content: historyText,
                  });
                }

                const nextSystem =
                  systemAdditions.length > 0
                    ? ([
                        ...baseSystemMessages,
                        ...systemAdditions,
                      ] as Array<SystemModelMessage>)
                    : baseSystemMessages;

                // 3) messages：把"预备注入 assistant messages"插到当前 user message 之前；
                //    由于现在只有一条 user message，逻辑大大简化
                let outMessages: ModelMessage[] = messages as any;

                if (execCtx?.preparedAssistantMessages?.length) {
                  const prepared = execCtx.preparedAssistantMessages
                    .filter((x) => x?.content?.trim())
                    .map((x) => ({ role: "assistant", content: x.content } as any));
                  if (prepared.length > 0) {
                    // 在当前 user message 之前插入 assistant messages
                    outMessages = [...prepared, currentUserMessage];
                  }
                }

                // 如果有 lane 合并内容，更新 currentUserMessage
                if (laneMergedAppendBlock.trim()) {
                  // 找到当前的 user message 并更新
                  const userIdx = outMessages.findIndex((m) => m === currentUserMessage);
                  if (userIdx >= 0) {
                    outMessages = [
                      ...outMessages.slice(0, userIdx),
                      {
                        ...currentUserMessage,
                        role: "user",
                        content: baseCurrentUserContent + laneMergedAppendBlock,
                      },
                      ...outMessages.slice(userIdx + 1),
                    ];
                  }
                }

                return {
                  system: nextSystem,
                  messages: outMessages,
                  ...(typeof toolChoice === "string" ? { toolChoice } : {}),
                  ...(Array.isArray(activeTools) ? { activeTools } : {}),
                };
              },
              messages: inFlightMessages,
              tools: toolsWithLaneMerge,
              stopWhen: [stepCountIs(30)],
              onStepFinish: async (step) => {
                // 1. 实时保存 tool 消息（如果有工具调用）
                if (chatRuntime && step.toolResults && step.toolResults.length > 0) {
                  try {
                    const maxOutputLength = 500;
                    const truncatedCalls = step.toolResults.map((tr: any) => {
                      let output = tr.output;
                      if (typeof output === "string" && output.length > maxOutputLength) {
                        output = output.slice(0, maxOutputLength) + "...(output truncated)";
                      }
                      return {
                        tool: String(tr.toolName || "unknown_tool"),
                        input: tr.input || {},
                        output,
                      };
                    });

                    const ctx = chatRequestContext.getStore();
                    await chatRuntime.getStore(chatKey).append({
                      channel: ctx?.channel || "api",
                      chatId: ctx?.chatId || chatKey,
                      userId: "bot",
                      role: "tool",
                      text: JSON.stringify(truncatedCalls),
                      meta: { via: "agent" },
                    });

                    // 异步检查记忆提取（不阻塞）
                    void chatRuntime.checkAndExtractMemoryAsync(chatKey);
                  } catch {
                    // 保存失败不影响执行
                  }
                }

                // 2. 实时保存 assistant 消息（如果有文本输出）
                const userTextFromStep = extractUserFacingTextFromStep(step);
                if (chatRuntime && userTextFromStep && userTextFromStep !== lastEmittedAssistant) {
                  try {
                    const ctx = chatRequestContext.getStore();
                    await chatRuntime.getStore(chatKey).append({
                      channel: ctx?.channel || "api",
                      chatId: ctx?.chatId || chatKey,
                      userId: "bot",
                      role: "assistant",
                      text: userTextFromStep,
                      meta: { via: "agent" },
                    });

                    // 异步检查记忆提取（不阻塞）
                    void chatRuntime.checkAndExtractMemoryAsync(chatKey);
                  } catch {
                    // 保存失败不影响执行
                  }
                }

                // 3. Emit events
                try {
                  if (userTextFromStep && userTextFromStep !== lastEmittedAssistant) {
                    lastEmittedAssistant = userTextFromStep;
                    await emitStep("assistant", userTextFromStep, { requestId, chatKey });
                  }
                } catch {
                  // ignore
                }
                if (!onStep) return;
                try {
                  await emitToolSummariesFromStep(step, emitStep, { requestId, chatKey });
                } catch {
                  // ignore
                }
                try {
                  // 关键点：为调度器提供"step 完成"的可靠信号。
                  // onStepFinish 内部可能 emit 多个事件（assistant/tool summaries），调度器需要一个去抖触发点。
                  await emitStep("step_finish", "", { requestId, chatKey });
                } catch {
                  // ignore
                }
              },
            });
          }),
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

      // 简化策略：不再持久化上下文，所有历史由 ChatRuntime 管理并写入 history.jsonl

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
        await emitStep(
          "compaction",
          "上下文过长，已减少注入的对话历史后继续。",
          {
            requestId,
            chatKey,
            retryAttempts,
          },
        );

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
          drainLaneMergedText,
          requestId,
          chatRuntime,
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
