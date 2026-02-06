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
import { chatRequestContext } from "../../chat/request-context.js";
import { withToolExecutionContext } from "../tools/builtin/execution-context.js";
import { createAgentTools } from "../tools/set/agent-tools.js";
import { openai } from "@ai-sdk/openai";
import { toolExecutionContext } from "../tools/builtin/execution-context.js";
import {
  loadActiveContextEntries,
  writeActiveContextEntries,
} from "../../chat/contexts-store.js";
import type { ChatContextMessageEntryV1 } from "../../types/contexts.js";

function pickLastSuccessfulChatSendText(toolCalls: AgentResult["toolCalls"]): string {
  // 关键点（中文）：优先从 chat_send 的 input.text 还原“用户可见回复”，因为 tool-strict 下 result.text 可能为空。
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
  // 进程内的工作上下文（per chatKey）：同一 chatKey 的两次 run 直接复用同一个 messages 数组
  private contextMessagesByChatKey: Map<string, ModelMessage[]> = new Map();

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
    if (this.initialized) {
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

  private normalizeChatKey(chatKey: string): string {
    return String(chatKey || "").trim();
  }

  private async getOrHydrateContextMessages(chatKey: string): Promise<ModelMessage[]> {
    const key = this.normalizeChatKey(chatKey);
    if (!key) return [];

    const existing = this.contextMessagesByChatKey.get(key);
    if (existing) return existing;

    // 关键点（中文）：active.jsonl 只用于“进程重启后的恢复”，因此这里只在首次触达该 chatKey 时 hydrate 一次。
    const entries = await loadActiveContextEntries({
      projectRoot: this.configs.projectRoot,
      chatKey: key,
      options: { maxMessages: 0, maxChars: 0 },
    });
    const messages: ModelMessage[] = entries.map((e) => ({
      role: e.role,
      content: e.content,
    })) as any;

    this.contextMessagesByChatKey.set(key, messages);
    return messages;
  }

  private async flushContextMessagesToDisk(params: {
    chatKey: string;
    messages: ModelMessage[];
  }): Promise<void> {
    const key = this.normalizeChatKey(params.chatKey);
    if (!key) return;

    const t0 = Date.now();
    const entries: ChatContextMessageEntryV1[] = [];
    let ts = t0;
    for (const m of params.messages || []) {
      if (!m || typeof m !== "object") continue;
      const role = String((m as any).role || "");
      if (role !== "user" && role !== "assistant") continue;
      const content = String((m as any).content ?? "");
      if (!content.trim()) continue;
      entries.push({ v: 1, ts, role: role as any, content });
      ts += 1;
    }

    try {
      await writeActiveContextEntries({
        projectRoot: this.configs.projectRoot,
        chatKey: key,
        entries,
      });
    } catch {
      // ignore
    }
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
      // - Agent 进程内维护 per-chatKey 的 `ModelMessage[]` 作为 context
      // - active.jsonl 只用于“进程重启后的恢复”（首次 hydrate），以及 run 结束时 flush（用于下次重启）
      const contextMessages = await this.getOrHydrateContextMessages(chatKey);
      const retryAttempts = opts?.retryAttempts ?? 0;

      // 关键点（中文）：重试（context_length）不重复追加 user，避免同一轮写入两次。
      if (retryAttempts === 0) {
        contextMessages.push({ role: "user", content: userText } as any);
      }

      const currentUserMessageRef =
        (contextMessages[contextMessages.length - 1] as any) || ({ role: "user", content: userText } as any);

      // in-flight messages = system（独立传入） + contextMessages（同一数组复用）
      const inFlightMessages: ModelMessage[] = contextMessages;
      await logger.log("debug", "Context injection selected", {
        chatKey,
        historySource: "in_process_context_messages",
        activeMessages: Array.isArray(inFlightMessages) ? inFlightMessages.length : 0,
      });

      // system messages 需要保持聚合在 messages 开头，工具注入 system 指令时应插到它们之后。
      // 注意：contextMessages 不包含 system，因此 systemMessageInsertIndex 固定为 0
      let systemMessageInsertIndex = 0;

      const currentUserMessageIndex = Math.max(0, inFlightMessages.length - 1);

      // 关键点（中文）：system prompt 不再放入 context messages（避免污染跨轮复用的数组），
      // 统一通过 `system` 参数注入（runtime + 配置 + tools 追加）。
      const runtimeSystemMessages: SystemModelMessage[] = systemExtras
        .filter((m) => (m as any)?.role === "system")
        .map((m) => ({ role: "system", content: String((m as any)?.content ?? "") }));

      const baseSystemMessages: SystemModelMessage[] = [
        ...runtimeSystemMessages,
        ...transformPromptsIntoSystemMessages([...this.configs.systems]),
      ];
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
            : 30;
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

      // run 结束：把 assistant 追加到进程内 context；然后 flush 全量到 active.jsonl（用于进程重启恢复）
      try {
        const assistantText =
          pickLastSuccessfulChatSendText(toolCalls) || String(result.text || "").trim();

        if (laneMergedAppendBlock.trim()) {
          // 关键点（中文）：把 lane 合并块补写回当前 user message，保证下一轮复用的 context 与模型看到的一致
          const last = inFlightMessages[inFlightMessages.length - 1] as any;
          if (last && last.role === "user") {
            last.content = String(last.content ?? "") + laneMergedAppendBlock;
          }
        }

        if (assistantText) inFlightMessages.push({ role: "assistant", content: assistantText } as any);

        await this.flushContextMessagesToDisk({ chatKey, messages: inFlightMessages });
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
