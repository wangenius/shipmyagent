#!/usr/bin/env node

/**
 * ShipMyAgent - Agent Runtime with Human-in-the-loop Support
 *
 * Uses ai-sdk v6 ToolLoopAgent for tool calling and
 * built-in support for tool execution approval workflows.
 */

import fs from "fs-extra";
import path from "path";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createLlmLoggingFetch, withLlmRequestContext } from "./llm-logging.js";
import {
  ToolLoopAgent,
  generateText,
  stepCountIs,
  type LanguageModel,
  type ModelMessage,
  type ToolApprovalResponse,
} from "ai";
import {
  getAgentMdPath,
  getShipJsonPath,
  getShipDirPath,
  getMcpDirPath,
  getApprovalsDirPath,
  getLogsDirPath,
  getRunsDirPath,
  getQueueDirPath,
  loadProjectDotenv,
  loadShipConfig,
  ShipConfig,
  getTimestamp,
  generateId
} from "../utils.js";
import type { RunRecord } from "./run-types.js";
import {
  createPermissionEngine,
  PermissionEngine
} from "./permission.js";
import { DEFAULT_SHIP_PROMPTS } from "./ship-prompts.js";
import {
  discoverClaudeSkillsSync,
  renderClaudeSkillsPromptSection,
} from "./skills.js";
import { McpManager } from './mcp-manager.js';
import type { McpConfig } from './mcp-types.js';
import { createAgentToolSet } from "../tool/toolset.js";

// ==================== Types ====================

export interface AgentContext {
  projectRoot: string;
  config: ShipConfig;
  agentMd: string;
}

export interface AgentResult {
  success: boolean;
  output: string;
  toolCalls: Array<{
    tool: string;
    input: Record<string, unknown>;
    output: string;
  }>;
  pendingApproval?: {
    id: string;
    type: string;
    description: string;
    data: Record<string, unknown>;
  };
}

export interface AgentInput {
  instructions: string;
  context?: {
    taskId?: string;
    taskDescription?: string;
    source?: "telegram" | "feishu" | "cli" | "scheduler" | "api";
    userId?: string;
    sessionId?: string;
    runId?: string;
    /**
     * The current human actor (platform sender/user) who triggered this call.
     * In group chats this is different from userId (chat/thread id).
     */
    actorId?: string;
    /**
     * Chat/thread type on the source platform (e.g. Telegram private/group/supergroup).
     * Used only for user-facing phrasing (e.g. addressing the actor in group chats).
     */
    chatType?: string;
    /**
     * Platform username/handle for the current actor (best-effort).
     */
    actorUsername?: string;
    /**
     * Optional explicit initiator (first human who started a thread). If omitted,
     * the runtime will treat actorId as initiator when snapshotting approvals.
     */
    initiatorId?: string;
  };
  onStep?: (event: {
    type: string;
    text: string;
    data?: Record<string, unknown>;
  }) => Promise<void>;
}

export interface ApprovalRequest {
  id: string;
  timestamp: string;
  type: "write_repo" | "exec_shell" | "other";
  description: string;
  tool: string;
  input: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  approvedBy?: string;
  approvedAt?: string;
}

// 对话消息接口
export interface ConversationMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: string;
  timestamp: number;
}

export interface ApprovalDecisionResult {
  approvals?: Record<string, string>;
  refused?: Record<string, string>;
  pass?: Record<string, string>;
}

// ==================== ToolLoopAgent Implementation ====================

/**
 * ToolLoopAgent-based Agent Runtime with Human-in-the-loop support
 */
export class AgentRuntime {
  private context: AgentContext;
  private initialized: boolean = false;
  private logger: AgentLogger;
  private permissionEngine: PermissionEngine;
  private mcpManager: McpManager | null = null;

  private model: LanguageModel | null = null;
  private agent: ToolLoopAgent<never, any, any> | null = null;

  // 对话历史（AI SDK ModelMessage），按 session 隔离
  private sessionMessages: Map<string, ModelMessage[]> = new Map();

  constructor(context: AgentContext) {
    this.context = context;
    this.logger = new AgentLogger(context.projectRoot);
    this.permissionEngine = createPermissionEngine(context.projectRoot);
    this.mcpManager = new McpManager(context.projectRoot, this.logger);
  }

  private getOrCreateSessionMessages(sessionId: string): ModelMessage[] {
    const existing = this.sessionMessages.get(sessionId);
    if (existing) return existing;
    const fresh: ModelMessage[] = [];
    this.sessionMessages.set(sessionId, fresh);
    return fresh;
  }

  private modelMessageContentToText(content: any, maxChars: number): string {
    const truncate = (text: string): string =>
      text.length <= maxChars
        ? text
        : text.slice(0, maxChars) + `…(truncated, ${text.length} chars total)`;
    if (typeof content === "string") return truncate(content);
    if (Array.isArray(content)) {
      const parts = content
        .map((p: any) => {
          if (!p || typeof p !== "object") return "";
          if (p.type === "text") return String(p.text ?? "");
          if (p.type === "input_text") return String(p.text ?? "");
          if (p.type === "tool-approval-request") {
            const toolName = (p.toolCall as any)?.toolName;
            return `Approval requested: ${String(toolName ?? "")}`;
          }
          if (p.type === "tool-call")
            return `Tool call: ${String(p.toolName ?? "")}`;
          if (p.type === "tool-result")
            return `Tool result: ${String(p.toolName ?? "")}`;
          if (p.type === "tool-error")
            return `Tool error: ${String(p.toolName ?? "")}`;
          return "";
        })
        .filter(Boolean)
        .join("\n");
      return truncate(parts);
    }
    if (content && typeof content === "object") {
      try {
        return truncate(JSON.stringify(content));
      } catch {
        return truncate(String(content));
      }
    }
    return truncate(String(content ?? ""));
  }

  private formatModelMessagesForLog(
    messages: ModelMessage[],
    maxCharsTotal: number = 12000,
  ): string {
    const indent = (text: string): string =>
      text
        .split("\n")
        .map((l) => `  ${l}`)
        .join("\n");

    const lines: string[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i] as any;
      const role = String(m?.role ?? "unknown");
      const text =
        this.modelMessageContentToText(m?.content, 4000) || "(empty)";
      lines.push([`[#${i}] role=${role}`, indent(text)].join("\n"));
    }

    const joined = lines.join("\n");
    if (joined.length <= maxCharsTotal) return joined;
    return (
      joined.slice(0, maxCharsTotal) +
      `…(truncated, ${joined.length} chars total)`
    );
  }

  setConversationHistory(sessionId: string, messages: unknown[]): void {
    this.sessionMessages.set(
      sessionId,
      this.coerceStoredMessagesToModelMessages(
        Array.isArray(messages) ? (messages as unknown[]) : [],
      ),
    );
  }

  /**
   * 获取对话历史
   */
  getConversationHistory(sessionId?: string): ConversationMessage[] {
    const toLegacy = (m: ModelMessage): ConversationMessage => {
      const role = (m as any).role as ConversationMessage["role"];
      const content = (m as any).content;
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? JSON.stringify(content).slice(0, 2000)
            : String(content ?? "");
      return {
        role:
          role === "tool"
            ? "tool"
            : role === "assistant"
              ? "assistant"
              : "user",
        content: text,
        timestamp: Date.now(),
      };
    };

    if (!sessionId) {
      const all: ConversationMessage[] = [];
      for (const messages of this.sessionMessages.values()) {
        all.push(...messages.map(toLegacy));
      }
      return all;
    }

    return (this.sessionMessages.get(sessionId) || []).map(toLegacy);
  }

  /**
   * 清除对话历史
   */
  clearConversationHistory(sessionId?: string): void {
    if (!sessionId) {
      this.sessionMessages.clear();
    } else {
      this.sessionMessages.delete(sessionId);
    }
  }

  private coerceStoredMessagesToModelMessages(
    messages: unknown[],
  ): ModelMessage[] {
    // New format: messages are already ModelMessage[]
    if (
      Array.isArray(messages) &&
      messages.every(
        (m) =>
          m &&
          typeof m === "object" &&
          "role" in (m as any) &&
          "content" in (m as any),
      )
    ) {
      return messages as ModelMessage[];
    }

    // Legacy format: ConversationMessage[]
    const out: ModelMessage[] = [];
    for (const raw of messages) {
      if (!raw || typeof raw !== "object") continue;
      const role = (raw as any).role;
      const content = (raw as any).content;
      if (role === "user" || role === "assistant") {
        out.push({ role, content: String(content ?? "") });
      } else if (role === "tool") {
        out.push({
          role: "assistant",
          content: `Tool result:\n${String(content ?? "")}`,
        });
      }
    }
    return out;
  }

  private extractTextForSummary(
    messages: ModelMessage[],
    maxChars: number = 12000,
  ): string {
    const lines: string[] = [];
    for (const m of messages) {
      const role =
        (m as any).role === "assistant"
          ? "Assistant"
          : (m as any).role === "tool"
            ? "Tool"
            : (m as any).role === "user"
              ? "User"
              : "Other";

      const content = (m as any).content;
      if (typeof content === "string") {
        lines.push(`${role}: ${content}`);
        continue;
      }

      if (Array.isArray(content)) {
        const parts = content
          .map((p: any) => {
            if (!p || typeof p !== "object") return "";
            if (p.type === "text") return String(p.text ?? "");
            if (p.type === "tool-approval-request") {
              const toolName = (p.toolCall as any)?.toolName;
              return `Approval requested for tool: ${String(toolName ?? "")}`;
            }
            if (p.type === "tool-result")
              return `Tool result: ${String((p as any).toolName ?? "")}`;
            if (p.type === "tool-error")
              return `Tool error: ${String((p as any).toolName ?? "")}`;
            return "";
          })
          .filter(Boolean)
          .join("\n");
        if (parts) lines.push(`${role}: ${parts}`);
      }
    }

    const text = lines.join("\n\n");
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars) + "\n\n[TRUNCATED]";
  }

  private async compactConversationHistory(
    sessionId: string,
  ): Promise<boolean> {
    const history = this.getOrCreateSessionMessages(sessionId);
    if (history.length < 6) return false;
    if (!this.model) return false;

    // Keep the post-compaction history bounded so we don't repeatedly exceed
    // context length when a session gets very long.
    const maxMessagesAfterCompaction = 50;

    const cut = Math.max(1, Math.floor(history.length * 0.5));
    const older = history.slice(0, cut);
    const newer = history.slice(cut);

    const input = this.extractTextForSummary(older, 12000);
    const result = await withLlmRequestContext({ sessionId }, () =>
      generateText({
        model: this.model!,
        system:
          "You are a summarization assistant. Summarize the conversation faithfully. Preserve key decisions, commands, file paths, IDs, and user intent. Output plain text.",
        prompt: `Summarize the following earlier conversation into a compact summary (<= 400 words):\n\n${input}`,
      }),
    );

    const summaryText =
      (result.text || "").trim() ||
      "[Auto-compact] Earlier conversation was summarized/omitted due to context limits.";
    const summaryMessage: ModelMessage = {
      role: "assistant",
      content: `Summary of earlier messages:\n${summaryText}`,
    };

    const compacted = [summaryMessage, ...newer];
    if (compacted.length > maxMessagesAfterCompaction) {
      const keep = Math.max(0, maxMessagesAfterCompaction - 1);
      const trimmedNewer = keep > 0 ? newer.slice(-keep) : [];
      this.sessionMessages.set(sessionId, [summaryMessage, ...trimmedNewer]);
    } else {
      this.sessionMessages.set(sessionId, compacted);
    }
    return true;
  }

  /**
   * Initialize ToolLoopAgent (AI SDK v6)
   */
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

      // 初始化 MCP 管理器
      await this.initializeMcp();

      const { provider, apiKey, baseUrl, model } = this.context.config.llm;
      const resolvedModel = model === "${}" ? undefined : model;
      const resolvedBaseUrl = baseUrl === "${}" ? undefined : baseUrl;

      if (!resolvedModel) {
        await this.logger.log(
          "warn",
          "No LLM model configured, will use simulation mode",
        );
        return;
      }

      // 解析 API Key，支持环境变量占位符
      let resolvedApiKey = apiKey;
      if (apiKey && apiKey.startsWith("${") && apiKey.endsWith("}")) {
        const envVar = apiKey.slice(2, -1);
        resolvedApiKey = process.env[envVar];
      }

      // 如果没有配置，尝试从常见环境变量中获取
      if (!resolvedApiKey) {
        resolvedApiKey =
          process.env.ANTHROPIC_API_KEY ||
          process.env.OPENAI_API_KEY ||
          process.env.API_KEY;
      }

      if (!resolvedApiKey) {
        await this.logger.log(
          "warn",
          "No API Key configured, will use simulation mode",
        );
        return;
      }

      try {
        const envLog = process.env.SMA_LOG_LLM_MESSAGES;
        const configLog = (this.context.config as any)?.llm?.logMessages;
        const logLlmMessages =
          typeof envLog === "string"
            ? envLog !== "0"
            : typeof configLog === "boolean"
              ? configLog
              : true;

        const loggingFetch = createLlmLoggingFetch({
          logger: this.logger,
          enabled: logLlmMessages,
        });

        let modelInstance: LanguageModel;
        if (provider === "anthropic") {
          const anthropicProvider = createAnthropic({
            apiKey: resolvedApiKey,
            fetch: loggingFetch as any,
          });
          modelInstance = anthropicProvider(resolvedModel);
        } else if (provider === "custom") {
          const compatProvider = createOpenAICompatible({
            name: "custom",
            apiKey: resolvedApiKey,
            baseURL: resolvedBaseUrl || "https://api.openai.com/v1",
            fetch: loggingFetch as any,
          });
          modelInstance = compatProvider(resolvedModel);
        } else {
          const openaiProvider = createOpenAI({
            apiKey: resolvedApiKey,
            baseURL: resolvedBaseUrl || "https://api.openai.com/v1",
            fetch: loggingFetch as any,
          });
          modelInstance = openaiProvider(resolvedModel);
        }

        this.model = modelInstance;
        this.agent = new ToolLoopAgent({
          model: modelInstance,
          instructions: this.context.agentMd,
          tools: this.createToolSet(),
          stopWhen: stepCountIs(20),
          maxOutputTokens: this.context.config.llm.maxTokens || 4096,
          temperature: this.context.config.llm.temperature || 0.7,
          topP: this.context.config.llm.topP,
          frequencyPenalty: this.context.config.llm.frequencyPenalty,
          presencePenalty: this.context.config.llm.presencePenalty,
        });

        await this.logger.log(
          "info",
          "Agent Runtime initialized with ToolLoopAgent",
        );
        this.initialized = true;
      } catch (importError) {
        await this.logger.log(
          "warn",
          `ai-sdk initialization failed: ${String(importError)}, using simulation mode`,
        );
      }
    } catch (error) {
      await this.logger.log("error", "Agent Runtime initialization failed", {
        error: String(error),
      });
    }
  }

  /**
   * 初始化 MCP 管理器
   */
  private async initializeMcp(): Promise<void> {
    try {
      // 读取 MCP 配置文件
      const mcpConfigPath = path.join(
        getMcpDirPath(this.context.projectRoot),
        "mcp.json",
      );

      if (!(await fs.pathExists(mcpConfigPath))) {
        await this.logger.log(
          "info",
          "No MCP configuration found, skipping MCP initialization",
        );
        return;
      }

      const mcpConfigContent = await fs.readFile(mcpConfigPath, "utf-8");
      const mcpConfig: McpConfig = JSON.parse(mcpConfigContent);

      if (!mcpConfig.servers || Object.keys(mcpConfig.servers).length === 0) {
        await this.logger.log("info", "No MCP servers configured");
        return;
      }

      // 初始化 MCP 管理器
      await this.mcpManager?.initialize(mcpConfig);
    } catch (error) {
      await this.logger.log(
        "warn",
        `Failed to initialize MCP: ${String(error)}`,
      );
    }
  }

  private createToolSet() {
    return createAgentToolSet({
      projectRoot: this.context.projectRoot,
      permissionEngine: this.permissionEngine,
      config: this.context.config,
      mcpManager: this.mcpManager,
      logger: this.logger,
    });
  }

  /**
   * Run the agent with the given instructions
   */
  async run(input: AgentInput): Promise<AgentResult> {
    const { instructions, context, onStep } = input;
    const startTime = Date.now();
    const toolCalls: AgentResult["toolCalls"] = [];
    const requestId = generateId();

    // 生成 sessionId（如果没有提供）
    const sessionId = context?.sessionId || context?.userId || "default";

    // Read Agent.md as system prompt
    const systemPrompt = this.context.agentMd;
    await this.logger.log(
      "debug",
      `Using system prompt (Agent.md): ${systemPrompt?.substring(0, 100)}...`,
    );
    await this.logger.log("debug", `Session ID: ${sessionId}`);
    await this.logger.log("info", "Agent request started", {
      requestId,
      sessionId,
      source: context?.source,
      userId: context?.userId,
      instructionsPreview: instructions?.slice(0, 200),
      projectRoot: this.context.projectRoot,
    });

    // Build full prompt with context
    let fullPrompt = instructions;
    if (context?.taskDescription) {
      fullPrompt = `${context.taskDescription}\n\n${instructions}`;
    }

    // Provide a stable runtime context prefix so the model doesn't guess paths.
    // Also: avoid leaking tool logs into user-facing chat replies.
    const runtimePrefix =
      `Runtime context:\n` +
      `- Project root: ${this.context.projectRoot}\n` +
      `- Session: ${sessionId}\n` +
      `- Request ID: ${requestId}\n` +
      (context?.source ? `- Source: ${context.source}\n` : "") +
      (context?.userId ? `- User/Chat ID: ${context.userId}\n` : "") +
      (context?.actorId ? `- Actor ID: ${context.actorId}\n` : "") +
      (context?.actorUsername
        ? `- Actor username: ${context.actorUsername}\n`
        : "") +
      (context?.chatType ? `- Chat type: ${context.chatType}\n` : "") +
      `\nUser-facing output rules:\n` +
      `- Reply in natural language.\n` +
      `- Do NOT paste raw tool outputs or JSON logs; summarize them.\n` +
      (context?.source === "telegram" || context?.source === "feishu"
        ? `- When you need to use tools in multiple steps, include short progress updates as plain text before/around tool usage (no tool names/commands).\n` +
          ((context?.chatType || "").toLowerCase().includes("group")
            ? `- This is a group chat. Prefer addressing the current actor (use @<Actor username> if available) so readers know who you're responding to.\n` +
              `- In a group chat, start your reply with 1 short line that says who you are replying to (the current actor) and that you are the project assistant.\n`
            : "")
        : "");
    fullPrompt = `${runtimePrefix}\n${fullPrompt}`;

    // Frontends may optionally subscribe to onStep; default integrations do not emit step-by-step chat messages.

    // If initialized with model, use ToolLoopAgent
    if (this.initialized && this.agent) {
      return this.runWithToolLoopAgent(
        fullPrompt,
        startTime,
        context,
        sessionId,
        { onStep, requestId },
      );
    }

    // Otherwise use simulation mode
    return this.runSimulated(fullPrompt, startTime, toolCalls, context);
  }

  /**
   * Run with ToolLoopAgent (AI SDK v6).
   */
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
    const requestId = opts?.requestId;

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

    const extractUserFacingTextFromContent = (content: any): string => {
      const parts: string[] = [];
      if (typeof content === "string") {
        if (content.trim()) parts.push(content.trim());
        return parts.join("\n");
      }
      if (Array.isArray(content)) {
        for (const p of content) {
          if (!p || typeof p !== "object") continue;
          const type = String((p as any).type || "");
          if (type === "text" || type === "input_text") {
            const t = String((p as any).text ?? "").trim();
            if (t) parts.push(t);
          }
        }
        return parts.join("\n").trim();
      }
      return "";
    };

    const extractUserFacingTextFromStep = (step: any): string => {
      const normalize = (s: string): string =>
        s
          .replace(/\r\n/g, "\n")
          .replace(/[ \t]+\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();

      const candidates: string[] = [];
      const stepText =
        typeof step?.text === "string" ? normalize(step.text) : "";
      if (stepText) candidates.push(stepText);

      const contentTextRaw = extractUserFacingTextFromContent(step?.content);
      const contentText = contentTextRaw ? normalize(contentTextRaw) : "";
      if (contentText) candidates.push(contentText);

      const msgs = Array.isArray(step?.messages) ? step.messages : [];
      for (const m of msgs) {
        if (!m || typeof m !== "object") continue;
        const role = String((m as any).role || "");
        if (role !== "assistant") continue;
        const tRaw = extractUserFacingTextFromContent((m as any).content);
        const t = tRaw ? normalize(tRaw) : "";
        if (t) candidates.push(t);
      }

      const uniq: string[] = [];
      for (const c of candidates) {
        if (!c) continue;
        if (uniq.includes(c)) continue;
        uniq.push(c);
      }
      if (uniq.length === 0) return "";

      // Prefer the most complete candidate to avoid duplicated concatenation.
      uniq.sort((a, b) => b.length - a.length);
      return uniq[0];
    };

    try {
      if (!this.agent) throw new Error("Agent not initialized");

      const messages = this.getOrCreateSessionMessages(sessionId);
      if (addUserPrompt && prompt) {
        messages.push({ role: "user", content: prompt });
      }

      const beforeLen = messages.length;
      let lastEmittedAssistant = "";
      const result = await withLlmRequestContext({ sessionId, requestId }, () =>
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
              for (const tr of step.toolResults || []) {
                if (tr.type !== "tool-result") continue;
                const toolName = (tr as any).toolName;

                // 处理 exec_shell 工具
                if (toolName === "exec_shell") {
                  const command = String(
                    ((tr as any).input as any)?.command || "",
                  ).trim();
                  const exitCode = ((tr as any).output as any)?.exitCode;
                  const stdout = String(
                    ((tr as any).output as any)?.stdout || "",
                  ).trim();
                  const stderr = String(
                    ((tr as any).output as any)?.stderr || "",
                  ).trim();
                  const snippet = (stdout || stderr).slice(0, 500);
                  await emitStep(
                    "step_finish",
                    `已执行：${command}${typeof exitCode === "number" ? `（exitCode=${exitCode}）` : ""}${snippet ? `\n摘要：${snippet}${(stdout || stderr).length > 500 ? "…" : ""}` : ""}`,
                    {
                      toolName: "exec_shell",
                      command,
                      exitCode:
                        typeof exitCode === "number" ? exitCode : undefined,
                      requestId,
                      sessionId,
                    },
                  );
                }
                // 处理 MCP 工具
                else if (toolName && String(toolName).includes(":")) {
                  const output = ((tr as any).output as any)?.output || "";
                  const snippet = String(output).slice(0, 500);
                  await emitStep(
                    "step_finish",
                    `已执行 MCP 工具：${toolName}${snippet ? `\n结果：${snippet}${String(output).length > 500 ? "…" : ""}` : ""}`,
                    { toolName, requestId, sessionId },
                  );
                }
              }
            } catch {
              // ignore
            }
          },
        }),
      );

      try {
        const responseMessages = (result.response?.messages ||
          []) as ModelMessage[];
        await this.logger.log(
          "info",
          [
            "===== LLM RESPONSE BEGIN =====",
            ...(requestId ? [`requestId: ${requestId}`] : []),
            `sessionId: ${sessionId}`,
            `historyBefore: ${beforeLen}`,
            `responseMessages: ${responseMessages.length}`,
            responseMessages.length
              ? `\n${this.formatModelMessagesForLog(responseMessages)}`
              : "",
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
        // ignore logging failures
      }

      messages.push(...result.response.messages);

      // Collect tool calls/results for auditing
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

      // Tool approval requests (AI SDK)
      const approvalParts = (result.content || []).filter(
        (p: any) =>
          p && typeof p === "object" && p.type === "tool-approval-request",
      ) as Array<{
        type: "tool-approval-request";
        approvalId: string;
        toolCall: { toolName: string; input: unknown; toolCallId?: string };
      }>;

      if (approvalParts.length > 0) {
        const created: Array<{
          id: string;
          toolName: string;
          args: Record<string, unknown>;
          aiApprovalId: string;
        }> = [];

        for (const part of approvalParts) {
          const toolName = part.toolCall.toolName;
          const input = (part.toolCall as any).input || {};
          const args =
            input && typeof input === "object"
              ? (input as Record<string, unknown>)
              : {};

          let approvalId: string | undefined;
          let requiresApproval = false;

          // 处理 exec_shell 工具
          if (toolName === "exec_shell") {
            const command = String((args as any).command || "").trim();
            const permission =
              await this.permissionEngine.checkExecShell(command);

            if (permission.requiresApproval && (permission as any).approvalId) {
              approvalId = String((permission as any).approvalId);
              requiresApproval = true;
            }
          }
          // 处理 MCP 工具（格式：server:toolName）
          else if (toolName && String(toolName).includes(":")) {
            const approvalRequest =
              await this.permissionEngine.createGenericApprovalRequest({
                type: "mcp_tool",
                action: `Call MCP tool: ${toolName}`,
                details: { toolName, args },
                tool: toolName,
                input: args,
              });
            approvalId = approvalRequest.id;
            requiresApproval = true;
          }

          if (!requiresApproval || !approvalId) {
            continue;
          }

          // 保存审批请求的元数据
          await this.permissionEngine.updateApprovalRequest(approvalId, {
            tool: toolName,
            input: args,
            messages: [...messages] as unknown[],
            meta: {
              sessionId,
              source: context?.source,
              userId: context?.userId,
              actorId: context?.actorId,
              initiatorId: context?.initiatorId ?? context?.actorId,
              requestId,
              aiApprovalId: part.approvalId,
              runId: context?.runId,
            },
          });

          created.push({
            id: approvalId,
            toolName,
            args,
            aiApprovalId: part.approvalId,
          });
        }

        if (created.length > 0) {
          const first = created[0];
          const description =
            first.toolName === "exec_shell"
              ? `Execute command: ${String((first.args as any)?.command || "")}`
              : `Call tool: ${first.toolName}`;

          const pendingText =
            `⏳ 需要你确认一下我接下来要做的操作（已发起审批请求）。\n` +
            `操作: ${description}\n\n` +
            `你可以直接用自然语言回复，比如：\n` +
            `- "可以" / "同意"\n` +
            `- "不可以，因为 …" / "拒绝，因为 …"\n` +
            `- "全部同意" / "全部拒绝"`;

          return {
            success: false,
            output: pendingText,
            toolCalls,
            pendingApproval: {
              id: first.id,
              type: first.toolName === "exec_shell" ? "exec_shell" : "other",
              description,
              data: {
                toolName: first.toolName,
                args: first.args,
                aiApprovalId: first.aiApprovalId,
              },
            },
          };
        }
      }

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
        const currentHistory = this.getOrCreateSessionMessages(sessionId);
        await this.logger.log(
          "warn",
          "Context length exceeded, compacting history",
          {
            sessionId,
            currentMessages: currentHistory.length,
            error: errorMsg,
            compactionAttempts,
          },
        );
        await emitStep("compaction", "上下文过长，已自动压缩历史记录后继续。", {
          requestId,
          sessionId,
          compactionAttempts,
        });

        if (compactionAttempts >= 3) {
          this.sessionMessages.delete(sessionId);
          return {
            success: false,
            output: `Context length exceeded and compaction failed. History cleared. Please resend your question.`,
            toolCalls,
          };
        }

        const compacted = await this.compactConversationHistory(sessionId);
        if (!compacted) {
          this.sessionMessages.delete(sessionId);
          return {
            success: false,
            output: `Context length exceeded and compaction was not possible. History cleared. Please resend your question.`,
            toolCalls,
          };
        }

        return this.runWithToolLoopAgent(
          prompt,
          startTime,
          context,
          sessionId,
          {
            addUserPrompt: false,
            compactionAttempts: compactionAttempts + 1,
            onStep,
            requestId,
          },
        );
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
    if (!this.initialized || !this.model) {
      return {
        pass: Object.fromEntries(pendingApprovals.map((a) => [a.id, ""])),
      };
    }

    const compactList = pendingApprovals.map((a) => ({
      id: a.id,
      type: a.type,
      action: a.action,
      tool: a.tool,
      input: a.input,
      details: a.details,
    }));

    const result = await withLlmRequestContext(
      { sessionId: ctx?.sessionId, requestId: ctx?.requestId },
      () =>
        generateText({
          model: this.model!,
          system: [
            "You are an approval-routing assistant.",
            "Given a user message and a list of pending approval requests, decide which approvals to approve, refuse, or pass.",
            "Return ONLY valid JSON with this exact structure:",
            '{ "approvals": { "<id>": "<any string>" }, "refused": { "<id>": "<reason>" }, "pass": { "<id>": "<any string>" } }',
            'If the user is ambiguous, put everything into "pass".',
          ].join("\n"),
          prompt: `User message:\n${userMessage}\n\nPending approvals:\n${JSON.stringify(compactList, null, 2)}\n\nReturn JSON only.`,
        }),
    );

    try {
      const parsed = JSON.parse(
        (result.text || "").trim(),
      ) as ApprovalDecisionResult;
      return parsed && typeof parsed === "object"
        ? parsed
        : { pass: Object.fromEntries(pendingApprovals.map((a) => [a.id, ""])) };
    } catch {
      return {
        pass: Object.fromEntries(pendingApprovals.map((a) => [a.id, ""])),
      };
    }
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
    const relevant = pending.filter((a: any) => {
      const metaSessionId = (a as any)?.meta?.sessionId;
      const metaUserId = (a as any)?.meta?.userId;
      if (metaSessionId && metaSessionId === sessionId) return true;
      if (
        !metaSessionId &&
        metaUserId &&
        context?.userId &&
        metaUserId === context.userId
      )
        return true;
      return false;
    });

    if (relevant.length === 0) return null;

    const decisions = await this.decideApprovals(
      userMessage,
      relevant.map((a) => ({
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

    if (
      Object.keys(approvals).length === 0 &&
      Object.keys(refused).length === 0
    ) {
      return {
        success: true,
        output: `No approval action taken. Pending approvals: ${relevant.map((a) => a.id).join(", ")}`,
        toolCalls: [],
      };
    }

    await this.logger.log("info", "Approval decisions parsed", {
      sessionId,
      approvals: Object.keys(approvals),
      refused: Object.keys(refused),
    });

    // If these approvals belong to a background Run, copy runId into context so resume can update run record.
    const runIds = Array.from(
      new Set(
        relevant.map((a: any) => (a as any)?.meta?.runId).filter(Boolean),
      ),
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
    const refusedEntries = Object.entries(refused);

    await this.logger.log("info", "Resuming from approval actions", {
      sessionId,
      source: context?.source,
      userId: context?.userId,
      approvedIds,
      refusedIds: refusedEntries.map(([id]) => id),
    });

    const approvalsDir = getApprovalsDirPath(this.context.projectRoot);

    // Load snapshot from the first referenced approval that has messages.
    let baseMessages: ModelMessage[] | null = null;
    const idsToTry = [...approvedIds, ...refusedEntries.map(([id]) => id)];
    for (const id of idsToTry) {
      const file = path.join(approvalsDir, `${id}.json`);
      if (!fs.existsSync(file)) continue;
      try {
        const data = (await fs.readJson(file)) as any;
        if (Array.isArray(data?.messages)) {
          baseMessages = this.coerceStoredMessagesToModelMessages(
            data.messages as unknown[],
          );
          break;
        }
      } catch {
        // ignore
      }
    }
    if (!baseMessages) {
      baseMessages = [...this.getOrCreateSessionMessages(sessionId)];
    }

    this.sessionMessages.set(sessionId, [...baseMessages]);

    const approvalResponses: ToolApprovalResponse[] = [];

    for (const approvalId of approvedIds) {
      const file = path.join(approvalsDir, `${approvalId}.json`);
      if (!fs.existsSync(file)) continue;
      try {
        const data = (await fs.readJson(file)) as any;
        const aiApprovalId = data?.meta?.aiApprovalId;
        if (!aiApprovalId) continue;
        approvalResponses.push({
          type: "tool-approval-response",
          approvalId: String(aiApprovalId),
          approved: true,
          reason: approvals[approvalId] || "Approved",
        });
      } catch {
        // ignore
      }
    }

    for (const [approvalId, reason] of refusedEntries) {
      const file = path.join(approvalsDir, `${approvalId}.json`);
      if (!fs.existsSync(file)) continue;
      try {
        const data = (await fs.readJson(file)) as any;
        const aiApprovalId = data?.meta?.aiApprovalId;
        if (!aiApprovalId) continue;
        approvalResponses.push({
          type: "tool-approval-response",
          approvalId: String(aiApprovalId),
          approved: false,
          reason: reason || "Rejected",
        });
      } catch {
        // ignore
      }
    }

    // Persist decision state and delete approval files (ShipMyAgent requirement).
    for (const approvalId of approvedIds) {
      await this.permissionEngine.updateApprovalRequest(approvalId, {
        status: "approved",
        respondedAt: getTimestamp(),
        response: approvals[approvalId] || "Approved",
      });
      await this.permissionEngine.deleteApprovalRequest(approvalId);
    }
    for (const [approvalId, reason] of refusedEntries) {
      await this.permissionEngine.updateApprovalRequest(approvalId, {
        status: "rejected",
        respondedAt: getTimestamp(),
        response: reason || "Rejected",
      });
      await this.permissionEngine.deleteApprovalRequest(approvalId);
    }

    if (approvalResponses.length === 0) {
      return {
        success: true,
        output: "No approval action taken.",
        toolCalls: [],
      };
    }

    // Add a tool message with approval responses and continue the agent loop.
    const messages = this.getOrCreateSessionMessages(sessionId);
    messages.push({ role: "tool", content: approvalResponses as any });
    await emitStep("approval", "已记录审批结果，继续执行。", { sessionId });

    const resumeStart = Date.now();
    const resumed = await this.runWithToolLoopAgent(
      "",
      resumeStart,
      context,
      sessionId,
      { addUserPrompt: false, onStep },
    );

    // If this approval was part of a background Run, update the run record to reflect completion.
    if (context?.runId) {
      try {
        const { loadRun, saveRun } = await import("./run-store.js");
        const run = await loadRun(this.context.projectRoot, context.runId);
        if (run) {
          run.status = resumed.success ? "succeeded" : "failed";
          run.finishedAt = getTimestamp();
          run.output = { text: resumed.output };
          run.pendingApproval = undefined;
          run.notified = true;
          if (!resumed.success) {
            run.error = { message: resumed.output || "Run failed" };
          }
          await saveRun(this.context.projectRoot, run);
        }
      } catch {
        // ignore
      }
    }

    return resumed;
  }

  /**
   * Decide whether to run synchronously or enqueue a background Run.
   * Returns { mode, reason }.
   */
  async decideExecutionMode(input: {
    instructions: string;
    context?: AgentInput["context"];
  }): Promise<{ mode: "sync" | "async"; reason: string }> {
    if (!this.model) return { mode: "sync", reason: "No model configured" };

    const instructions = String(input.instructions || "").trim();
    if (!instructions) return { mode: "sync", reason: "Empty instructions" };

    // Sync-first: only run in background when the user explicitly asks for it.
    // This avoids "surprise async" behavior in chats.
    const explicitAsync =
      /(后台|异步|不用等|稍后|晚点|慢慢来|你先跑着|跑起来|排队|队列)/.test(
        instructions,
      ) || /\b(background|async|later|queue|enqueue)\b/i.test(instructions);
    if (!explicitAsync) {
      return {
        mode: "sync",
        reason: "Default sync (no explicit async request)",
      };
    }

    // If explicitly requested, still ask the model for a short reason (best-effort),
    // but never override the user's explicit intent.
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

  /**
   * Simulation mode for when AI is not available
   */
  private runSimulated(
    prompt: string,
    startTime: number,
    toolCalls: AgentResult["toolCalls"],
    context?: AgentInput["context"],
  ): AgentResult {
    const promptLower = prompt.toLowerCase();
    let output = "";

    if (promptLower.includes("status") || promptLower.includes("状态")) {
      output = this.generateStatusResponse();
    } else if (promptLower.includes("task") || promptLower.includes("任务")) {
      output = this.generateTasksResponse();
    } else if (promptLower.includes("scan") || promptLower.includes("扫描")) {
      output = this.generateScanResponse();
    } else if (
      promptLower.includes("approve") ||
      promptLower.includes("审批")
    ) {
      output = this.generateApprovalsResponse();
    } else {
      output = `Received: "${prompt}"\n\n[Simulation Mode] AI service not configured. Please configure API Key in ship.json and restart.`;
    }

    const duration = Date.now() - startTime;
    this.logger.log("info", `Simulated agent execution completed`, {
      duration,
      context: context?.source,
    });

    return {
      success: true,
      output,
      toolCalls,
    };
  }

  private generateStatusResponse(): string {
    const { config } = this.context;
    return `📊 **Agent Status Report**

**Project**: ${config.name}
**Version**: ${config.version}
**Model**: ${config.llm.provider} / ${config.llm.model}

**Permissions**:
- Read repository: ✅ ${typeof config.permissions.read_repo === "boolean" ? (config.permissions.read_repo ? "Enabled" : "Disabled") : "Enabled (with path restrictions)"}
- Write code: ${config.permissions.write_repo ? (config.permissions.write_repo.requiresApproval ? "⚠️ Requires approval" : "✅ Enabled") : "❌ Disabled"}
- Execute shell: ${config.permissions.exec_shell ? (config.permissions.exec_shell.requiresApproval ? "⚠️ Requires approval" : "✅ Enabled") : "❌ Disabled"}

**Runtime**: Normal`;
  }

  private generateTasksResponse(): string {
    const tasksDir = path.join(this.context.projectRoot, ".ship", "tasks");

    if (!fs.existsSync(tasksDir)) {
      return `📋 **Task List**

No scheduled tasks configured.

Add .md files in .ship/tasks/ to define tasks.`;
    }

    const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md"));

    if (files.length === 0) {
      return `📋 **Task List**

No scheduled tasks configured.`;
    }

    return `📋 **Task List**

Configured ${files.length} tasks:
${files.map((f) => `- ${f.replace(".md", "")}`).join("\n")}

Task definitions: .ship/tasks/`;
  }

  private generateScanResponse(): string {
    return `🔍 **Code Scan Results**

Directory: ${this.context.projectRoot}

**Findings**:
- Code structure: Normal
- Tests: Recommend running tests regularly

**TODO comments**: None detected`;
  }

  private generateApprovalsResponse(): string {
    return `📋 **Approvals**

No pending approval requests.`;
  }

  /**
   * Execute an approved operation (called after approval)
   */
  async executeApproved(
    approvalId: string,
  ): Promise<{ success: boolean; result: unknown }> {
    const approvalsDir = getApprovalsDirPath(this.context.projectRoot);
    const approvalFile = path.join(approvalsDir, `${approvalId}.json`);

    if (!fs.existsSync(approvalFile)) {
      return { success: false, result: "Approval not found" };
    }

    const approval = (await fs.readJson(approvalFile)) as ApprovalRequest;
    if (approval.status !== "approved") {
      return { success: false, result: "Approval not approved" };
    }

    // Execute the approved operation
    const result = await this.executeTool(approval.tool, approval.input);
    return result;
  }

  /**
   * Execute a tool directly (for approved operations)
   */
  private async executeTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ success: boolean; result: unknown }> {
    const tools = this.createToolSet();
    const tool = tools[toolName as keyof typeof tools];

    if (!tool || typeof tool.execute !== "function") {
      return { success: false, result: `Unknown tool: ${toolName}` };
    }

    try {
      const result = await tool.execute(args);
      return { success: true, result };
    } catch (error) {
      return { success: false, result: String(error) };
    }
  }

  /**
   * Check if agent is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 清理资源（关闭 MCP 连接等）
   */
  async cleanup(): Promise<void> {
    if (this.mcpManager) {
      await this.mcpManager.close();
    }
  }
}

// ==================== Logger ====================

class AgentLogger {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  async log(
    level: string,
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    const logsDir = getLogsDirPath(this.projectRoot);
    await fs.ensureDir(logsDir);

    const logEntry = {
      timestamp: getTimestamp(),
      level,
      message,
      ...(data || {}),
    };

    const today = new Date().toISOString().split("T")[0];
    const logFile = path.join(logsDir, `${today}.jsonl`);

    // Use JSONL format (one JSON object per line) to avoid concurrent write issues
    const logLine = JSON.stringify(logEntry) + "\n";
    await fs.appendFile(logFile, logLine, "utf-8");

    const colors: Record<string, string> = {
      info: "\x1b[32m",
      warn: "\x1b[33m",
      error: "\x1b[31m",
      debug: "\x1b[36m",
    };
    const color = colors[level] || "\x1b[0m";
    console.log(`${color}[${level.toUpperCase()}]${"\x1b[0m"} ${message}`);
  }

  info(message: string): void {
    console.log(`\x1b[32m[INFO]\x1b[0m ${message}`);
  }

  warn(message: string): void {
    console.log(`\x1b[33m[WARN]\x1b[0m ${message}`);
  }

  error(message: string): void {
    console.log(`\x1b[31m[ERROR]\x1b[0m ${message}`);
  }
}

// ==================== Factory Functions ====================

export function createAgentRuntime(context: AgentContext): AgentRuntime {
  return new AgentRuntime(context);
}

export function createAgentRuntimeFromPath(projectRoot: string): AgentRuntime {
  loadProjectDotenv(projectRoot);

  // Read configuration
  const agentMdPath = getAgentMdPath(projectRoot);
  const shipJsonPath = getShipJsonPath(projectRoot);

  // Default user identity if no Agent.md exists
  let userAgentMd = `# Agent Role

You are a helpful project assistant.`;

  let config: ShipConfig = {
    name: "shipmyagent",
    version: "1.0.0",
    llm: {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      baseUrl: "https://api.anthropic.com/v1",
      temperature: 0.7,
    },
    permissions: {
      read_repo: true,
      write_repo: { requiresApproval: true },
      exec_shell: { deny: ["rm"], requiresApproval: false },
    },
    integrations: {
      telegram: { enabled: false },
    },
  };

  // Ensure .ship directory exists
  const shipDir = getShipDirPath(projectRoot);
  fs.ensureDirSync(shipDir);
  fs.ensureDirSync(path.join(shipDir, "tasks"));
  fs.ensureDirSync(path.join(shipDir, "runs"));
  fs.ensureDirSync(path.join(shipDir, "queue"));
  fs.ensureDirSync(path.join(shipDir, "routes"));
  fs.ensureDirSync(path.join(shipDir, "approvals"));
  fs.ensureDirSync(path.join(shipDir, "logs"));
  fs.ensureDirSync(path.join(shipDir, ".cache"));
  fs.ensureDirSync(path.join(shipDir, "public"));

  // Read user's Agent.md (identity/role definition)
  try {
    if (fs.existsSync(agentMdPath)) {
      const content = fs.readFileSync(agentMdPath, "utf-8").trim();
      if (content) {
        userAgentMd = content;
      }
    }
  } catch {
    // Use default identity
  }

  // Read ship.json
  try {
    if (fs.existsSync(shipJsonPath)) {
      config = loadShipConfig(projectRoot) as ShipConfig;
    }
  } catch {
    // Use default
  }

  // Combine user identity + ship prompts + system shell guide
  const baseAgentMd = [userAgentMd, `---\n\n${DEFAULT_SHIP_PROMPTS}`]
    .filter(Boolean)
    .join("\n\n");

  const skills = discoverClaudeSkillsSync(projectRoot, config);
  const skillsSection = renderClaudeSkillsPromptSection(
    projectRoot,
    config,
    skills,
  );

  const agentMd = [baseAgentMd, `---\n\n${skillsSection}`]
    .filter(Boolean)
    .join("\n\n");

  return new AgentRuntime({
    projectRoot,
    config,
    agentMd,
  });
}
