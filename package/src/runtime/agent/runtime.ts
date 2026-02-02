import fs from "fs-extra";
import path from "path";
import {
  generateText,
  type LanguageModel,
  type ModelMessage,
  type ToolLoopAgent,
} from "ai";
import { withChatRequestContext } from "../chat/request-context.js";
import { withLlmRequestContext } from "../llm-logging/index.js";
import {
  generateId,
  getApprovalsDirPath,
  getTimestamp,
} from "../../utils.js";
import { McpManager } from "../mcp/manager.js";
import { createPermissionEngine, type PermissionEngine } from "../permission/index.js";
import { buildRuntimePrefixedPrompt } from "./prompt.js";
import { AgentLogger } from "./agent-logger.js";
import { AgentSessionStore } from "./session-store.js";
import { initializeMcp } from "./mcp.js";
import { createModelAndAgent } from "./model.js";
import { createToolSet, executeToolDirect } from "./tools.js";
import { extractUserFacingTextFromStep, emitToolSummariesFromStep } from "./tool-step.js";
import {
  applyApprovalActionsAndBuildResponses,
  decideApprovalsWithModel,
  filterRelevantApprovals,
  loadBaseMessagesFromApprovals,
  maybeCreatePendingApprovalFromToolLoopResult,
} from "./approvals.js";
import { runSimulated } from "./simulation.js";
import type {
  AgentContext,
  AgentInput,
  AgentResult,
  ApprovalDecisionResult,
  ApprovalRequest,
  ConversationMessage,
} from "./types.js";

export class AgentRuntime {
  private context: AgentContext;
  private initialized: boolean = false;
  private logger: AgentLogger;
  private permissionEngine: PermissionEngine;
  private mcpManager: McpManager | null = null;

  private model: LanguageModel | null = null;
  private agent: ToolLoopAgent<never, any, any> | null = null;

  private sessions: AgentSessionStore = new AgentSessionStore();

  constructor(context: AgentContext) {
    this.context = context;
    this.logger = new AgentLogger(context.projectRoot);
    this.permissionEngine = createPermissionEngine(context.projectRoot);
    this.mcpManager = new McpManager(context.projectRoot, this.logger);
  }

  setConversationHistory(sessionId: string, messages: unknown[]): void {
    this.sessions.set(sessionId, messages);
  }

  getConversationHistory(sessionId?: string): ConversationMessage[] {
    return this.sessions.getConversationHistory(sessionId);
  }

  clearConversationHistory(sessionId?: string): void {
    this.sessions.clear(sessionId);
  }

  async initialize(): Promise<void> {
    try {
      await this.logger.log("info", "Initializing Agent Runtime with ToolLoopAgent (AI SDK v6)");
      await this.logger.log("info", `Agent.md content length: ${this.context.agentMd?.length || 0} chars`);

      await initializeMcp({
        projectRoot: this.context.projectRoot,
        logger: this.logger,
        mcpManager: this.mcpManager,
      });

      const tools = createToolSet({
        projectRoot: this.context.projectRoot,
        permissionEngine: this.permissionEngine,
        config: this.context.config,
        mcpManager: this.mcpManager,
        logger: this.logger,
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

      await this.logger.log("info", "Agent Runtime initialized with ToolLoopAgent");
    } catch (error) {
      await this.logger.log("error", "Agent Runtime initialization failed", {
        error: String(error),
      });
    }
  }

  async run(input: AgentInput): Promise<AgentResult> {
    const { instructions, context, onStep } = input;
    const startTime = Date.now();
    const requestId = generateId();

    const sessionId = context?.sessionId || context?.userId || "default";

    const replyMode =
      context?.replyMode ||
      (context?.source === "telegram" ||
      context?.source === "feishu" ||
      context?.source === "qq"
        ? "tool"
        : undefined);

    await this.logger.log("debug", `Using system prompt (Agent.md): ${this.context.agentMd?.substring(0, 100)}...`);
    await this.logger.log("debug", `Session ID: ${sessionId}`);
    await this.logger.log("info", "Agent request started", {
      requestId,
      sessionId,
      source: context?.source,
      userId: context?.userId,
      instructionsPreview: instructions?.slice(0, 200),
      projectRoot: this.context.projectRoot,
    });

    const prompt = buildRuntimePrefixedPrompt({
      projectRoot: this.context.projectRoot,
      sessionId,
      requestId,
      instructions,
      context,
      replyMode,
    });

    if (this.initialized && this.agent) {
      return this.runWithToolLoopAgent(prompt, startTime, context, sessionId, {
        onStep,
        requestId,
      });
    }

    return runSimulated({
      prompt,
      startTime,
      toolCalls: [],
      context,
      config: this.context.config,
      projectRoot: this.context.projectRoot,
      logger: this.logger,
    });
  }

  private async runWithToolLoopAgent(
    prompt: string,
    startTime: number,
    context: AgentInput["context"] | undefined,
    sessionId: string,
    opts?: {
      addUserPrompt?: boolean;
      compactionAttempts?: number;
      onStep?: AgentInput["onStep"];
      requestId?: string;
    },
  ): Promise<AgentResult> {
    const toolCalls: AgentResult["toolCalls"] = [];
    let hadToolFailure = false;
    const toolFailureSummaries: string[] = [];
    const addUserPrompt = opts?.addUserPrompt !== false;
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

    const messages = this.sessions.getOrCreate(sessionId);
    if (addUserPrompt && prompt) messages.push({ role: "user", content: prompt });

    const beforeLen = messages.length;
    let lastEmittedAssistant = "";

    try {
      const result = await withChatRequestContext(
        {
          source: context?.source,
          userId: context?.userId,
          messageThreadId: context?.messageThreadId,
          sessionId,
          actorId: context?.actorId,
          chatType: context?.chatType,
          messageId: context?.messageId,
        },
        () =>
          withLlmRequestContext({ sessionId, requestId }, () =>
            this.agent!.generate({
              messages,
              onStepFinish: async (step) => {
                try {
                  const userText = extractUserFacingTextFromStep(step);
                  if (userText && userText !== lastEmittedAssistant) {
                    lastEmittedAssistant = userText;
                    await emitStep("assistant", userText, { requestId, sessionId });
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
              },
            }),
          ),
      );

      try {
        const responseMessages = (result.response?.messages || []) as ModelMessage[];
        await this.logger.log(
          "info",
          [
            "===== LLM RESPONSE BEGIN =====",
            ...(requestId ? [`requestId: ${requestId}`] : []),
            `sessionId: ${sessionId}`,
            `historyBefore: ${beforeLen}`,
            `responseMessages: ${responseMessages.length}`,
            responseMessages.length ? `\n${this.sessions.formatModelMessagesForLog(responseMessages)}` : "",
            "===== LLM RESPONSE END =====",
          ]
            .filter(Boolean)
            .join("\n"),
          {
            kind: "llm_response",
            sessionId,
            requestId,
            historyBefore: beforeLen,
            responseMessages: responseMessages.length,
          },
        );
      } catch {
        // ignore
      }

      messages.push(...result.response.messages);

      for (const step of result.steps || []) {
        for (const tr of step.toolResults || []) {
          toolCalls.push({
            tool: String((tr as any).toolName || "unknown_tool"),
            input: ((tr as any).input || {}) as Record<string, unknown>,
            output: JSON.stringify((tr as any).output),
          });

          const out = (tr as any).output;
          if (out && typeof out === "object" && "success" in out && !out.success) {
            hadToolFailure = true;
            const err = (out as any).error || (out as any).stderr || "unknown error";
            toolFailureSummaries.push(`${String((tr as any).toolName)}: ${String(err)}`.slice(0, 200));
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
            `${String((part as any).toolName)}: ${String((part as any).error)}`.slice(0, 200),
          );
        }
      }

      const pending = await maybeCreatePendingApprovalFromToolLoopResult({
        result,
        messagesSnapshot: [...messages],
        toolCalls,
        projectRoot: this.context.projectRoot,
        permissionEngine: this.permissionEngine,
        sessionId,
        requestId,
        context,
      });
      if (pending) return pending;

      const duration = Date.now() - startTime;
      await this.logger.log("info", "Agent execution completed", {
        duration,
        toolCallsTotal: toolCalls.length,
        context: context?.source,
      });
      await emitStep("done", "done", { requestId, sessionId });

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
        const currentHistory = this.sessions.getOrCreate(sessionId);
        await this.logger.log("warn", "Context length exceeded, compacting history", {
          sessionId,
          currentMessages: currentHistory.length,
          error: errorMsg,
          compactionAttempts,
        });
        await emitStep("compaction", "上下文过长，已自动压缩历史记录后继续。", {
          requestId,
          sessionId,
          compactionAttempts,
        });

        if (compactionAttempts >= 3) {
          this.sessions.delete(sessionId);
          return {
            success: false,
            output:
              "Context length exceeded and compaction failed. History cleared. Please resend your question.",
            toolCalls,
          };
        }

        const compacted = await this.sessions.compactConversationHistory(
          sessionId,
          this.model,
          requestId,
        );
        if (!compacted) {
          this.sessions.delete(sessionId);
          return {
            success: false,
            output:
              "Context length exceeded and compaction was not possible. History cleared. Please resend your question.",
            toolCalls,
          };
        }

        return this.runWithToolLoopAgent(prompt, startTime, context, sessionId, {
          addUserPrompt: false,
          compactionAttempts: compactionAttempts + 1,
          onStep,
          requestId,
        });
      }

      await this.logger.log("error", "Agent execution failed", { error: errorMsg });
      return { success: false, output: `Execution failed: ${errorMsg}`, toolCalls };
    }
  }

  async decideApprovals(
    userMessage: string,
    pendingApprovals: Array<{
      id: string;
      type: string;
      action: string;
      tool?: string;
      input?: unknown;
      details?: unknown;
    }>,
    ctx?: { sessionId?: string; requestId?: string },
  ): Promise<ApprovalDecisionResult> {
    return decideApprovalsWithModel({
      initialized: this.initialized,
      model: this.model,
      userMessage,
      pendingApprovals,
      ctx,
    });
  }

  async handleApprovalReply(input: {
    userMessage: string;
    context?: AgentInput["context"];
    sessionId: string;
    onStep?: AgentInput["onStep"];
  }): Promise<AgentResult | null> {
    const { userMessage, context, sessionId, onStep } = input;

    await this.logger.log("info", "Approval reply received", {
      sessionId,
      source: context?.source,
      userId: context?.userId,
      messagePreview: userMessage.slice(0, 200),
    });

    const pending = this.permissionEngine.getPendingApprovals();
    const relevant = filterRelevantApprovals(pending as any[], sessionId, context);
    if (relevant.length === 0) return null;

    const decisions = await this.decideApprovals(
      userMessage,
      relevant.map((a: any) => ({
        id: a.id,
        type: a.type,
        action: a.action,
        tool: (a as any).tool,
        input: (a as any).input,
        details: a.details,
      })),
      { sessionId },
    );

    const approvals = decisions.approvals || {};
    const refused = decisions.refused || {};

    if (Object.keys(approvals).length === 0 && Object.keys(refused).length === 0) {
      return {
        success: true,
        output: `No approval action taken. Pending approvals: ${relevant.map((a: any) => a.id).join(", ")}`,
        toolCalls: [],
      };
    }

    await this.logger.log("info", "Approval decisions parsed", {
      sessionId,
      approvals: Object.keys(approvals),
      refused: Object.keys(refused),
    });

    const runIds = Array.from(
      new Set(relevant.map((a: any) => (a as any)?.meta?.runId).filter(Boolean)),
    );
    const mergedContext: AgentInput["context"] | undefined =
      runIds.length === 1 ? { ...(context || {}), runId: runIds[0] } : context;

    return this.resumeFromApprovalActions({
      sessionId,
      context: mergedContext,
      approvals,
      refused,
      onStep,
    });
  }

  async resumeFromApprovalActions(input: {
    sessionId: string;
    context?: AgentInput["context"];
    approvals?: Record<string, string>;
    refused?: Record<string, string>;
    onStep?: AgentInput["onStep"];
  }): Promise<AgentResult> {
    const { sessionId, context } = input;
    const approvals = input.approvals || {};
    const refused = input.refused || {};
    const onStep = input.onStep;

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

    const approvedIds = Object.keys(approvals);
    const refusedIds = Object.keys(refused);

    await this.logger.log("info", "Resuming from approval actions", {
      sessionId,
      source: context?.source,
      userId: context?.userId,
      approvedIds,
      refusedIds,
    });

    const baseMessages = await loadBaseMessagesFromApprovals({
      projectRoot: this.context.projectRoot,
      approvedIds,
      refusedIds,
      sessionMessagesSnapshot: this.sessions.getOrCreate(sessionId),
      coerceStoredMessagesToModelMessages: (m) => this.sessions.coerceStoredMessagesToModelMessages(m),
    });
    this.sessions.replace(sessionId, [...baseMessages]);

    const approvalResponses = await applyApprovalActionsAndBuildResponses({
      projectRoot: this.context.projectRoot,
      permissionEngine: this.permissionEngine,
      approvals,
      refused,
    });

    if (approvalResponses.length === 0) {
      return { success: true, output: "No approval action taken.", toolCalls: [] };
    }

    const messages = this.sessions.getOrCreate(sessionId);
    messages.push({ role: "tool", content: approvalResponses as any });
    await emitStep("approval", "已记录审批结果，继续执行。", { sessionId });

    const resumeStart = Date.now();
    const isChatSource =
      context?.source === "telegram" ||
      context?.source === "feishu" ||
      context?.source === "qq";
    const resumePrompt = isChatSource
      ? [
          "Continue execution after applying the approval decisions.",
          "IMPORTANT: deliver user-visible updates via the `send_message` tool (alias: `chat_send`). Do not rely on plain text output only.",
        ].join("\n")
      : "";

    const resumed = await this.runWithToolLoopAgent(resumePrompt, resumeStart, context, sessionId, {
      addUserPrompt: Boolean(resumePrompt),
      onStep,
    });

    if (context?.runId) {
      try {
        const { loadRun, saveRun } = await import("../run/store.js");
        const run = await loadRun(this.context.projectRoot, context.runId);
        if (run) {
          run.status = resumed.success ? "succeeded" : "failed";
          run.finishedAt = getTimestamp();
          run.output = { text: resumed.output };
          run.pendingApproval = undefined;
          run.notified = true;
          if (!resumed.success) run.error = { message: resumed.output || "Run failed" };
          await saveRun(this.context.projectRoot, run);
        }
      } catch {
        // ignore
      }
    }

    return resumed;
  }

  async decideExecutionMode(input: {
    instructions: string;
    context?: AgentInput["context"];
  }): Promise<{ mode: "sync" | "async"; reason: string }> {
    if (!this.model) return { mode: "sync", reason: "No model configured" };

    const instructions = String(input.instructions || "").trim();
    if (!instructions) return { mode: "sync", reason: "Empty instructions" };

    const explicitAsync =
      /(后台|异步|不用等|稍后|晚点|慢慢来|你先跑着|跑起来|排队|队列)/.test(instructions) ||
      /\b(background|async|later|queue|enqueue)\b/i.test(instructions);
    if (!explicitAsync) {
      return { mode: "sync", reason: "Default sync (no explicit async request)" };
    }

    try {
      const result = await withLlmRequestContext(
        { sessionId: input.context?.sessionId },
        () =>
          generateText({
            model: this.model!,
            system:
              "You are an execution-mode router. The user explicitly asked for background execution. " +
              'Return STRICT JSON only: {"mode":"async","reason":"..."}.',
            prompt:
              `Return JSON: {"mode":"async","reason":"..."}.\n\n` +
              `Context:\n` +
              `- source: ${input.context?.source || "unknown"}\n` +
              `- sessionId: ${input.context?.sessionId || "unknown"}\n` +
              `- userId: ${input.context?.userId || "unknown"}\n` +
              `\nUser request:\n${instructions}\n`,
          }),
      );

      const text = (result.text || "").trim();
      const parsed = JSON.parse(text);
      const reason =
        typeof parsed?.reason === "string"
          ? parsed.reason.slice(0, 200)
          : "User requested async";
      return { mode: "async", reason };
    } catch {
      return { mode: "async", reason: "User requested async" };
    }
  }

  async executeApproved(approvalId: string): Promise<{ success: boolean; result: unknown }> {
    const approvalsDir = getApprovalsDirPath(this.context.projectRoot);
    const approvalFile = path.join(approvalsDir, `${approvalId}.json`);

    if (!fs.existsSync(approvalFile)) {
      return { success: false, result: "Approval not found" };
    }

    const approval = (await fs.readJson(approvalFile)) as ApprovalRequest;
    if (approval.status !== "approved") {
      return { success: false, result: "Approval not approved" };
    }

    const toolSet = createToolSet({
      projectRoot: this.context.projectRoot,
      permissionEngine: this.permissionEngine,
      config: this.context.config,
      mcpManager: this.mcpManager,
      logger: this.logger,
    });
    return executeToolDirect(approval.tool, approval.input, toolSet);
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async cleanup(): Promise<void> {
    if (this.mcpManager) await this.mcpManager.close();
  }
}
