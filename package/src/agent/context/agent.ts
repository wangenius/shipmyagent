import {
  generateText,
  stepCountIs,
  Tool,
  ToolLoopAgent,
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
import { chatRequestContext } from "../../chat/request-context.js";
import { withToolExecutionContext } from "../tools/builtin/execution-context.js";
import { createAgentTools } from "../tools/set/agent-tools.js";
import { loadChatTranscriptAsOneAssistantMessage } from "../../chat/transcript.js";
import { openai } from "@ai-sdk/openai";
import { toolExecutionContext } from "../tools/builtin/execution-context.js";

export class Agent {
  // 配置
  private configs: AgentConfigurations;
  // 是否初始化
  private initialized: boolean = false;
  // 模型
  private model: LanguageModel = openai("gpt-5.2");

  private tools: Record<string, Tool> = {};
  // Agent 执行逻辑
  private agent: ToolLoopAgent<never, any, any> | null = null;

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
    const { query, chatKey, onStep, drainLaneMergedText } = input;
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
        drainLaneMergedText,
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
      drainLaneMergedText?: AgentRunInput["drainLaneMergedText"];
      requestId?: string;
    },
  ): Promise<AgentResult> {
    const toolCalls: AgentResult["toolCalls"] = [];
    let hadToolFailure = false;
    const toolFailureSummaries: string[] = [];
    const retryAttempts = opts?.retryAttempts ?? 0;
    const onStep = opts?.onStep;
    const drainLaneMergedText = opts?.drainLaneMergedText;
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
          ? Math.max(
              0,
              Math.floor(transcriptMaxMessages / (opts.retryAttempts + 1)),
            )
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
      const currentUserMessageRef = inFlightMessages[currentUserMessageIndex];

      const baseSystemMessages = transformPromptsIntoSystemMessages([
        ...this.configs.systems,
      ]);
      const allToolNames = Object.keys(this.tools);

      // lane “快速矫正”追加内容：仅影响 prepareStep 的 step 输入，不改写 messages。
      let laneMergedAppendBlock = "";

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
            : 3;
        const execCtx = toolExecutionContext.getStore();
        const calls = execCtx?.toolCallCounts.get("chat_send") ?? 0;
        return { exceeded: calls > maxCalls, maxCalls, calls };
      };

      const result = await withToolExecutionContext(
        {
          systemMessageInsertIndex,
          messages: inFlightMessages,
          currentUserMessageIndex,
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
                if (typeof drainLaneMergedText === "function") {
                  try {
                    const mergedText = await drainLaneMergedText();
                    if (mergedText && mergedText.trim()) {
                      laneMergedAppendBlock += `\n\n---\n\n${mergedText.trim()}\n`;
                    }
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

                const nextSystem =
                  systemAdditions.length > 0
                    ? ([
                        ...baseSystemMessages,
                        ...systemAdditions,
                      ] as Array<SystemModelMessage>)
                    : baseSystemMessages;

                // 3) messages：把“预备注入 assistant messages”插到当前 user message 之前；
                //    同时把 lane 合并文本追加到当前 user message（不改写原 messages 对象）。
                let outMessages: ModelMessage[] = messages as any;

                if (execCtx?.preparedAssistantMessages?.length) {
                  const insertAt = outMessages.findIndex(
                    (m) => m === currentUserMessageRef,
                  );
                  if (insertAt >= 0) {
                    const prepared = execCtx.preparedAssistantMessages
                      .filter((x) => x?.content?.trim())
                      .map((x) => ({ role: "assistant", content: x.content } as any));
                    if (prepared.length > 0) {
                      outMessages = [
                        ...outMessages.slice(0, insertAt),
                        ...prepared,
                        ...outMessages.slice(insertAt),
                      ];
                    }
                  }
                }

                if (laneMergedAppendBlock.trim()) {
                  const idx = outMessages.findIndex((m) => m === currentUserMessageRef);
                  if (idx >= 0) {
                    const baseUserContent = String(
                      (currentUserMessageRef as any)?.content ?? "",
                    );
                    const mergedUserContent = baseUserContent + laneMergedAppendBlock;
                    const old = outMessages[idx] as any;
                    outMessages = [
                      ...outMessages.slice(0, idx),
                      { ...old, role: "user", content: mergedUserContent },
                      ...outMessages.slice(idx + 1),
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
              tools: this.tools,
              stopWhen: [stepCountIs(30)],
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
