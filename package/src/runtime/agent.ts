#!/usr/bin/env node

/**
 * ShipMyAgent - Agent Runtime with Human-in-the-loop Support
 * 
 * Uses ai-sdk v6 ToolLoopAgent for advanced tool calling and
 * built-in support for human-in-the-loop workflows.
 */

import fs from 'fs-extra';
import path from 'path';
import { z } from 'zod';
import {
  generateId,
  getAgentMdPath,
  getShipJsonPath,
  getShipDirPath,
  getApprovalsDirPath,
  getLogsDirPath,
  ShipConfig,
  getTimestamp,
} from '../utils.js';
import { createPermissionEngine, PermissionEngine, PermissionCheckResult } from './permission.js';

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
    source?: 'telegram' | 'cli' | 'scheduler' | 'api';
    userId?: string;
  };
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

// ==================== ToolLoopAgent Implementation ====================

/**
 * ToolLoopAgent-based Agent Runtime with Human-in-the-loop support
 */
export class AgentRuntime {
  private context: AgentContext;
  private initialized: boolean = false;
  private logger: AgentLogger;
  private permissionEngine: PermissionEngine;
  
  // ToolLoopAgent instance (v6)
  private agent: any = null;
  
  constructor(context: AgentContext) {
    this.context = context;
    this.logger = new AgentLogger(context.projectRoot);
    this.permissionEngine = createPermissionEngine(context.projectRoot);
  }

  /**
   * Initialize the Agent with generateText (legacy AI SDK)
   */
  async initialize(): Promise<void> {
    try {
      await this.logger.log('info', 'Initializing Agent Runtime with generateText (legacy AI SDK)');
      await this.logger.log('info', `Agent.md content length: ${this.context.agentMd?.length || 0} chars`);

      const { provider, apiKey, baseUrl, model } = this.context.config.llm;

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

      // Import ai-sdk modules
      try {
        // Create provider instance
        let providerInstance: any;
        if (provider === 'anthropic') {
          const anthropicMod = await import('@ai-sdk/anthropic');
          const createAnthropic =
            (anthropicMod as any).createAnthropic ??
            (anthropicMod as any).anthropic;

          if (typeof createAnthropic !== 'function') {
            throw new Error('Failed to load Anthropic provider from @ai-sdk/anthropic');
          }

          providerInstance = createAnthropic({ apiKey: resolvedApiKey });
        } else if (provider === 'custom') {
          // OpenAI-compatible provider with custom baseURL
          const compatMod = await import('@ai-sdk/openai-compatible');
          const createOpenAICompatible = (compatMod as any).createOpenAICompatible;

          if (typeof createOpenAICompatible !== 'function') {
            throw new Error('Failed to load OpenAI-compatible provider from @ai-sdk/openai-compatible');
          }

          providerInstance = createOpenAICompatible({
            name: 'custom',
            apiKey: resolvedApiKey,
            baseURL: baseUrl || 'https://api.openai.com/v1',
          });
        } else {
          // Standard OpenAI provider
          const openaiMod = await import('@ai-sdk/openai');
          const createOpenAI =
            (openaiMod as any).createOpenAI ??
            (openaiMod as any).openai;

          if (typeof createOpenAI !== 'function') {
            throw new Error('Failed to load OpenAI provider from @ai-sdk/openai');
          }

          providerInstance = createOpenAI({
            apiKey: resolvedApiKey,
            baseURL: baseUrl || 'https://api.openai.com/v1',
          });
        }

        // Store model instance
        this.agent = providerInstance(model);

        await this.logger.log('info', 'Agent Runtime initialized with legacy AI SDK');
        this.initialized = true;
      } catch (importError) {
        await this.logger.log('warn', `ai-sdk import failed: ${String(importError)}, using simulation mode`);
      }
    } catch (error) {
      await this.logger.log('error', 'Agent Runtime initialization failed', { error: String(error) });
    }
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
  }> {
    const { toolName, args } = toolCall;
    
    // 检查写文件操作
    if (toolName === 'write_file' || toolName === 'delete_file' || toolName === 'create_diff') {
      const filePath = (args.path || args.filePath) as string;
      if (filePath) {
        const content = (args.content || '') as string;
        const permission = await this.permissionEngine.checkWriteRepo(filePath, content);
        if (!permission.allowed && permission.requiresApproval) {
          // checkWriteRepo 已经创建了审批请求并返回了 approvalId
          const approvalId = (permission as PermissionCheckResult & { approvalId?: string }).approvalId;
          
          return {
            requiresApproval: true,
            approvalId,
            type: 'write_repo',
            description: `${toolName === 'write_file' ? 'Write' : toolName === 'delete_file' ? 'Delete' : 'Modify'} file: ${filePath}`,
            message: `Approval required to ${toolName === 'write_file' ? 'write' : toolName === 'delete_file' ? 'delete' : 'modify'}: ${filePath}`,
          };
        }
      }
    }
    
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
      }
    }
    
    return { requiresApproval: false };
  }

  /**
   * Create legacy-style tools with permission checks and approval workflow
   */
  private async createTools(): Promise<Record<string, any>> {
    return {
      // File reading tool
      read_file: {
        description: 'Read file content from the repository',
        parameters: z.object({
          path: z.string().describe('File path to read'),
          encoding: z.string().optional().default('utf-8'),
        }),
        execute: async ({ path: filePath, encoding = 'utf-8' }: { path: string; encoding?: string }) => {
          // Check permissions
          const permission = await this.permissionEngine.checkReadRepo(filePath);
          if (!permission.allowed) {
            return {
              success: false,
              error: `Permission denied: ${permission.reason}`,
            };
          }

          // Check file exists
          if (!fs.existsSync(filePath)) {
            return {
              success: false,
              error: `File not found: ${filePath}`,
            };
          }

          const content = await fs.readFile(filePath, encoding as BufferEncoding);
          await this.logger.log('debug', `Read file: ${filePath}`);
          
          return {
            success: true,
            content: content.toString(),
            path: filePath,
          };
        },
      },

      // File writing tool
      write_file: {
        description: 'Create or modify a file',
        parameters: z.object({
          path: z.string().describe('File path to write'),
          content: z.string().describe('File content'),
        }),
        execute: async ({ path: filePath, content }: { path: string; content: string }) => {
          // Approval already handled in tool loop, just execute
          await fs.ensureDir(path.dirname(filePath));
          await fs.writeFile(filePath, content);
          await this.logger.log('info', `Wrote file: ${filePath}`);

          return {
            success: true,
            message: `File written: ${filePath}`,
          };
        },
      },

      // File deletion
      delete_file: {
        description: 'Delete a file or directory',
        parameters: z.object({
          path: z.string().describe('File or directory path to delete'),
        }),
        execute: async ({ path: filePath }: { path: string }) => {
          // Approval already handled in tool loop, just execute
          if (!fs.existsSync(filePath)) {
            return {
              success: false,
              error: `File not found: ${filePath}`,
            };
          }

          await fs.remove(filePath);
          await this.logger.log('info', `Deleted file: ${filePath}`);

          return {
            success: true,
            message: `File deleted: ${filePath}`,
          };
        },
      },

      // Shell execution
      exec_shell: {
        description: 'Execute a shell command',
        parameters: z.object({
          command: z.string().describe('Command to execute'),
          timeout: z.number().optional().default(30000),
        }),
        execute: async ({ command, timeout = 30000 }: { command: string; timeout?: number }) => {
          // Approval already handled in tool loop, just execute
          try {
            const { execa } = await import('execa');
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

      // File listing tool
      list_files: {
        description: 'List files in a directory',
        parameters: z.object({
          path: z.string().describe('Directory path'),
          pattern: z.string().optional().default('**/*'),
        }),
        execute: async ({ path: dirPath, pattern = '**/*' }: { path: string; pattern?: string }) => {
          const permission = await this.permissionEngine.checkReadRepo(dirPath);
          if (!permission.allowed) {
            return {
              success: false,
              error: `Permission denied: ${permission.reason}`,
            };
          }

          const globImport = await import('fast-glob');
          const files = await globImport.default([`${dirPath}/${pattern}`], {
            cwd: this.context.projectRoot,
            ignore: ['node_modules/**', '.git/**', '.ship/**'],
          });

          await this.logger.log('debug', `Listed files: ${dirPath}`, { count: files.length });

          return {
            success: true,
            files,
          };
        },
      },

      // File search tool
      search_files: {
        description: 'Search for text in files',
        parameters: z.object({
          pattern: z.string().describe('Search pattern'),
          path: z.string().optional().default('.'),
          glob: z.string().optional().default('**/*'),
        }),
        execute: async ({ pattern, path: searchPath = '.', glob = '**/*' }: { pattern: string; path?: string; glob?: string }) => {
          const permission = await this.permissionEngine.checkReadRepo(searchPath);
          if (!permission.allowed) {
            return {
              success: false,
              error: `Permission denied: ${permission.reason}`,
            };
          }

          const results: Array<{ file: string; line: number; content: string }> = [];
          const globImport = await import('fast-glob');
          const files = await globImport.default([`${searchPath}/${glob}`], {
            cwd: this.context.projectRoot,
            ignore: ['node_modules/**', '.git/**', '.ship/**'],
          });

          for (const file of files) {
            try {
              const content = await fs.readFile(file, 'utf-8');
              const lines = content.split('\n');
              lines.forEach((line, index) => {
                if (line.toLowerCase().includes(pattern.toLowerCase())) {
                  results.push({
                    file,
                    line: index + 1,
                    content: line.trim(),
                  });
                }
              });
            } catch {
              // Ignore read errors
            }
          }

          await this.logger.log('debug', `Searched files: ${pattern}`, { count: results.length });

          return {
            success: true,
            results,
          };
        },
      },

      // Status check tool
      get_status: {
        description: 'Get agent and project status',
        parameters: z.object({}),
        execute: async () => {
          const { config } = this.context;
          const pendingApprovals = this.permissionEngine.getPendingApprovals();

          return {
            success: true,
            name: config.name,
            version: config.version,
            llm: {
              provider: config.llm.provider,
              model: config.llm.model,
            },
            permissions: {
              read_repo: typeof config.permissions.read_repo === 'boolean'
                ? config.permissions.read_repo
                : { paths: config.permissions.read_repo?.paths },
              write_repo: config.permissions.write_repo,
              exec_shell: config.permissions.exec_shell,
            },
            pendingApprovals: pendingApprovals.length,
            projectRoot: this.context.projectRoot,
          };
        },
      },

      // Task management tools
      get_tasks: {
        description: 'Get list of tasks',
        parameters: z.object({}),
        execute: async () => {
          const tasksDir = path.join(this.context.projectRoot, '.ship', 'tasks');

          if (!fs.existsSync(tasksDir)) {
            return { success: true, tasks: [] };
          }

          const files = await fs.readdir(tasksDir);
          const tasks: Array<{ name: string; file: string }> = [];

          for (const file of files) {
            if (file.endsWith('.md')) {
              tasks.push({
                name: file.replace('.md', ''),
                file: path.join(tasksDir, file),
              });
            }
          }

          return { success: true, tasks };
        },
      },

      // Approval management tools
      get_pending_approvals: {
        description: 'Get pending approval requests',
        parameters: z.object({}),
        execute: async () => {
          const approvals = this.permissionEngine.getPendingApprovals();
          return {
            success: true,
            approvals: approvals.map(a => ({
              id: a.id,
              type: a.type,
              action: a.action,
              details: a.details,
              status: a.status,
              createdAt: a.createdAt,
            })),
          };
        },
      },

      approve: {
        description: 'Approve or reject a pending request',
        parameters: z.object({
          approvalId: z.string().describe('Approval request ID'),
          approved: z.boolean().describe('Whether to approve'),
          response: z.string().optional().describe('Response comment'),
        }),
        execute: async ({ approvalId, approved, response }: { approvalId: string; approved: boolean; response?: string }) => {
          if (approved) {
            const success = await this.permissionEngine.approveRequest(approvalId, response || 'Approved');
            return {
              success,
              message: success ? 'Approved' : 'Approval not found',
            };
          } else {
            const success = await this.permissionEngine.rejectRequest(approvalId, response || 'Rejected');
            return {
              success,
              message: success ? 'Rejected' : 'Approval not found',
            };
          }
        },
      },

      // Create diff tool
      create_diff: {
        description: 'Create a diff and request approval for file changes',
        parameters: z.object({
          filePath: z.string().describe('File path'),
          original: z.string().describe('Original content'),
          modified: z.string().describe('Modified content'),
        }),
        execute: async ({ filePath, original, modified }: { filePath: string; original: string; modified: string }) => {
          // Approval already handled in tool loop, just execute
          await fs.ensureDir(path.dirname(filePath));
          await fs.writeFile(filePath, modified);
          await this.logger.log('info', `Modified file: ${filePath}`);

          return {
            success: true,
            message: `File modified: ${filePath}`,
            diff: this.generateDiff(original, modified),
          };
        },
      },
    };
  }

  /**
   * Generate a diff between original and modified content
   */
  private generateDiff(original: string, modified: string): string {
    const oldLines = original.split('\n');
    const newLines = modified.split('\n');
    let diff = '';
    const maxLen = Math.max(oldLines.length, newLines.length);

    for (let i = 0; i < maxLen; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];

      if (oldLine === undefined) {
        diff += `+ ${newLine}\n`;
      } else if (newLine === undefined) {
        diff += `- ${oldLine}\n`;
      } else if (oldLine !== newLine) {
        diff += `- ${oldLine}\n`;
        diff += `+ ${newLine}\n`;
      } else {
        diff += `  ${oldLine}\n`;
      }
    }
    return diff;
  }

  /**
   * Run the agent with the given instructions
   */
  async run(input: AgentInput): Promise<AgentResult> {
    const { instructions, context } = input;
    const startTime = Date.now();
    const toolCalls: AgentResult['toolCalls'] = [];

    // Read Agent.md as system prompt
    const systemPrompt = this.context.agentMd;
    await this.logger.log('debug', `Using system prompt (Agent.md): ${systemPrompt?.substring(0, 100)}...`);

    // Build full prompt with context
    let fullPrompt = instructions;
    if (context?.taskDescription) {
      fullPrompt = `${context.taskDescription}\n\n${instructions}`;
    }

    // If initialized with model, use generateText with tool loop
    if (this.initialized && this.agent) {
      return this.runWithGenerateText(fullPrompt, systemPrompt, startTime, context);
    }

    // Otherwise use simulation mode
    return this.runSimulated(fullPrompt, startTime, toolCalls, context);
  }

  /**
   * Run with generateText and manual tool loop (legacy AI SDK)
   */
  private async runWithGenerateText(
    prompt: string,
    systemPrompt: string,
    startTime: number,
    context?: AgentInput['context']
  ): Promise<AgentResult> {
    const toolCalls: AgentResult['toolCalls'] = [];

    try {
      // Import generateText from AI SDK
      const { generateText } = await import('ai');

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

      // Manual tool loop (max 20 iterations)
      let currentPrompt = prompt;
      let conversationHistory: Array<{ role: string; content: string }> = [];
      const maxIterations = 20;

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        // Call generateText
        const result = await generateText({
          model: this.agent,
          system: systemPrompt,
          prompt: currentPrompt,
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

          return {
            success: true,
            output: result.text || 'Execution completed',
            toolCalls,
          };
        }

        // Process tool calls with approval workflow
        const toolResults: Array<{ toolCallId: string; result: any }> = [];

        for (const toolCall of result.toolCalls) {
          const toolCallId = (toolCall as any).toolCallId;
          const toolName = (toolCall as any).toolName;
          // AI SDK uses 'input' field for tool arguments, not 'args'
          const args = (toolCall as any).args || (toolCall as any).input;

          await this.logger.log('debug', `Tool call raw data: ${JSON.stringify({
            toolCallId,
            toolName,
            args,
            fullToolCall: toolCall,
          })}`);

          await this.logger.log('debug', `Tool call: ${toolName}`, { args });

          // Check if this tool call requires approval
          const approvalCheck = await this.checkToolCallApproval({ toolName, args });

          if (approvalCheck.requiresApproval) {
            if (!approvalCheck.approvalId) {
              throw new Error(`Approval required but no approval ID generated for ${toolName}`);
            }

            await this.logger.log('info', `Tool call requires approval: ${toolName}`, {
              approvalId: approvalCheck.approvalId,
              type: approvalCheck.type,
            });

            // Wait for approval (with timeout)
            const approvalResult = await this.permissionEngine.waitForApproval(
              approvalCheck.approvalId,
              300 // 5 minutes timeout
            );

            if (approvalResult === 'rejected') {
              throw new Error(`Tool call rejected: ${approvalCheck.message || toolName}`);
            }

            if (approvalResult === 'timeout') {
              throw new Error(`Approval timeout for tool call: ${toolName}`);
            }

            await this.logger.log('info', `Tool call approved: ${toolName}`, {
              approvalId: approvalCheck.approvalId,
            });
          }

          // Execute the tool
          const tool = tools[toolName];
          if (!tool || typeof tool.execute !== 'function') {
            toolResults.push({
              toolCallId,
              result: { success: false, error: `Unknown tool: ${toolName}` },
            });
            continue;
          }

          try {
            // Ensure args is an object, default to empty object if undefined
            const toolArgs = args || {};

            await this.logger.log('debug', `Executing tool: ${toolName}`, { args: toolArgs });

            const toolResult = await tool.execute(toolArgs);
            toolResults.push({
              toolCallId,
              result: toolResult,
            });

            // Log tool call
            toolCalls.push({
              tool: toolName,
              input: toolArgs,
              output: JSON.stringify(toolResult),
            });

            await this.logger.log('debug', `Tool executed: ${toolName}`, {
              result: typeof toolResult === 'object' ? JSON.stringify(toolResult).substring(0, 200) : toolResult,
            });
          } catch (error) {
            const errorResult = { success: false, error: String(error) };
            toolResults.push({
              toolCallId,
              result: errorResult,
            });

            toolCalls.push({
              tool: toolName,
              input: args || {},
              output: JSON.stringify(errorResult),
            });

            await this.logger.log('error', `Tool execution failed: ${toolName}`, { error: String(error) });
          }
        }

        // Build next prompt with tool results
        const toolResultsText = toolResults.map(tr =>
          `Tool ${tr.toolCallId} result: ${JSON.stringify(tr.result)}`
        ).join('\n');

        currentPrompt = `Previous response: ${result.text || ''}\n\nTool results:\n${toolResultsText}\n\nContinue based on these results.`;
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
      await this.logger.log('error', 'Agent execution failed', { error: String(error) });
      return {
        success: false,
        output: `Execution failed: ${String(error)}`,
        toolCalls,
      };
    }
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
  // Read configuration
  const agentMdPath = getAgentMdPath(projectRoot);
  const shipJsonPath = getShipJsonPath(projectRoot);

  let agentMd = `# Agent Role

You are the maintainer agent of this repository.

## Goals
- Improve code quality
- Reduce bugs
- Assist humans, never override them

## Constraints
- Never modify files without approval
- Never run shell commands unless explicitly allowed
- Always explain your intent before acting

## Communication Style
- Concise
- Technical
- No speculation without evidence`;

  let config: ShipConfig = {
    name: 'shipmyagent',
    version: '1.0.0',
    llm: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      baseUrl: 'https://api.anthropic.com/v1',
      temperature: 0.7,
      maxTokens: 4096,
    },
    permissions: {
      read_repo: true,
      write_repo: { requiresApproval: true },
      exec_shell: { allow: [], requiresApproval: false },
    },
    integrations: {
      telegram: { enabled: false },
    },
  };

  // Ensure .ship directory exists
  const shipDir = getShipDirPath(projectRoot);
  fs.ensureDirSync(shipDir);
  fs.ensureDirSync(path.join(shipDir, 'tasks'));
  fs.ensureDirSync(path.join(shipDir, 'routes'));
  fs.ensureDirSync(path.join(shipDir, 'approvals'));
  fs.ensureDirSync(path.join(shipDir, 'logs'));
  fs.ensureDirSync(path.join(shipDir, '.cache'));

  // Read Agent.md
  try {
    if (fs.existsSync(agentMdPath)) {
      agentMd = fs.readFileSync(agentMdPath, 'utf-8');
    }
  } catch {
    // Use default
  }

  // Read ship.json
  try {
    if (fs.existsSync(shipJsonPath)) {
      config = fs.readJsonSync(shipJsonPath) as ShipConfig;
    }
  } catch {
    // Use default
  }

  return new AgentRuntime({
    projectRoot,
    config,
    agentMd,
  });
}
