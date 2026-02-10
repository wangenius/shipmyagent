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
import {
  generateId,
  getShipSessionMemoryPrimaryPath,
  getShipProfileOtherPath,
  getShipProfilePrimaryPath,
} from "../../utils.js";
import {
  buildContextSystemPrompt,
  transformPromptsIntoSystemMessages,
} from "./prompt.js";
import { createModel } from "../llm/create-model.js";
import fs from "fs-extra";
import {
  extractUserFacingTextFromStep,
  emitToolSummariesFromStep,
} from "./tool-step.js";
import type { AgentRunInput, AgentResult } from "../../types/agent.js";
import type { LoadedSkillV1 } from "../../types/loaded-skill.js";
import type { Logger } from "../../telemetry/index.js";
import { sessionRequestContext } from "./session-context.js";
import { withToolExecutionContext } from "../tools/execution-context.js";
import { createAgentTools } from "../tools/agent-tools.js";
import { openai } from "@ai-sdk/openai";
import { toolExecutionContext } from "../tools/execution-context.js";
import path from "node:path";
import { discoverClaudeSkillsSync } from "../../intergrations/skills/runtime/index.js";
import {
  setSessionAvailableSkills,
  setSessionLoadedSkills,
} from "../skills/index.js";
import type { ShipSessionMetadataV1 } from "../../types/session-history.js";
import {
  getShipRuntimeContext,
  getShipRuntimeContextBase,
} from "../../server/ShipRuntimeContext.js";

function extractTextFromUiMessage(message: any): string {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  return parts
    .filter((p: any) => p && typeof p === "object" && p.type === "text")
    .map((p: any) => String(p.text ?? ""))
    .join("\n")
    .trim();
}

function extractToolCallsFromUiMessage(message: any): Array<{
  tool: string;
  input: Record<string, unknown>;
  output: string;
}> {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  const out: Array<{
    tool: string;
    input: Record<string, unknown>;
    output: string;
  }> = [];

  for (const p of parts) {
    if (!p || typeof p !== "object") continue;
    const type = String((p as any).type || "");
    const toolName = type.startsWith("tool-")
      ? type.slice("tool-".length)
      : type === "dynamic-tool"
        ? String((p as any).toolName || "")
        : "";
    if (!toolName) continue;

    const rawInput =
      (p as any).input ??
      (p as any).rawInput ??
      (p as any).arguments ??
      undefined;
    const input: Record<string, unknown> =
      rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
        ? (rawInput as any)
        : { value: rawInput };

    const state = String((p as any).state || "");
    const outputObj =
      state === "output-available"
        ? (p as any).output
        : state === "output-error"
          ? { error: (p as any).errorText ?? "tool_error" }
          : state === "output-denied"
            ? { error: "tool_denied", reason: (p as any)?.approval?.reason }
            : undefined;
    const output = outputObj === undefined ? "" : JSON.stringify(outputObj);

    out.push({ tool: toolName, input, output });
  }

  return out;
}

function buildLoadedSkillsSystemText(params: {
  loaded: Map<string, LoadedSkillV1>;
  allToolNames: string[];
}): { systemText: string; activeTools?: string[] } | null {
  const { loaded, allToolNames } = params;
  if (!loaded || loaded.size === 0) return null;

  const skills = Array.from(loaded.values());
  const lines: string[] = [];
  lines.push("# ACTIVE SKILLS — MANDATORY EXECUTION");
  lines.push("");
  lines.push(
    `You have ${skills.length} active skill(s). These are NOT suggestions — they are binding SOPs you MUST follow.`,
  );
  lines.push("");

  const unionAllowedTools = new Set<string>();
  let hasAnyAllowedTools = false;

  for (const s of skills) {
    lines.push(`## Skill: ${s.name}`);
    lines.push(`**ID:** ${s.id}`);
    lines.push(`**Path:** ${s.skillMdPath}`);

    if (Array.isArray(s.allowedTools) && s.allowedTools.length > 0) {
      hasAnyAllowedTools = true;
      for (const t of s.allowedTools) unionAllowedTools.add(String(t));
      lines.push(
        `**Tool Restriction:** You can ONLY use these tools: ${s.allowedTools.join(", ")} (plus exec_command/write_stdin/close_session for command workflow)`,
      );
    } else {
      lines.push(`**Tool Restriction:** None (all tools available)`);
    }
    lines.push("");
    lines.push("### Instructions (MUST FOLLOW):");
    lines.push(s.content);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  lines.push("## Execution Priority");
  lines.push(
    "1. Active skills take HIGHEST priority — their instructions override general guidelines",
  );
  lines.push("2. If multiple skills are active, follow all their constraints");
  lines.push(
    "3. Tool restrictions are ENFORCED — attempting to use forbidden tools will fail",
  );

  const activeTools = hasAnyAllowedTools
    ? Array.from(
        new Set([
          "exec_command",
          "write_stdin",
          "close_session",
          ...Array.from(unionAllowedTools),
        ]),
      )
        .filter((n) => allToolNames.includes(n))
        .slice(0, 2000)
    : undefined;

  return { systemText: lines.join("\n").trim(), activeTools };
}

export class Agent {
  // 是否初始化
  private initialized: boolean = false;
  // 模型
  private model: LanguageModel = openai("gpt-5.2");

  private tools: Record<string, Tool> = {};
  /**
   * sessionId 绑定检查。
   *
   * 关键点（中文）
   * - 运行时策略是"一个 sessionId 一个 Agent 实例"（由 SessionRuntime 保证）
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
    const { query, sessionId, onStep, drainLaneMerged } = input;
    const startTime = Date.now();
    const requestId = generateId();
    const logger = this.getLogger();

    const sessionCtx = sessionRequestContext.getStore();
    const extraContextLines: string[] = [];
    if (sessionCtx?.channel)
      extraContextLines.push(`- Channel: ${sessionCtx.channel}`);
    if (sessionCtx?.targetId) extraContextLines.push(`- TargetId: ${sessionCtx.targetId}`);
    if (sessionCtx?.actorId) extraContextLines.push(`- UserId: ${sessionCtx.actorId}`);
    if (sessionCtx?.actorName)
      extraContextLines.push(`- Username: ${sessionCtx.actorName}`);

    await logger.log("debug", `SessionId: ${sessionId}`);
    await logger.log("info", "Agent request started", {
      requestId,
      sessionId,
      instructionsPreview: query?.slice(0, 200),
      rootPath: getShipRuntimeContext().rootPath,
    });
    if (this.initialized) {
      return this.runWithToolLoopAgent(query, startTime, sessionId, {
        onStep,
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
      onStep?: AgentRunInput["onStep"];
      drainLaneMerged?: AgentRunInput["drainLaneMerged"];
      requestId?: string;
    },
  ): Promise<AgentResult> {
    const toolCalls: AgentResult["toolCalls"] = [];
    let hadToolFailure = false;
    const toolFailureSummaries: string[] = [];
    const retryAttempts = opts?.retryAttempts ?? 0;
    const onStep = opts?.onStep;
    const drainLaneMerged = opts?.drainLaneMerged;
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

      // 运行时 system prompt（每次请求都注入，包含 sessionId/requestId/来源等）。
      // 关键点：这段信息是“强时效/强关联本次请求”的上下文，不应该缓存到启动 prompts 里。
      const runtimeExtraContextLines: string[] = [];
      const sessionCtx = sessionRequestContext.getStore();
      if (sessionCtx?.channel)
        runtimeExtraContextLines.push(`- Channel: ${sessionCtx.channel}`);
      if (sessionCtx?.targetId)
        runtimeExtraContextLines.push(`- TargetId: ${sessionCtx.targetId}`);
      if (sessionCtx?.actorId)
        runtimeExtraContextLines.push(`- UserId: ${sessionCtx.actorId}`);
      if (sessionCtx?.actorName)
        runtimeExtraContextLines.push(`- Username: ${sessionCtx.actorName}`);

      systemExtras.push({
        role: "system",
        content: buildContextSystemPrompt({
          projectRoot: getShipRuntimeContext().rootPath,
          sessionId,
          requestId,
          extraContextLines: runtimeExtraContextLines,
        }),
      });

      const profilePrimary = await readOptionalMd(
        getShipProfilePrimaryPath(getShipRuntimeContext().rootPath),
      );
      if (profilePrimary) {
        systemExtras.push({
          role: "system",
          content: ["# Profile / Primary", profilePrimary].join("\n\n"),
        });
      }

      const profileOther = await readOptionalMd(
        getShipProfileOtherPath(getShipRuntimeContext().rootPath),
      );
      if (profileOther) {
        systemExtras.push({
          role: "system",
          content: ["# Profile / Other", profileOther].join("\n\n"),
        });
      }

      const sessionMemoryPrimary = await readOptionalMd(
        getShipSessionMemoryPrimaryPath(getShipRuntimeContext().rootPath, sessionId),
      );
      if (sessionMemoryPrimary) {
        systemExtras.push({
          role: "system",
          content: ["#", sessionMemoryPrimary].join("\n\n"),
        });
      }

      // 工作上下文来源（中文，关键点）
      // - 每个 sessionId 维护一份持续增长的 UIMessage[]（落盘在 `.ship/session/<sessionId>/messages/history.jsonl`）
      // - 每次 run 直接把 UIMessage[] 转换成 ModelMessage[] 作为 `generateText.messages`
      // - 超窗时自动 compact：把更早段压缩为 1 条摘要消息 + 保留最近窗口
      this.bindSessionId(sessionId);

      // 关键点（中文）：historyStore 统一从 SessionRuntime 获取，便于为特殊 sessionId（如 task-run）注入自定义落盘路径。
      const historyStore =
        getShipRuntimeContext().sessionRuntime.getHistoryStore(sessionId);

      // 关键点（中文）：session 级 skills（pinnedSkillIds）持久化在 meta.json 中；
      // 每次 run 需要自动加载并注入 system（但不写入 history.jsonl）。
      const pinnedSkills: Map<string, LoadedSkillV1> = new Map();
      const runtime = getShipRuntimeContext();
      const discoveredSkills = discoverClaudeSkillsSync(
        runtime.rootPath,
        runtime.config,
      );
      setSessionAvailableSkills(sessionId, discoveredSkills);

      try {
        const meta = await historyStore.loadMeta();
        const pinnedSkillIds = Array.isArray(meta.pinnedSkillIds)
          ? meta.pinnedSkillIds
          : [];
        if (pinnedSkillIds.length > 0) {
          const byId = new Map(discoveredSkills.map((s) => [s.id, s]));
          const loadedIds: string[] = [];
          for (const id of pinnedSkillIds) {
            const skill = byId.get(String(id || "").trim());
            if (!skill) continue;
            let content = "";
            try {
              content = fs.readFileSync(skill.skillMdPath, "utf-8");
            } catch {
              content = "";
            }
            if (!content.trim()) continue;
            loadedIds.push(skill.id);
            pinnedSkills.set(skill.id, {
              id: skill.id,
              name: skill.name,
              skillMdPath: path.relative(runtime.rootPath, skill.skillMdPath),
              content,
              allowedTools: Array.isArray(skill.allowedTools)
                ? skill.allowedTools.map((t) => String(t)).filter(Boolean)
                : [],
            });
          }

          // 若 pinned skill 已不存在/不可读，自动剔除，避免反复注入失败。
          const normalized = Array.from(new Set(loadedIds));
          const inputNormalized = Array.from(
            new Set(
              pinnedSkillIds.map((x) => String(x || "").trim()).filter(Boolean),
            ),
          );
          if (normalized.length !== inputNormalized.length) {
            await historyStore.setPinnedSkillIds(normalized);
          }
        }
      } catch {
        // ignore
      } finally {
        // 关键点（中文）：core 只维护“当前 sessionId 的 skills 状态”；挂载策略由 integrations 决定。
        setSessionLoadedSkills(sessionId, pinnedSkills);
      }

      // best-effort：若上层未提前写入 user UIMessage，这里补写一条，保证 run 可用。
      const ensureCurrentUserRecorded = async (): Promise<void> => {
        try {
          const msgs = await historyStore.loadAll();
          const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
          const lastText = (() => {
            if (!last || last.role !== "user") return "";
            const parts = Array.isArray((last as any).parts)
              ? (last as any).parts
              : [];
            return parts
              .filter(
                (p: any) => p && typeof p === "object" && p.type === "text",
              )
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
              threadId:
                typeof ctx?.threadId === "number"
                  ? ctx.threadId
                  : undefined,
              targetType: ctx?.targetType,
              requestId,
              extra: { note: "injected_by_agent_run" },
            } as any,
          });
          await historyStore.append(msg);
        } catch {
          // ignore
        }
      };

      // 关键点（中文）：system prompt 每次 run 独立注入，不污染历史记录。
      const runtimeSystemMessages: SystemModelMessage[] = systemExtras
        .filter((m) => (m as any)?.role === "system")
        .map((m) => ({
          role: "system",
          content: String((m as any)?.content ?? ""),
        }));

      const baseSystemMessages: SystemModelMessage[] = [
        ...runtimeSystemMessages,
        ...transformPromptsIntoSystemMessages([
          ...getShipRuntimeContext().systems,
        ]),
      ];
      const allToolNames = Object.keys(this.tools);

      // 先确保本轮 user 已写入 history（best-effort）
      await ensureCurrentUserRecorded();

      // auto compact（按配置/预算）
      const baseKeepLastMessages =
        typeof (getShipRuntimeContext().config as any)?.context?.history
          ?.keepLastMessages === "number"
          ? Math.max(
              6,
              Math.min(
                5000,
                Math.floor(
                  (getShipRuntimeContext().config as any).context.history
                    .keepLastMessages,
                ),
              ),
            )
          : 30;
      const baseMaxInputTokensApprox =
        typeof (getShipRuntimeContext().config as any)?.context?.history
          ?.maxInputTokensApprox === "number"
          ? Math.max(
              2000,
              Math.min(
                200_000,
                Math.floor(
                  (getShipRuntimeContext().config as any).context.history
                    .maxInputTokensApprox,
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
        (getShipRuntimeContext().config as any)?.context?.history
          ?.archiveOnCompact === undefined
          ? true
          : Boolean(
              (getShipRuntimeContext().config as any).context.history
                .archiveOnCompact,
            );

      const pinnedSkillsForCompact = pinnedSkills.size
        ? buildLoadedSkillsSystemText({ loaded: pinnedSkills, allToolNames })
        : null;
      const systemForCompact: SystemModelMessage[] = pinnedSkillsForCompact
        ? [
            ...baseSystemMessages,
            { role: "system", content: pinnedSkillsForCompact.systemText },
          ]
        : baseSystemMessages;

      const maybePrunePinnedSkillsOnCompact = async (): Promise<void> => {
        if (!pinnedSkills.size) return;
        try {
          const msgs = await historyStore.loadAll();
          const tail = msgs.slice(Math.max(0, msgs.length - 24));
          const tailText = tail
            .map((m) => {
              const role = m.role === "user" ? "user" : "assistant";
              const parts = Array.isArray((m as any).parts)
                ? (m as any).parts
                : [];
              const text = parts
                .filter(
                  (p: any) => p && typeof p === "object" && p.type === "text",
                )
                .map((p: any) => String(p.text ?? ""))
                .join("\n")
                .trim();
              if (!text) return "";
              return `${role}: ${text}`;
            })
            .filter(Boolean)
            .join("\n\n");

          const skillsList = Array.from(pinnedSkills.values()).map((s) => {
            const preview = String(s.content || "")
              .trim()
              .slice(0, 400);
            return {
              id: s.id,
              name: s.name,
              path: s.skillMdPath,
              allowedTools: s.allowedTools,
              preview,
            };
          });

          const r = await generateText({
            model: this.model,
            system: [
              {
                role: "system",
                content:
                  "你是技能管理助手。当前 session 有一些被 pin 的 skills，会在每次对话中自动注入。\n" +
                  "现在发生了 history compact（上下文过长），为了节省 token，你需要判断哪些 pinned skills 可以安全移除。\n" +
                  "规则（中文，关键）：\n" +
                  "- 只有当你确信后续对话不需要该 skill 时才移除\n" +
                  "- 如果不确定，必须保留\n" +
                  '- 只输出严格 JSON：{"removeSkillIds":[...]}，不要输出其它文字',
              },
            ],
            prompt:
              `最近对话（节选）：\n\n${tailText || "(empty)"}\n\n` +
              `本轮用户问题：\n\n${String(userText || "").trim()}\n\n` +
              `当前 pinned skills（列表）：\n\n${JSON.stringify(skillsList, null, 2)}\n`,
          });

          let removeIds: string[] = [];
          try {
            const parsed = JSON.parse(String(r.text || "").trim());
            const arr = Array.isArray(parsed?.removeSkillIds)
              ? parsed.removeSkillIds
              : [];
            removeIds = arr
              .map((x: any) => String(x || "").trim())
              .filter(Boolean);
          } catch {
            removeIds = [];
          }

          if (removeIds.length === 0) return;
          const removeSet = new Set(removeIds);
          for (const id of Array.from(pinnedSkills.keys())) {
            if (removeSet.has(id)) pinnedSkills.delete(id);
          }
          await historyStore.setPinnedSkillIds(Array.from(pinnedSkills.keys()));
          setSessionLoadedSkills(sessionId, pinnedSkills);
        } catch {
          // ignore
        }
      };

      let compacted = false;
      try {
        const r = await historyStore.compactIfNeeded({
          model: this.model,
          system: systemForCompact,
          keepLastMessages,
          maxInputTokensApprox,
          archiveOnCompact,
        });
        compacted = Boolean((r as any)?.compacted);
      } catch {
        // ignore compact failure; fallback to un-compacted history
      }
      if (compacted) {
        await maybePrunePinnedSkillsOnCompact();
      }

      let baseModelMessages: ModelMessage[] =
        (await historyStore.toModelMessages({ tools: this.tools })) as any;
      if (!Array.isArray(baseModelMessages) || baseModelMessages.length === 0) {
        baseModelMessages = [{ role: "user", content: userText } as any];
      }

      await logger.log("debug", "Context selected", {
        sessionId,
        historySource: "history_jsonl",
        modelMessages: baseModelMessages.length,
        keepLastMessages,
        maxInputTokensApprox,
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
          if (onStep) {
            try {
              await emitStep("lane_merge", `drained=${drained}`, {
                requestId,
                sessionId,
                drained,
              });
            } catch {
              // ignore
            }
          }
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

      const result = await withToolExecutionContext(
        {
          loadedSkills: new Map(pinnedSkills),
        },
        async () =>
          withLlmRequestContext({ sessionId, requestId }, () => {
            return streamText({
              model: this.model,
              system: baseSystemMessages,
              prepareStep: async ({ messages }) => {
                const execCtx = toolExecutionContext.getStore();

                const incomingMessages: ModelMessage[] = Array.isArray(messages)
                  ? (messages as any)
                  : [];
                const suffix =
                  incomingMessages.length >= lastAppliedBasePrefixLen
                    ? incomingMessages.slice(lastAppliedBasePrefixLen)
                    : [];

                // 1) 在每个 step 前先检查 lane 是否有新消息；若有则重载 history。
                await reloadModelMessages("before_step");

                // 2) system prompt：按需叠加 skills / 其它预备注入。
                const systemAdditions: SystemModelMessage[] = [];
                let activeTools: string[] | undefined;

                if (execCtx?.loadedSkills?.size) {
                  const built = buildLoadedSkillsSystemText({
                    loaded: execCtx.loadedSkills as any,
                    allToolNames,
                  });
                  if (built) {
                    systemAdditions.push({
                      role: "system",
                      content: built.systemText,
                    });
                    if (built.activeTools) activeTools = built.activeTools;
                  }
                }

                const nextSystem =
                  systemAdditions.length > 0
                    ? ([
                        ...baseSystemMessages,
                        ...systemAdditions,
                      ] as Array<SystemModelMessage>)
                    : baseSystemMessages;

                // 3) messages：默认保留 tool-loop 的 in-flight messages（包含 tool call/output 链）。
                // 若 history 已变化，则替换“前缀 history”，并保留后缀 tool 链。
                let outMessages: ModelMessage[] | undefined;
                if (needsHistoryResync) {
                  outMessages = [
                    ...(baseModelMessages as any),
                    ...suffix,
                  ] as any;
                  needsHistoryResync = false;
                  lastAppliedBasePrefixLen = Array.isArray(baseModelMessages)
                    ? baseModelMessages.length
                    : 0;
                }

                return {
                  system: nextSystem,
                  ...(Array.isArray(outMessages)
                    ? { messages: outMessages }
                    : {}),
                  ...(Array.isArray(activeTools) ? { activeTools } : {}),
                };
              },
              messages: baseModelMessages,
              tools: toolsWithLaneMerge,
              stopWhen: [stepCountIs(30)],
              onStepFinish: async (step) => {
                const userTextFromStep = extractUserFacingTextFromStep(step);

                // 3. Emit events
                try {
                  if (
                    userTextFromStep &&
                    userTextFromStep !== lastEmittedAssistant
                  ) {
                    lastEmittedAssistant = userTextFromStep;
                    await emitStep("assistant", userTextFromStep, {
                      requestId,
                      sessionId,
                    });
                  }
                } catch {
                  // ignore
                }
                if (!onStep) return;
                try {
                  await emitToolSummariesFromStep(step, emitStep, {
                    requestId,
                    sessionId,
                  });
                } catch {
                  // ignore
                }
                try {
                  // 关键点：为调度器提供"step 完成"的可靠信号。
                  // onStepFinish 内部可能 emit 多个事件（assistant/tool summaries），调度器需要一个去抖触发点。
                  await emitStep("step_finish", "", { requestId, sessionId });
                } catch {
                  // ignore
                }
              },
            });
          }),
      );

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
            typeof ctx?.threadId === "number"
              ? ctx.threadId
              : undefined,
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
        toolCalls.push(
          ...extractToolCallsFromUiMessage(finalAssistantUiMessage),
        );
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
      await emitStep("done", "done", { requestId, sessionId });

      // 关键点（中文）：对话历史由 SessionRuntime 管理并写入 history（history.jsonl）

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
        await emitStep(
          "compaction",
          "上下文过长，已触发 history 压缩后继续。",
          {
            requestId,
            sessionId,
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
          onStep,
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

  isInitialized(): boolean {
    return this.initialized;
  }
}
