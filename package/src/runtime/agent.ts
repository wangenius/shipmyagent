#!/usr/bin/env node

/**
 * ShipMyAgent - Agent Runtime with Human-in-the-loop Support
 * 
 * Uses ai-sdk v6 ToolLoopAgent for tool calling and
 * built-in support for tool execution approval workflows.
 */

import fs from 'fs-extra';
import path from 'path';
import { z } from 'zod';
import { execa } from 'execa';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  ToolLoopAgent,
  generateText,
  stepCountIs,
  tool,
  type LanguageModel,
  type ModelMessage,
  type ToolApprovalResponse,
  type ToolExecutionOptions,
} from 'ai';
import {
  getAgentMdPath,
  getShipJsonPath,
  getShipDirPath,
  getApprovalsDirPath,
  getLogsDirPath,
  loadProjectDotenv,
  loadShipConfig,
  ShipConfig,
  getTimestamp,
  generateId,
  DEFAULT_SHELL_GUIDE,
} from '../utils.js';
import { createPermissionEngine, PermissionEngine, PermissionCheckResult, extractExecShellCommandNames } from './permission.js';
import { DEFAULT_SHIP_PROMPTS } from './ship-prompts.js';

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
    source?: 'telegram' | 'feishu' | 'cli' | 'scheduler' | 'api';
    userId?: string;
    sessionId?: string;
    runId?: string;
    /**
     * The current human actor (platform sender/user) who triggered this call.
     * In group chats this is different from userId (chat/thread id).
     */
    actorId?: string;
    /**
     * Optional explicit initiator (first human who started a thread). If omitted,
     * the runtime will treat actorId as initiator when snapshotting approvals.
     */
    initiatorId?: string;
  };
  onStep?: (event: { type: string; text: string; data?: Record<string, unknown> }) => Promise<void>;
}

export interface ApprovalRequest {
  id: string;
  timestamp: string;
  type: 'write_repo' | 'exec_shell' | 'other';
  description: string;
  tool: string;
  input: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected';
  approvedBy?: string;
  approvedAt?: string;
}

// 对话消息接口
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'tool';
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

  private model: LanguageModel | null = null;
  private agent: ToolLoopAgent<never, any, any> | null = null;

  // 对话历史（AI SDK ModelMessage），按 session 隔离
  private sessionMessages: Map<string, ModelMessage[]> = new Map();

  constructor(context: AgentContext) {
    this.context = context;
    this.logger = new AgentLogger(context.projectRoot);
    this.permissionEngine = createPermissionEngine(context.projectRoot);
  }

  private getOrCreateSessionMessages(sessionId: string): ModelMessage[] {
    const existing = this.sessionMessages.get(sessionId);
    if (existing) return existing;
    const fresh: ModelMessage[] = [];
    this.sessionMessages.set(sessionId, fresh);
    return fresh;
  }

  setConversationHistory(sessionId: string, messages: unknown[]): void {
    this.sessionMessages.set(
      sessionId,
      this.coerceStoredMessagesToModelMessages(Array.isArray(messages) ? (messages as unknown[]) : []),
    );
  }

  /**
   * 获取对话历史
   */
  getConversationHistory(sessionId?: string): ConversationMessage[] {
    const toLegacy = (m: ModelMessage): ConversationMessage => {
      const role = (m as any).role as ConversationMessage['role'];
      const content = (m as any).content;
      const text =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? JSON.stringify(content).slice(0, 2000)
            : String(content ?? '');
      return { role: role === 'tool' ? 'tool' : role === 'assistant' ? 'assistant' : 'user', content: text, timestamp: Date.now() };
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

  private coerceStoredMessagesToModelMessages(messages: unknown[]): ModelMessage[] {
    // New format: messages are already ModelMessage[]
    if (
      Array.isArray(messages) &&
      messages.every((m) => m && typeof m === 'object' && 'role' in (m as any) && 'content' in (m as any))
    ) {
      return messages as ModelMessage[];
    }

    // Legacy format: ConversationMessage[]
    const out: ModelMessage[] = [];
    for (const raw of messages) {
      if (!raw || typeof raw !== 'object') continue;
      const role = (raw as any).role;
      const content = (raw as any).content;
      if (role === 'user' || role === 'assistant') {
        out.push({ role, content: String(content ?? '') });
      } else if (role === 'tool') {
        out.push({ role: 'assistant', content: `Tool result:\n${String(content ?? '')}` });
      }
    }
    return out;
  }

  private extractTextForSummary(messages: ModelMessage[], maxChars: number = 12000): string {
    const lines: string[] = [];
    for (const m of messages) {
      const role =
        (m as any).role === 'assistant' ? 'Assistant' :
        (m as any).role === 'tool' ? 'Tool' :
        (m as any).role === 'user' ? 'User' :
        'Other';

      const content = (m as any).content;
      if (typeof content === 'string') {
        lines.push(`${role}: ${content}`);
        continue;
      }

      if (Array.isArray(content)) {
        const parts = content
          .map((p: any) => {
            if (!p || typeof p !== 'object') return '';
            if (p.type === 'text') return String(p.text ?? '');
            if (p.type === 'tool-approval-request') {
              const toolName = (p.toolCall as any)?.toolName;
              return `Approval requested for tool: ${String(toolName ?? '')}`;
            }
            if (p.type === 'tool-result') return `Tool result: ${String((p as any).toolName ?? '')}`;
            if (p.type === 'tool-error') return `Tool error: ${String((p as any).toolName ?? '')}`;
            return '';
          })
          .filter(Boolean)
          .join('\n');
        if (parts) lines.push(`${role}: ${parts}`);
      }
    }

    const text = lines.join('\n\n');
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars) + '\n\n[TRUNCATED]';
  }

  private async compactConversationHistory(sessionId: string): Promise<boolean> {
    const history = this.getOrCreateSessionMessages(sessionId);
    if (history.length < 6) return false;
    if (!this.model) return false;

    const cut = Math.max(1, Math.floor(history.length * 0.5));
    const older = history.slice(0, cut);
    const newer = history.slice(cut);

    const input = this.extractTextForSummary(older, 12000);
    const result = await generateText({
      model: this.model,
      system:
        'You are a summarization assistant. Summarize the conversation faithfully. Preserve key decisions, commands, file paths, IDs, and user intent. Output plain text.',
      prompt: `Summarize the following earlier conversation into a compact summary (<= 400 words):\n\n${input}`,
    });

    const summaryText = (result.text || '').trim() || '[Auto-compact] Earlier conversation was summarized/omitted due to context limits.';
    const summaryMessage: ModelMessage = {
      role: 'assistant',
      content: `Summary of earlier messages:\n${summaryText}`,
    };

    this.sessionMessages.set(sessionId, [summaryMessage, ...newer]);
    return true;
  }

  /**
   * Initialize ToolLoopAgent (AI SDK v6)
   */
  async initialize(): Promise<void> {
    try {
      await this.logger.log('info', 'Initializing Agent Runtime with ToolLoopAgent (AI SDK v6)');
      await this.logger.log('info', `Agent.md content length: ${this.context.agentMd?.length || 0} chars`);

      const { provider, apiKey, baseUrl, model } = this.context.config.llm;
      const resolvedModel = model === '${}' ? undefined : model;
      const resolvedBaseUrl = baseUrl === '${}' ? undefined : baseUrl;

      if (!resolvedModel) {
        await this.logger.log('warn', 'No LLM model configured, will use simulation mode');
        return;
      }

      // 解析 API Key，支持环境变量占位符
      let resolvedApiKey = apiKey;
      if (apiKey && apiKey.startsWith('${') && apiKey.endsWith('}')) {
        const envVar = apiKey.slice(2, -1);
        resolvedApiKey = process.env[envVar];
      }

      // 如果没有配置，尝试从常见环境变量中获取
      if (!resolvedApiKey) {
        resolvedApiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.API_KEY;
      }

      if (!resolvedApiKey) {
        await this.logger.log('warn', 'No API Key configured, will use simulation mode');
        return;
      }

      try {
        let modelInstance: LanguageModel;
        if (provider === 'anthropic') {
          const anthropicProvider = createAnthropic({ apiKey: resolvedApiKey });
          modelInstance = anthropicProvider(resolvedModel);
        } else if (provider === 'custom') {
          const compatProvider = createOpenAICompatible({
            name: 'custom',
            apiKey: resolvedApiKey,
            baseURL: resolvedBaseUrl || 'https://api.openai.com/v1',
          });
          modelInstance = compatProvider(resolvedModel);
        } else {
          const openaiProvider = createOpenAI({
            apiKey: resolvedApiKey,
            baseURL: resolvedBaseUrl || 'https://api.openai.com/v1',
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

        await this.logger.log('info', 'Agent Runtime initialized with ToolLoopAgent');
        this.initialized = true;
      } catch (importError) {
        await this.logger.log('warn', `ai-sdk initialization failed: ${String(importError)}, using simulation mode`);
      }
    } catch (error) {
      await this.logger.log('error', 'Agent Runtime initialization failed', { error: String(error) });
    }
  }

  private preflightExecShell(command: string): { allowed: boolean; deniedReason?: string; needsApproval: boolean } {
    const execConfig = this.context.config.permissions.exec_shell;
    if (!execConfig) {
      return { allowed: false, deniedReason: 'Shell execution permission not configured', needsApproval: false };
    }

    const commandNames = extractExecShellCommandNames(command);
    if (commandNames.length === 0) {
      return { allowed: false, deniedReason: 'Empty command', needsApproval: false };
    }

    if (execConfig.deny && execConfig.deny.length > 0) {
      const deniedNames = execConfig.deny
        .map((d) => String(d).trim().split(/\s+/)[0] || '')
        .filter(Boolean)
        .map((d) => d.split('/').pop() || d);
      const hit = commandNames.find((n) => deniedNames.includes(n));
      if (hit) return { allowed: false, deniedReason: `Command denied by blacklist: ${hit}`, needsApproval: false };
    } else if (execConfig.allow && execConfig.allow.length > 0) {
      // Legacy allowlist fallback
      const allowedNames = execConfig.allow
        .map((a) => String(a).trim().split(/\s+/)[0] || '')
        .filter(Boolean)
        .map((a) => a.split('/').pop() || a);
      const isAllowed = commandNames.every((n) => allowedNames.includes(n));
      if (!isAllowed) return { allowed: false, deniedReason: 'Command not in allow list', needsApproval: false };
    }

    return { allowed: true, needsApproval: Boolean(execConfig.requiresApproval) };
  }

  private createToolSet() {
    return {
      exec_shell: tool({
        description: `Execute a shell command. This is your ONLY tool for interacting with the filesystem and codebase.

Use this tool for ALL operations:
- Reading files: cat, head, tail, less
- Writing files: echo >, cat > file << EOF, sed -i
- Searching: grep -r, find, rg
- Listing: ls, find, tree
- File operations: cp, mv, rm, mkdir
- Code analysis: grep, wc, awk
- Git operations: git status, git diff, git log
- Running tests: npm test, npm run build
- Any other shell command

Chain commands with && for sequential execution or ; for independent execution.`,
        inputSchema: z.object({
          command: z.string().describe('Shell command to execute. Can be a single command or multiple commands chained with && or ;'),
          timeout: z.number().optional().default(30000).describe('Timeout in milliseconds (default: 30000)'),
        }),
        needsApproval: async ({ command }) => {
          const preflight = this.preflightExecShell(command);
          return preflight.allowed && preflight.needsApproval;
        },
        execute: async (
          { command, timeout = 30000 }: { command: string; timeout?: number },
          _options?: ToolExecutionOptions,
        ) => {
          const preflight = this.preflightExecShell(command);
          if (!preflight.allowed) {
            return { success: false, error: `No permission to execute: ${command} (${preflight.deniedReason || 'denied'})` };
          }

          try {
            const result = await execa(command, {
              cwd: this.context.projectRoot,
              timeout,
              reject: false,
              shell: true,
            });

            await this.logger.log('info', `Executed command: ${command}`, {
              exitCode: result.exitCode,
              stdout: result.stdout?.slice(0, 1000),
              stderr: result.stderr?.slice(0, 1000),
            });

            return {
              success: result.exitCode === 0,
              exitCode: result.exitCode,
              stdout: result.stdout,
              stderr: result.stderr,
            };
          } catch (error) {
            return { success: false, error: `Command execution failed: ${String(error)}` };
          }
        },
      }),
    };
  }

  /**
   * Check if a tool call requires approval
   */
  private async checkToolCallApproval(toolCall: { toolName: string; args: Record<string, unknown> }): Promise<{
    requiresApproval: boolean;
    approvalId?: string;
    type?: 'write_repo' | 'exec_shell' | 'other';
    description?: string;
    message?: string;
    denied?: boolean;
  }> {
    const { toolName, args } = toolCall;

    // 检查 shell 执行
    if (toolName === 'exec_shell') {
      const command = args.command as string;
      if (command) {
        const permission = await this.permissionEngine.checkExecShell(command);
        if (!permission.allowed && permission.requiresApproval) {
          // checkExecShell 已经创建了审批请求并返回了 approvalId
          const approvalId = (permission as PermissionCheckResult & { approvalId?: string }).approvalId;

          return {
            requiresApproval: true,
            approvalId,
            type: 'exec_shell',
            description: `Execute command: ${command}`,
            message: `Approval required to execute: ${command}`,
          };
        }

        if (!permission.allowed) {
          const commandName = String(command).trim().split(/\s+/)[0] || '';
          const allowHint = commandName
            ? ` Configure ship.json -> permissions.exec_shell.deny (default blocks "rm"; set deny: [] to allow all).`
            : '';
          return {
            requiresApproval: false,
            denied: true,
            type: 'exec_shell',
            description: `Execute command: ${command}`,
            message: `No permission to execute: ${command} (${permission.reason}).${allowHint}`,
          };
        }
      }
    }

    return { requiresApproval: false };
  }

  /**
   * Normalize tool call args coming from different model/tool-call formats.
   * Some providers occasionally send exec_shell input as {"": "ls -la"} or as a bare string.
   */
  private normalizeToolArgs(toolName: string, rawArgs: unknown): Record<string, unknown> {
    const asObject = (value: unknown): Record<string, unknown> => {
      if (!value || typeof value !== 'object') return {};
      return value as Record<string, unknown>;
    };

    if (toolName !== 'exec_shell') {
      return asObject(rawArgs);
    }

    if (typeof rawArgs === 'string') {
      return { command: rawArgs };
    }

    const obj = asObject(rawArgs);
    if (typeof obj.command === 'string' && obj.command.trim().length > 0) {
      return obj;
    }

    // Common malformed shape: {"": "ls -la"}
    const emptyKey = (obj as any)[''];
    if (typeof emptyKey === 'string' && emptyKey.trim().length > 0) {
      return { ...obj, command: emptyKey };
    }

    // If there's exactly one string value, treat it as the command.
    const keys = Object.keys(obj);
    if (keys.length === 1) {
      const onlyVal = obj[keys[0] as keyof typeof obj];
      if (typeof onlyVal === 'string' && onlyVal.trim().length > 0) {
        return { ...obj, command: onlyVal };
      }
    }

    return obj;
  }

  /**
   * Create legacy-style tools with permission checks and approval workflow
   */
  private async createTools(): Promise<Record<string, any>> {
    return {
      // Shell execution - 唯一的执行工具，所有操作都通过 shell 命令实现
      exec_shell: {
        description: `Execute a shell command. This is your ONLY tool for interacting with the filesystem and codebase.

Use this tool for ALL operations:
- Reading files: cat, head, tail, less
- Writing files: echo >, cat > file << EOF, sed -i
- Searching: grep -r, find, rg
- Listing: ls, find, tree
- File operations: cp, mv, rm, mkdir
- Code analysis: grep, wc, awk
- Git operations: git status, git diff, git log
- Running tests: npm test, npm run build
- Any other shell command

Examples:
- Read file: cat src/index.ts
- Search code: grep -rn "function.*export" src/
- Write file: cat > file.ts << 'EOF'\\ncontent\\nEOF
- Find files: find . -name "*.ts" -type f
- Run tests: npm test

Chain commands with && for sequential execution or ; for independent execution.`,
        parameters: z.object({
          command: z.string().describe('Shell command to execute. Can be a single command or multiple commands chained with && or ;'),
          timeout: z.number().optional().default(30000).describe('Timeout in milliseconds (default: 30000)'),
        }),
        execute: async ({ command, timeout = 30000 }: { command: string; timeout?: number }) => {
          // Approval already handled in tool loop, just execute
          try {
            // Use shell mode to execute the full command string
            const result = await execa(command, {
              cwd: this.context.projectRoot,
              timeout,
              reject: false,
              shell: true, // 使用 shell 模式执行完整命令
            });

            await this.logger.log('info', `Executed command: ${command}`, {
              exitCode: result.exitCode,
              stdout: result.stdout?.slice(0, 1000),
              stderr: result.stderr?.slice(0, 1000),
            });

            return {
              success: result.exitCode === 0,
              exitCode: result.exitCode,
              stdout: result.stdout,
              stderr: result.stderr,
            };
          } catch (error) {
            return {
              success: false,
              error: `Command execution failed: ${String(error)}`,
            };
          }
        },
      },
    };
  }

  /**
   * Run the agent with the given instructions
   */
  async run(input: AgentInput): Promise<AgentResult> {
    const { instructions, context, onStep } = input;
    const startTime = Date.now();
    const toolCalls: AgentResult['toolCalls'] = [];
    const requestId = generateId();

    // 生成 sessionId（如果没有提供）
    const sessionId = context?.sessionId || context?.userId || 'default';

    // Read Agent.md as system prompt
    const systemPrompt = this.context.agentMd;
    await this.logger.log('debug', `Using system prompt (Agent.md): ${systemPrompt?.substring(0, 100)}...`);
    await this.logger.log('debug', `Session ID: ${sessionId}`);
    await this.logger.log('info', 'Agent request started', {
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
      (context?.source ? `- Source: ${context.source}\n` : '') +
      (context?.userId ? `- User/Chat ID: ${context.userId}\n` : '') +
      (context?.actorId ? `- Actor ID: ${context.actorId}\n` : '') +
      `\nUser-facing output rules:\n` +
      `- Reply in natural language.\n` +
      `- Do NOT paste raw tool outputs or JSON logs; summarize them.\n`;
    fullPrompt = `${runtimePrefix}\n${fullPrompt}`;

    // Frontends may optionally subscribe to onStep; default integrations do not emit step-by-step chat messages.

    // If initialized with model, use ToolLoopAgent
    if (this.initialized && this.agent) {
      return this.runWithToolLoopAgent(fullPrompt, startTime, context, sessionId, { onStep, requestId });
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
    context: AgentInput['context'] | undefined,
    sessionId: string,
    opts?: { addUserPrompt?: boolean; compactionAttempts?: number; onStep?: AgentInput['onStep']; requestId?: string }
  ): Promise<AgentResult> {
    const toolCalls: AgentResult['toolCalls'] = [];
    let hadToolFailure = false;
    const toolFailureSummaries: string[] = [];
    const addUserPrompt = opts?.addUserPrompt !== false;
    const compactionAttempts = opts?.compactionAttempts ?? 0;
    const onStep = opts?.onStep;
    const requestId = opts?.requestId;

    const emitStep = async (type: string, text: string, data?: Record<string, unknown>) => {
      if (!onStep) return;
      try {
        await onStep({ type, text, data });
      } catch {
        // ignore
      }
    };

    try {
      if (!this.agent) throw new Error('Agent not initialized');

      const messages = this.getOrCreateSessionMessages(sessionId);
      if (addUserPrompt && prompt) {
        messages.push({ role: 'user', content: prompt });
      }

      const result = await this.agent.generate({
        messages,
        onStepFinish: async (step) => {
          if (!onStep) return;
          try {
            for (const tr of step.toolResults || []) {
              if (tr.type !== 'tool-result') continue;
              if ((tr as any).toolName !== 'exec_shell') continue;
              const command = String(((tr as any).input as any)?.command || '').trim();
              const exitCode = ((tr as any).output as any)?.exitCode;
              const stdout = String(((tr as any).output as any)?.stdout || '').trim();
              const stderr = String(((tr as any).output as any)?.stderr || '').trim();
              const snippet = (stdout || stderr).slice(0, 500);
              await emitStep(
                'step_finish',
                `已执行：${command}${typeof exitCode === 'number' ? `（exitCode=${exitCode}）` : ''}${snippet ? `\n摘要：${snippet}${(stdout || stderr).length > 500 ? '…' : ''}` : ''}`,
                { toolName: 'exec_shell', command, exitCode: typeof exitCode === 'number' ? exitCode : undefined, requestId, sessionId },
              );
            }
          } catch {
            // ignore
          }
        },
      });

      messages.push(...result.response.messages);

      // Collect tool calls/results for auditing
      for (const step of result.steps || []) {
        for (const tr of step.toolResults || []) {
          toolCalls.push({
            tool: String((tr as any).toolName || 'unknown_tool'),
            input: (((tr as any).input || {}) as Record<string, unknown>),
            output: JSON.stringify((tr as any).output),
          });

          const out = (tr as any).output;
          if (out && typeof out === 'object' && 'success' in out && !out.success) {
            hadToolFailure = true;
            const err = (out as any).error || (out as any).stderr || 'unknown error';
            toolFailureSummaries.push(`${String((tr as any).toolName)}: ${String(err)}`.slice(0, 200));
          }
        }

        for (const part of step.content || []) {
          if ((part as any)?.type !== 'tool-error') continue;
          toolCalls.push({
            tool: String((part as any).toolName || 'unknown_tool'),
            input: (((part as any).input || {}) as Record<string, unknown>),
            output: JSON.stringify({ error: (part as any).error }),
          });
          hadToolFailure = true;
          toolFailureSummaries.push(`${String((part as any).toolName)}: ${String((part as any).error)}`.slice(0, 200));
        }
      }

      // Tool approval requests (AI SDK)
      const approvalParts = (result.content || []).filter((p: any) => p && typeof p === 'object' && p.type === 'tool-approval-request') as Array<{
        type: 'tool-approval-request';
        approvalId: string;
        toolCall: { toolName: string; input: unknown; toolCallId?: string };
      }>;

      if (approvalParts.length > 0) {
        const created: Array<{ id: string; toolName: string; args: Record<string, unknown>; aiApprovalId: string }> = [];

        for (const part of approvalParts) {
          const toolName = part.toolCall.toolName;
          const input = (part.toolCall as any).input || {};
          const args = (input && typeof input === 'object') ? (input as Record<string, unknown>) : {};

          if (toolName !== 'exec_shell') continue;

          const command = String((args as any).command || '').trim();
          const permission = await this.permissionEngine.checkExecShell(command);

          if (!permission.requiresApproval || !(permission as any).approvalId) {
            continue;
          }

          const approvalId = String((permission as any).approvalId);
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

          created.push({ id: approvalId, toolName, args, aiApprovalId: part.approvalId });
        }

        if (created.length > 0) {
          const first = created[0];
          const cmd = String((first.args as any)?.command || '');
          const pendingText =
            `⏳ 需要你确认一下我接下来要做的操作（已发起审批请求）。\n` +
            `操作: Execute command: ${cmd}\n\n` +
            `你可以直接用自然语言回复，比如：\n` +
            `- “可以” / “同意”\n` +
            `- “不可以，因为 …” / “拒绝，因为 …”\n` +
            `- “全部同意” / “全部拒绝”`;

          return {
            success: false,
            output: pendingText,
            toolCalls,
            pendingApproval: {
              id: first.id,
              type: 'exec_shell',
              description: `Execute command: ${cmd}`,
              data: { toolName: first.toolName, args: first.args, aiApprovalId: first.aiApprovalId },
            },
          };
        }
      }

      const duration = Date.now() - startTime;
      await this.logger.log('info', 'Agent execution completed', {
        duration,
        toolCallsTotal: toolCalls.length,
        context: context?.source,
      });
      await emitStep('done', 'done', { requestId, sessionId });

      return {
        success: !hadToolFailure,
        output: [
          result.text || 'Execution completed',
          hadToolFailure ? `\n\nTool errors:\n${toolFailureSummaries.map((s) => `- ${s}`).join('\n')}` : '',
        ].join(''),
        toolCalls,
      };
    } catch (error) {
      const errorMsg = String(error);

      if (
        errorMsg.includes('context_length') ||
        errorMsg.includes('too long') ||
        errorMsg.includes('maximum context') ||
        errorMsg.includes('context window')
      ) {
        const currentHistory = this.getOrCreateSessionMessages(sessionId);
        await this.logger.log('warn', 'Context length exceeded, compacting history', {
          sessionId,
          currentMessages: currentHistory.length,
          error: errorMsg,
          compactionAttempts,
        });
        await emitStep('compaction', '上下文过长，已自动压缩历史记录后继续。', { requestId, sessionId, compactionAttempts });

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

        return this.runWithToolLoopAgent(prompt, startTime, context, sessionId, {
          addUserPrompt: false,
          compactionAttempts: compactionAttempts + 1,
          onStep,
          requestId,
        });
      }

      await this.logger.log('error', 'Agent execution failed', { error: errorMsg });
      return {
        success: false,
        output: `Execution failed: ${errorMsg}`,
        toolCalls,
      };
    }
  }

  /**
   * Run with generateText and manual tool loop (legacy AI SDK)
   */
  private async runWithGenerateText(
    prompt: string,
    systemPrompt: string,
    startTime: number,
    context: AgentInput['context'] | undefined,
    sessionId: string,
    opts?: { addUserPrompt?: boolean; compactionAttempts?: number; onStep?: AgentInput['onStep']; requestId?: string }
  ): Promise<AgentResult> {
    const toolCalls: AgentResult['toolCalls'] = [];
    let hadToolFailure = false;
    const toolFailureSummaries: string[] = [];
    const addUserPrompt = opts?.addUserPrompt !== false;
    const compactionAttempts = opts?.compactionAttempts ?? 0;
    const onStep = opts?.onStep;
    const requestId = opts?.requestId;

    const emitStep = async (type: string, text: string, data?: Record<string, unknown>) => {
      if (!onStep) return;
      try {
        await onStep({ type, text, data });
      } catch {
        // ignore
      }
    };

    // Legacy path: kept for backward compatibility; delegate to ToolLoopAgent.
    return this.runWithToolLoopAgent(prompt, startTime, context, sessionId, opts);
    /*
    try {
      // Import removed (no dynamic imports)
      const { generateText } = { generateText: undefined as any };

      // Get tools
      const tools = await this.createTools();

      // Convert tools to AI SDK format
      const aiTools: Record<string, any> = {};
      for (const [name, tool] of Object.entries(tools)) {
        aiTools[name] = {
          description: tool.description,
          parameters: tool.parameters,
        };
      }

      await this.logger.log('debug', `Calling generateText with system prompt length: ${systemPrompt?.length || 0}`);

      if (addUserPrompt) {
        // 添加用户消息到历史
        this.addToHistory({
          role: 'user',
          content: prompt,
          timestamp: Date.now(),
        }, sessionId);
      }

      // 构建完整的对话上下文
      let conversationContext = this.buildConversationContext(sessionId);

      // Manual tool loop (max 20 iterations)
      const maxIterations = 20;

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        // Call generateText
        // Note: temperature 以及 maxOutputTokens（来自 llm.maxTokens，可选）已在 ToolLoopAgent 初始化时配置
        const result = await generateText({
          model: this.agent,
          system: systemPrompt,
          prompt: conversationContext,
          tools: aiTools,
        });

        await this.logger.log('debug', `Iteration ${iteration + 1}: ${JSON.stringify({
          hasText: !!result.text,
          hasToolCalls: !!result.toolCalls && result.toolCalls.length > 0,
          toolCallsCount: result.toolCalls?.length || 0,
          text: result.text?.substring(0, 100),
        })}`);

        // Log raw tool calls structure
        if (result.toolCalls && result.toolCalls.length > 0) {
          await this.logger.log('debug', `Raw toolCalls: ${JSON.stringify(result.toolCalls)}`);
        }

        // 添加 assistant 响应到历史
        if (result.text) {
          this.addToHistory({
            role: 'assistant',
            content: result.text,
            timestamp: Date.now(),
          }, sessionId);
        }

        // If no tool calls, we're done
        if (!result.toolCalls || result.toolCalls.length === 0) {
          const duration = Date.now() - startTime;
          await this.logger.log('info', `Agent execution completed`, {
            duration,
            iterations: iteration + 1,
            toolCallsTotal: toolCalls.length,
            context: context?.source,
          });

          await this.logger.log('debug', `Agent response: ${result.text?.substring(0, 200)}...`);
          await emitStep('done', 'done', { requestId, sessionId });

          return {
            success: !hadToolFailure,
            output: [
              result.text || 'Execution completed',
              hadToolFailure
                ? `\n\nTool errors:\n${toolFailureSummaries.map((s) => `- ${s}`).join('\n')}`
                : '',
            ].join(''),
            toolCalls,
          };
        }

        // Process tool calls with approval workflow
        const toolResults: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown>; result: any }> = [];

        for (const toolCall of result.toolCalls) {
          const toolCallId = (toolCall as any).toolCallId;
          const toolName = (toolCall as any).toolName;
          // AI SDK uses 'input' field for tool arguments, not 'args'
          const rawArgs = (toolCall as any).args || (toolCall as any).input;
          const args = this.normalizeToolArgs(toolName, rawArgs);

          await this.logger.log('debug', `Tool call raw data: ${JSON.stringify({
            toolCallId,
            toolName,
            args: rawArgs,
            fullToolCall: toolCall,
          })}`);

          await this.logger.log('debug', `Tool call: ${toolName}`, { args });

          // Check if this tool call requires approval
          const approvalCheck = await this.checkToolCallApproval({ toolName, args });

          if (approvalCheck.denied) {
            const errorResult = { success: false, error: approvalCheck.message || 'Permission denied' };
            toolResults.push({
              toolCallId,
              toolName,
              args: args || {},
              result: errorResult,
            });
            toolCalls.push({
              tool: toolName,
              input: args || {},
              output: JSON.stringify(errorResult),
            });
            hadToolFailure = true;
            toolFailureSummaries.push(`${toolName}: ${approvalCheck.message || 'Permission denied'}`.slice(0, 200));
            await this.logger.log('warn', `Tool call denied: ${toolName}`, {
              toolCallId,
              message: approvalCheck.message,
            });
            continue;
          }

          if (approvalCheck.requiresApproval) {
            if (!approvalCheck.approvalId) {
              const errorResult = { success: false, error: `Approval required but no approval ID generated for ${toolName}` };
              toolResults.push({
                toolCallId,
                toolName,
                args: args || {},
                result: errorResult,
              });
              toolCalls.push({
                tool: toolName,
                input: args || {},
                output: JSON.stringify(errorResult),
              });
              hadToolFailure = true;
              toolFailureSummaries.push(`${toolName}: missing approvalId`.slice(0, 200));
              await this.logger.log('error', `Approval required but no approval ID generated for ${toolName}`, {
                toolCallId,
                type: approvalCheck.type,
              });
              continue;
            }

            await this.logger.log('info', `Tool call requires approval: ${toolName}`, {
              approvalId: approvalCheck.approvalId,
              type: approvalCheck.type,
            });

            // New workflow: snapshot history into approval file and return immediately.
            const snapshot = this.getConversationHistory(sessionId);
            await this.permissionEngine.updateApprovalRequest(approvalCheck.approvalId, {
              tool: toolName,
              input: args || {},
              messages: snapshot as unknown[],
              meta: {
                sessionId,
                source: context?.source,
                userId: context?.userId,
                actorId: context?.actorId,
                initiatorId: context?.initiatorId ?? context?.actorId,
                requestId,
              },
            });
            await this.logger.log('info', 'Approval snapshot saved', {
              requestId,
              sessionId,
              approvalId: approvalCheck.approvalId,
              toolName,
              source: context?.source,
              userId: context?.userId,
              historyMessages: snapshot.length,
            });

            const pendingText =
              `⏳ 需要你确认一下我接下来要做的操作（已发起审批请求）。\n` +
              `操作: ${approvalCheck.description || toolName}\n\n` +
              `你可以直接用自然语言回复，比如：\n` +
              `- “可以” / “同意”\n` +
              `- “不可以，因为 …” / “拒绝，因为 …”\n` +
              `- “全部同意” / “全部拒绝”`;
            return {
              success: false,
              output: pendingText,
              toolCalls,
              pendingApproval: {
                id: approvalCheck.approvalId,
                type: approvalCheck.type || 'other',
                description: approvalCheck.description || `Approval required: ${toolName}`,
                data: { toolName, args },
              },
            };
          }

          // Execute the tool
          const tool = tools[toolName];
          if (!tool || typeof tool.execute !== 'function') {
            const errorResult = { success: false, error: `Unknown tool: ${toolName}` };
            toolResults.push({
              toolCallId,
              toolName,
              args: args || {},
              result: errorResult,
            });
            continue;
          }

          try {
            // Ensure args is an object, default to empty object if undefined
            const toolArgs = args || {};

            await this.logger.log('debug', `Executing tool: ${toolName}`, { args: toolArgs });
            if (toolName === 'exec_shell') {
              const command = (toolArgs as any).command;
              if (typeof command === 'string') {
                await emitStep('step_start', `我准备执行：${command}`, { toolName, command, requestId, sessionId });
              }
            } else {
              await emitStep('step_start', `我准备执行工具：${toolName}`, { toolName, requestId, sessionId });
            }

            if (toolName === 'exec_shell') {
              const command = (toolArgs as any).command;
              if (typeof command !== 'string' || command.trim().length === 0) {
                const errorResult = { success: false, error: `Missing required argument: command` };
                toolResults.push({
                  toolCallId,
                  toolName,
                  args: toolArgs,
                  result: errorResult,
                });
                toolCalls.push({
                  tool: toolName,
                  input: toolArgs,
                  output: JSON.stringify(errorResult),
                });
                hadToolFailure = true;
                toolFailureSummaries.push(`${toolName}: missing command`);
                await this.logger.log('warn', `Tool call missing required argument: ${toolName}`, { toolCallId });
                continue;
              }
            }

            const toolResult = await tool.execute(toolArgs);
            toolResults.push({
              toolCallId,
              toolName,
              args: toolArgs,
              result: toolResult,
            });
            await this.logger.log('info', 'Tool step finished', {
              requestId,
              sessionId,
              toolName,
              exitCode: (toolResult as any)?.exitCode,
            });

            // Human-friendly step finish message
            if (toolName === 'exec_shell') {
              const command = (toolArgs as any).command as string;
              const exitCode = (toolResult as any)?.exitCode;
              const stdout = String((toolResult as any)?.stdout || (toolResult as any)?.output || '').trim();
              const stderr = String((toolResult as any)?.stderr || '').trim();
              const snippet = (stdout || stderr).slice(0, 500);
              await emitStep(
                'step_finish',
                `已执行：${command}${typeof exitCode === 'number' ? `（exitCode=${exitCode}）` : ''}${snippet ? `\n摘要：${snippet}${(stdout || stderr).length > 500 ? '…' : ''}` : ''}`,
                { toolName, command, exitCode: typeof exitCode === 'number' ? exitCode : undefined, requestId, sessionId },
              );
            } else {
              await emitStep('step_finish', `工具执行完成：${toolName}`, { toolName, requestId, sessionId });
            }

            // Log tool call
            toolCalls.push({
              tool: toolName,
              input: toolArgs,
              output: JSON.stringify(toolResult),
            });

            await this.logger.log('debug', `Tool executed: ${toolName}`, {
              result: typeof toolResult === 'object' ? JSON.stringify(toolResult).substring(0, 200) : toolResult,
            });

            if (toolResult && typeof toolResult === 'object' && 'success' in (toolResult as any)) {
              const ok = Boolean((toolResult as any).success);
              if (!ok) {
                hadToolFailure = true;
                const err = (toolResult as any).error || (toolResult as any).stderr || 'unknown error';
                toolFailureSummaries.push(`${toolName}: ${String(err)}`.slice(0, 200));
              }
            }
          } catch (error) {
            const errorResult = { success: false, error: String(error) };
            toolResults.push({
              toolCallId,
              toolName,
              args: args || {},
              result: errorResult,
            });

            toolCalls.push({
              tool: toolName,
              input: args || {},
              output: JSON.stringify(errorResult),
            });

            await this.logger.log('error', `Tool execution failed: ${toolName}`, { error: String(error) });
            hadToolFailure = true;
            toolFailureSummaries.push(`${toolName}: ${String(error)}`.slice(0, 200));
          }
        }

        // 添加工具调用结果到历史
        for (const tr of toolResults) {
          const formatted = this.formatToolResultForHistory(tr.toolName, tr.args || {}, tr.result);
          this.addToHistory({
            role: 'tool',
            content: formatted,
            toolCallId: tr.toolCallId,
            toolName: tr.toolName,
            timestamp: Date.now(),
          }, sessionId);
        }

        // 重新构建对话上下文（包含完整历史）
        conversationContext = this.buildConversationContext(sessionId);
      }

      // Max iterations reached
      const duration = Date.now() - startTime;
      await this.logger.log('warn', `Agent execution stopped: max iterations reached`, {
        duration,
        iterations: maxIterations,
        toolCallsTotal: toolCalls.length,
      });

      return {
        success: true,
        output: 'Execution stopped: maximum iterations reached',
        toolCalls,
      };
    } catch (error) {
      const errorMsg = String(error);

      // Check if context length exceeded error
        if (errorMsg.includes('context_length') ||
          errorMsg.includes('too long') ||
          errorMsg.includes('maximum context') ||
          errorMsg.includes('context window')) {
        const currentHistory = this.conversationHistories.get(sessionId) || [];
        await this.logger.log('warn', 'Context length exceeded, compacting history', {
          sessionId,
          currentMessages: currentHistory.length,
          error: errorMsg,
          compactionAttempts,
        });
        await emitStep('compaction', '上下文过长，已自动压缩历史记录后继续。', { requestId, sessionId, compactionAttempts });

        if (compactionAttempts >= 3) {
          this.conversationHistories.delete(sessionId);
          return {
            success: false,
            output: `Context length exceeded and compaction failed. History cleared. Please resend your question.`,
            toolCalls,
          };
        }

        const compacted = await this.compactConversationHistory(sessionId);
        if (!compacted) {
          this.conversationHistories.delete(sessionId);
          return {
            success: false,
            output: `Context length exceeded and compaction was not possible. History cleared. Please resend your question.`,
            toolCalls,
          };
        }

        // Retry without adding a new user prompt again (it is already in history)
        return this.runWithGenerateText(prompt, systemPrompt, startTime, context, sessionId, {
          addUserPrompt: false,
          compactionAttempts: compactionAttempts + 1,
          onStep,
          requestId,
        });
      }

      await this.logger.log('error', 'Agent execution failed', { error: errorMsg });
      return {
        success: false,
        output: `Execution failed: ${errorMsg}`,
        toolCalls,
      };
    }
    */
  }

  async decideApprovals(
    userMessage: string,
    pendingApprovals: Array<{ id: string; type: string; action: string; tool?: string; input?: unknown; details?: unknown }>
  ): Promise<ApprovalDecisionResult> {
    if (!this.initialized || !this.model) {
      return { pass: Object.fromEntries(pendingApprovals.map((a) => [a.id, ''])) };
    }

    const compactList = pendingApprovals.map((a) => ({
      id: a.id,
      type: a.type,
      action: a.action,
      tool: a.tool,
      input: a.input,
      details: a.details,
    }));

    const result = await generateText({
      model: this.model,
      system: [
        'You are an approval-routing assistant.',
        'Given a user message and a list of pending approval requests, decide which approvals to approve, refuse, or pass.',
        'Return ONLY valid JSON with this exact structure:',
        '{ "approvals": { "<id>": "<any string>" }, "refused": { "<id>": "<reason>" }, "pass": { "<id>": "<any string>" } }',
        'If the user is ambiguous, put everything into "pass".',
      ].join('\n'),
      prompt: `User message:\n${userMessage}\n\nPending approvals:\n${JSON.stringify(compactList, null, 2)}\n\nReturn JSON only.`,
    });

    try {
      const parsed = JSON.parse((result.text || '').trim()) as ApprovalDecisionResult;
      return parsed && typeof parsed === 'object' ? parsed : { pass: Object.fromEntries(pendingApprovals.map((a) => [a.id, ''])) };
    } catch {
      return { pass: Object.fromEntries(pendingApprovals.map((a) => [a.id, ''])) };
    }
  }

  async handleApprovalReply(input: {
    userMessage: string;
    context?: AgentInput['context'];
    sessionId: string;
    onStep?: AgentInput['onStep'];
  }): Promise<AgentResult | null> {
    const { userMessage, context, sessionId, onStep } = input;

    await this.logger.log('info', 'Approval reply received', {
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
      if (!metaSessionId && metaUserId && context?.userId && metaUserId === context.userId) return true;
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
      }))
    );

    const approvals = decisions.approvals || {};
    const refused = decisions.refused || {};

    if (Object.keys(approvals).length === 0 && Object.keys(refused).length === 0) {
      return {
        success: true,
        output: `No approval action taken. Pending approvals: ${relevant.map((a) => a.id).join(', ')}`,
        toolCalls: [],
      };
    }

    await this.logger.log('info', 'Approval decisions parsed', {
      sessionId,
      approvals: Object.keys(approvals),
      refused: Object.keys(refused),
    });

    // If these approvals belong to a background Run, copy runId into context so resume can update run record.
    const runIds = Array.from(new Set(relevant.map((a: any) => (a as any)?.meta?.runId).filter(Boolean)));
    const mergedContext: AgentInput['context'] | undefined =
      runIds.length === 1
        ? { ...(context || {}), runId: runIds[0] }
        : context;

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
    context?: AgentInput['context'];
    approvals?: Record<string, string>;
    refused?: Record<string, string>;
    onStep?: AgentInput['onStep'];
  }): Promise<AgentResult> {
    const { sessionId, context } = input;
    const approvals = input.approvals || {};
    const refused = input.refused || {};
    const onStep = input.onStep;

    const emitStep = async (type: string, text: string, data?: Record<string, unknown>) => {
      if (!onStep) return;
      try {
        await onStep({ type, text, data });
      } catch {
        // ignore
      }
    };

    const approvedIds = Object.keys(approvals);
    const refusedEntries = Object.entries(refused);

    await this.logger.log('info', 'Resuming from approval actions', {
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
          baseMessages = this.coerceStoredMessagesToModelMessages(data.messages as unknown[]);
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
          type: 'tool-approval-response',
          approvalId: String(aiApprovalId),
          approved: true,
          reason: approvals[approvalId] || 'Approved',
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
          type: 'tool-approval-response',
          approvalId: String(aiApprovalId),
          approved: false,
          reason: reason || 'Rejected',
        });
      } catch {
        // ignore
      }
    }

    // Persist decision state and delete approval files (ShipMyAgent requirement).
    for (const approvalId of approvedIds) {
      await this.permissionEngine.updateApprovalRequest(approvalId, {
        status: 'approved',
        respondedAt: getTimestamp(),
        response: approvals[approvalId] || 'Approved',
      });
      await this.permissionEngine.deleteApprovalRequest(approvalId);
    }
    for (const [approvalId, reason] of refusedEntries) {
      await this.permissionEngine.updateApprovalRequest(approvalId, {
        status: 'rejected',
        respondedAt: getTimestamp(),
        response: reason || 'Rejected',
      });
      await this.permissionEngine.deleteApprovalRequest(approvalId);
    }

    if (approvalResponses.length === 0) {
      return { success: true, output: 'No approval action taken.', toolCalls: [] };
    }

    // Add a tool message with approval responses and continue the agent loop.
    const messages = this.getOrCreateSessionMessages(sessionId);
    messages.push({ role: 'tool', content: approvalResponses as any });
    await emitStep('approval', '已记录审批结果，继续执行。', { sessionId });

    const resumeStart = Date.now();
    const resumed = await this.runWithToolLoopAgent('', resumeStart, context, sessionId, { addUserPrompt: false, onStep });

    // If this approval was part of a background Run, update the run record to reflect completion.
    if (context?.runId) {
      try {
        const { loadRun, saveRun } = await import('./run-store.js');
        const run = await loadRun(this.context.projectRoot, context.runId);
        if (run) {
          run.status = resumed.success ? 'succeeded' : 'failed';
          run.finishedAt = getTimestamp();
          run.output = { text: resumed.output };
          run.pendingApproval = undefined;
          run.notified = true;
          if (!resumed.success) {
            run.error = { message: resumed.output || 'Run failed' };
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
    context?: AgentInput['context'];
  }): Promise<{ mode: 'sync' | 'async'; reason: string }> {
    if (!this.model) return { mode: 'sync', reason: 'No model configured' };

    const instructions = String(input.instructions || '').trim();
    if (!instructions) return { mode: 'sync', reason: 'Empty instructions' };

    const result = await generateText({
      model: this.model,
      system:
        'You are an execution-mode router. Decide whether the user request should run synchronously or as a background run. ' +
        'Prefer background for long-running, risky, approval-prone, or multi-step tasks. Output STRICT JSON only.',
      prompt:
        `Return JSON: {"mode":"sync"|"async","reason":"..."}.\n\n` +
        `Context:\n` +
        `- source: ${input.context?.source || 'unknown'}\n` +
        `- sessionId: ${input.context?.sessionId || 'unknown'}\n` +
        `- userId: ${input.context?.userId || 'unknown'}\n` +
        `\nUser request:\n${instructions}\n`,
    });

    const text = (result.text || '').trim();
    try {
      const parsed = JSON.parse(text);
      const mode = parsed?.mode === 'async' ? 'async' : 'sync';
      const reason = typeof parsed?.reason === 'string' ? parsed.reason.slice(0, 200) : 'n/a';
      return { mode, reason };
    } catch {
      // If model output is malformed, default to sync to preserve responsiveness.
      return { mode: 'sync', reason: 'Failed to parse router output' };
    }
  }

  /**
   * 构建对话上下文（将历史消息转换为提示词）
   */
  private buildConversationContext(sessionId: string): string {
    const history = this.sessionMessages.get(sessionId) || [];

    if (history.length === 0) {
      return '';
    }

    // 构建对话历史文本
    const historyText = history.map((msg) => {
      const role = (msg as any).role;
      const content = (msg as any).content;
      const text =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? JSON.stringify(content).slice(0, 2000)
            : String(content ?? '');

      if (role === 'user') return `User: ${text}`;
      if (role === 'assistant') return `Assistant: ${text}`;
      if (role === 'tool') return `Tool: ${text}`;
      return `Other: ${text}`;
    }).filter(Boolean).join('\n\n');

    return historyText;
  }


  /**
   * Simulation mode for when AI is not available
   */
  private runSimulated(
    prompt: string,
    startTime: number,
    toolCalls: AgentResult['toolCalls'],
    context?: AgentInput['context']
  ): AgentResult {
    const promptLower = prompt.toLowerCase();
    let output = '';

    if (promptLower.includes('status') || promptLower.includes('状态')) {
      output = this.generateStatusResponse();
    } else if (promptLower.includes('task') || promptLower.includes('任务')) {
      output = this.generateTasksResponse();
    } else if (promptLower.includes('scan') || promptLower.includes('扫描')) {
      output = this.generateScanResponse();
    } else if (promptLower.includes('approve') || promptLower.includes('审批')) {
      output = this.generateApprovalsResponse();
    } else {
      output = `Received: "${prompt}"\n\n[Simulation Mode] AI service not configured. Please configure API Key in ship.json and restart.`;
    }

    const duration = Date.now() - startTime;
    this.logger.log('info', `Simulated agent execution completed`, { duration, context: context?.source });

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
- Read repository: ✅ ${typeof config.permissions.read_repo === 'boolean' ? (config.permissions.read_repo ? 'Enabled' : 'Disabled') : 'Enabled (with path restrictions)'}
- Write code: ${config.permissions.write_repo ? (config.permissions.write_repo.requiresApproval ? '⚠️ Requires approval' : '✅ Enabled') : '❌ Disabled'}
- Execute shell: ${config.permissions.exec_shell ? (config.permissions.exec_shell.requiresApproval ? '⚠️ Requires approval' : '✅ Enabled') : '❌ Disabled'}

**Runtime**: Normal`;
  }

  private generateTasksResponse(): string {
    const tasksDir = path.join(this.context.projectRoot, '.ship', 'tasks');
    
    if (!fs.existsSync(tasksDir)) {
      return `📋 **Task List**

No scheduled tasks configured.

Add .md files in .ship/tasks/ to define tasks.`;
    }

    const files = fs.readdirSync(tasksDir).filter(f => f.endsWith('.md'));
    
    if (files.length === 0) {
      return `📋 **Task List**

No scheduled tasks configured.`;
    }

    return `📋 **Task List**

Configured ${files.length} tasks:
${files.map(f => `- ${f.replace('.md', '')}`).join('\n')}

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
  async executeApproved(approvalId: string): Promise<{ success: boolean; result: unknown }> {
    const approvalsDir = getApprovalsDirPath(this.context.projectRoot);
    const approvalFile = path.join(approvalsDir, `${approvalId}.json`);

    if (!fs.existsSync(approvalFile)) {
      return { success: false, result: 'Approval not found' };
    }

    const approval = await fs.readJson(approvalFile) as ApprovalRequest;
    if (approval.status !== 'approved') {
      return { success: false, result: 'Approval not approved' };
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
    args: Record<string, unknown>
  ): Promise<{ success: boolean; result: unknown }> {
    const tools = await this.createTools();
    const tool = tools[toolName as keyof typeof tools];

    if (!tool || typeof tool.execute !== 'function') {
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
}


// ==================== Logger ====================

class AgentLogger {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  async log(level: string, message: string, data?: Record<string, unknown>): Promise<void> {
    const logsDir = getLogsDirPath(this.projectRoot);
    await fs.ensureDir(logsDir);

    const logEntry = {
      timestamp: getTimestamp(),
      level,
      message,
      ...(data || {}),
    };

    const today = new Date().toISOString().split('T')[0];
    const logFile = path.join(logsDir, `${today}.json`);

    const existingLogs: unknown[] = fs.existsSync(logFile)
      ? await fs.readJson(logFile)
      : [];
    existingLogs.push(logEntry);
    await fs.writeJson(logFile, existingLogs, { spaces: 2 });

    const colors: Record<string, string> = {
      info: '\x1b[32m',
      warn: '\x1b[33m',
      error: '\x1b[31m',
      debug: '\x1b[36m',
    };
    const color = colors[level] || '\x1b[0m';
    console.log(`${color}[${level.toUpperCase()}]${'\x1b[0m'} ${message}`);
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
    name: 'shipmyagent',
    version: '1.0.0',
    llm: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      baseUrl: 'https://api.anthropic.com/v1',
      temperature: 0.7,
    },
    permissions: {
      read_repo: true,
      write_repo: { requiresApproval: true },
      exec_shell: { deny: ['rm'], requiresApproval: false },
    },
    integrations: {
      telegram: { enabled: false },
    },
  };

  // Ensure .ship directory exists
  const shipDir = getShipDirPath(projectRoot);
  fs.ensureDirSync(shipDir);
  fs.ensureDirSync(path.join(shipDir, 'tasks'));
  fs.ensureDirSync(path.join(shipDir, 'runs'));
  fs.ensureDirSync(path.join(shipDir, 'queue'));
  fs.ensureDirSync(path.join(shipDir, 'routes'));
  fs.ensureDirSync(path.join(shipDir, 'approvals'));
  fs.ensureDirSync(path.join(shipDir, 'logs'));
  fs.ensureDirSync(path.join(shipDir, '.cache'));

  // Read user's Agent.md (identity/role definition)
  try {
    if (fs.existsSync(agentMdPath)) {
      const content = fs.readFileSync(agentMdPath, 'utf-8').trim();
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
  const agentMd = [
    userAgentMd,
    `---\n\n${DEFAULT_SHIP_PROMPTS}`,
    `---\n\n${DEFAULT_SHELL_GUIDE}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  return new AgentRuntime({
    projectRoot,
    config,
    agentMd,
  });
}
