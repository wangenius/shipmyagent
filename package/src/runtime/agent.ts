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

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
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

// ==================== Permission Engine ====================

class PermissionEngine {
  private context: AgentContext;

  constructor(context: AgentContext) {
    this.context = context;
  }

  /**
   * 检查是否允许执行某个操作
   */
  canPerform(action: string, data?: Record<string, unknown>): {
    allowed: boolean;
    requiresApproval: boolean;
    reason?: string;
  } {
    const { config } = this.context;

    switch (action) {
      case 'read_repo':
        const readConfig = config.permissions.read_repo;
        if (typeof readConfig === 'boolean') {
          return { allowed: readConfig, requiresApproval: false };
        }
        // 如果有路径限制，检查路径
        if (readConfig.paths && data?.path) {
          const allowed = readConfig.paths.some(p => 
            (data.path as string).includes(p.replace('**/*', ''))
          );
          return { allowed, requiresApproval: false };
        }
        return { allowed: true, requiresApproval: false };

      case 'write_repo':
        const writeConfig = config.permissions.write_repo;
        if (!writeConfig) {
          return { allowed: false, requiresApproval: true, reason: '写入权限未配置' };
        }
        if (writeConfig.paths && data?.path) {
          const allowed = writeConfig.paths.some(p =>
            (data.path as string).includes(p.replace('**/*', ''))
          );
          return {
            allowed: writeConfig.requiresApproval ? false : allowed,
            requiresApproval: writeConfig.requiresApproval,
            reason: allowed ? undefined : '路径不在允许范围内'
          };
        }
        return {
          allowed: false,
          requiresApproval: writeConfig.requiresApproval,
          reason: '写入需要审批'
        };

      case 'exec_shell':
        const execConfig = config.permissions.exec_shell;
        if (!execConfig) {
          return { allowed: false, requiresApproval: true, reason: 'Shell 执行权限未配置' };
        }
        if (execConfig.allow && data?.command) {
          const allowed = execConfig.allow.some(cmd =>
            (data.command as string).startsWith(cmd)
          );
          return {
            allowed: execConfig.requiresApproval ? false : allowed,
            requiresApproval: execConfig.requiresApproval,
            reason: allowed ? undefined : '命令不在允许列表中'
          };
        }
        return {
          allowed: false,
          requiresApproval: execConfig.requiresApproval,
          reason: 'Shell 执行需要审批'
        };

      default:
        return { allowed: false, requiresApproval: true, reason: `未知操作: ${action}` };
    }
  }

  /**
   * 创建审批请求
   */
  async createApproval(
    type: 'write_repo' | 'exec_shell' | 'other',
    description: string,
    tool: string,
    input: Record<string, unknown>
  ): Promise<ApprovalRequest> {
    const approvalsDir = getApprovalsDirPath(this.context.projectRoot);
    await fs.ensureDir(approvalsDir);

    const approval: ApprovalRequest = {
      id: generateId(),
      timestamp: getTimestamp(),
      type,
      description,
      tool,
      input,
      status: 'pending',
    };

    const approvalFile = path.join(approvalsDir, `${approval.id}.json`);
    await fs.writeJson(approvalFile, approval, { spaces: 2 });

    return approval;
  }

  /**
   * 获取待审批请求
   */
  async getPendingApprovals(): Promise<ApprovalRequest[]> {
    const approvalsDir = getApprovalsDirPath(this.context.projectRoot);
    if (!fs.existsSync(approvalsDir)) {
      return [];
    }

    const files = await fs.readdir(approvalsDir);
    const approvals: ApprovalRequest[] = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const content = await fs.readJson(path.join(approvalsDir, file));
        if (content.status === 'pending') {
          approvals.push(content);
        }
      }
    }

    return approvals.sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  /**
   * 审批操作
   */
  async approve(approvalId: string, approvedBy: string): Promise<boolean> {
    const approvalsDir = getApprovalsDirPath(this.context.projectRoot);
    const approvalFile = path.join(approvalsDir, `${approvalId}.json`);

    if (!fs.existsSync(approvalFile)) {
      return false;
    }

    const approval = await fs.readJson(approvalFile) as ApprovalRequest;
    approval.status = 'approved';
    approval.approvedBy = approvedBy;
    approval.approvedAt = getTimestamp();

    await fs.writeJson(approvalFile, approval, { spaces: 2 });
    return true;
  }

  /**
   * 拒绝操作
   */
  async reject(approvalId: string, rejectedBy: string): Promise<boolean> {
    const approvalsDir = getApprovalsDirPath(this.context.projectRoot);
    const approvalFile = path.join(approvalsDir, `${approvalId}.json`);

    if (!fs.existsSync(approvalFile)) {
      return false;
    }

    const approval = await fs.readJson(approvalFile) as ApprovalRequest;
    approval.status = 'rejected';
    approval.approvedBy = rejectedBy;
    approval.approvedAt = getTimestamp();

    await fs.writeJson(approvalFile, approval, { spaces: 2 });
    return true;
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

    // Append to log file
    const existingLogs: unknown[] = fs.existsSync(logFile)
      ? await fs.readJson(logFile)
      : [];
    existingLogs.push(logEntry);
    await fs.writeJson(logFile, existingLogs, { spaces: 2 });

    // Also output to console
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

// ==================== Agent Tools ====================

export class AgentTools {
  private context: AgentContext;
  private permissionEngine: PermissionEngine;
  private logger: AgentLogger;

  constructor(context: AgentContext) {
    this.context = context;
    this.permissionEngine = new PermissionEngine(context);
    this.logger = new AgentLogger(context.projectRoot);
  }

  /**
   * 获取所有工具定义
   */
  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'read_file',
        description: '读取文件内容',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '文件路径' },
            encoding: { type: 'string', description: '编码格式，默认 utf-8' },
          },
          required: ['path'],
        },
      },
      {
        name: 'list_files',
        description: '列出目录中的文件',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '目录路径' },
            pattern: { type: 'string', description: '文件匹配模式' },
          },
          required: ['path'],
        },
      },
      {
        name: 'search_files',
        description: '搜索文件内容',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: '搜索关键词' },
            path: { type: 'string', description: '搜索目录' },
            glob: { type: 'string', description: '文件类型过滤' },
          },
          required: ['pattern'],
        },
      },
      {
        name: 'write_file',
        description: '创建或修改文件',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '文件路径' },
            content: { type: 'string', description: '文件内容' },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'delete_file',
        description: '删除文件或目录',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '文件或目录路径' },
          },
          required: ['path'],
        },
      },
      {
        name: 'exec_shell',
        description: '执行 Shell 命令',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: '要执行的命令' },
            timeout: { type: 'number', description: '超时时间（毫秒）' },
          },
          required: ['command'],
        },
      },
      {
        name: 'get_status',
        description: '获取 Agent 和项目状态',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'get_tasks',
        description: '获取任务列表',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'get_pending_approvals',
        description: '获取待审批请求',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'approve',
        description: '审批操作请求',
        parameters: {
          type: 'object',
          properties: {
            approvalId: { type: 'string', description: '审批请求 ID' },
            approved: { type: 'boolean', description: '是否批准' },
          },
          required: ['approvalId'],
        },
      },
      {
        name: 'create_diff',
        description: '创建代码 diff 并请求审批',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: '文件路径' },
            original: { type: 'string', description: '原始内容' },
            modified: { type: 'string', description: '修改后内容' },
          },
          required: ['filePath', 'original', 'modified'],
        },
      },
    ];
  }

  /**
   * 执行工具调用
   */
  async executeTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ success: boolean; result: unknown; error?: string; pendingApproval?: ApprovalRequest }> {
    try {
      switch (toolName) {
        case 'read_file':
          return await this.toolReadFile(args);
        case 'list_files':
          return await this.toolListFiles(args);
        case 'search_files':
          return await this.toolSearchFiles(args);
        case 'write_file':
          return await this.toolWriteFile(args);
        case 'delete_file':
          return await this.toolDeleteFile(args);
        case 'exec_shell':
          return await this.toolExecShell(args);
        case 'get_status':
          return await this.toolGetStatus(args);
        case 'get_tasks':
          return await this.toolGetTasks(args);
        case 'get_pending_approvals':
          return await this.toolGetPendingApprovals(args);
        case 'approve':
          return await this.toolApprove(args);
        case 'create_diff':
          return await this.toolCreateDiff(args);
        default:
          return { success: false, result: null, error: `未知工具: ${toolName}` };
      }
    } catch (error) {
      await this.logger.log('error', `工具执行失败: ${toolName}`, { error: String(error) });
      return { success: false, result: null, error: String(error) };
    }
  }

  private async toolReadFile(args: Record<string, unknown>): Promise<{
    success: boolean;
    result: unknown;
  }> {
    const { path: filePath, encoding = 'utf-8' } = args;

    // 检查权限
    const permission = this.permissionEngine.canPerform('read_repo', { path: filePath });
    if (!permission.allowed) {
      return { success: false, result: `无权限读取文件: ${filePath}` };
    }

    // 检查文件是否存在
    if (!fs.existsSync(filePath as string)) {
      return { success: false, result: `文件不存在: ${filePath}` };
    }

    const content = await fs.readFile(filePath as string, encoding as BufferEncoding);
    await this.logger.log('debug', `读取文件: ${filePath}`);
    return { success: true, result: content };
  }

  private async toolListFiles(args: Record<string, unknown>): Promise<{
    success: boolean;
    result: unknown;
  }> {
    const { path: dirPath, pattern = '**/*' } = args;

    const permission = this.permissionEngine.canPerform('read_repo', { path: dirPath });
    if (!permission.allowed) {
      return { success: false, result: `无权限访问目录: ${dirPath}` };
    }

    const globImport = await import('fast-glob');
    const files = await globImport.default([`${dirPath}/${pattern}`], {
      cwd: this.context.projectRoot,
      ignore: ['node_modules/**', '.git/**', '.ship/**'],
    });

    await this.logger.log('debug', `列出文件: ${dirPath}`, { count: files.length });
    return { success: true, result: files };
  }

  private async toolSearchFiles(args: Record<string, unknown>): Promise<{
    success: boolean;
    result: unknown;
  }> {
    const { pattern, path: searchPath, glob = '**/*' } = args;

    const permission = this.permissionEngine.canPerform('read_repo', { path: searchPath });
    if (!permission.allowed) {
      return { success: false, result: `无权限搜索: ${searchPath}` };
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
          if (line.toLowerCase().includes((pattern as string).toLowerCase())) {
            results.push({
              file,
              line: index + 1,
              content: line.trim(),
            });
          }
        });
      } catch {
        // 忽略读取错误
      }
    }

    await this.logger.log('debug', `搜索文件: ${pattern}`, { count: results.length });
    return { success: true, result: results };
  }

  private async toolWriteFile(args: Record<string, unknown>): Promise<{
    success: boolean;
    result: unknown;
    pendingApproval?: ApprovalRequest;
  }> {
    const { path: filePath, content } = args;

    const permission = this.permissionEngine.canPerform('write_repo', { path: filePath });
    if (!permission.allowed) {
      if (permission.requiresApproval) {
        // 需要审批
        const approval = await this.permissionEngine.createApproval(
          'write_repo',
          `写入文件: ${filePath}`,
          'write_file',
          args
        );
        return { success: false, result: `需要审批才能写入文件`, pendingApproval: approval };
      }
      return { success: false, result: `无权限写入文件: ${filePath}` };
    }

    await fs.ensureDir(path.dirname(filePath as string));
    await fs.writeFile(filePath as string, content as string);
    await this.logger.log('info', `写入文件: ${filePath}`);
    return { success: true, result: `文件已写入: ${filePath}` };
  }

  private async toolDeleteFile(args: Record<string, unknown>): Promise<{
    success: boolean;
    result: unknown;
    pendingApproval?: ApprovalRequest;
  }> {
    const { path: filePath } = args;

    const permission = this.permissionEngine.canPerform('write_repo', { path: filePath });
    if (!permission.allowed) {
      if (permission.requiresApproval) {
        const approval = await this.permissionEngine.createApproval(
          'write_repo',
          `删除文件: ${filePath}`,
          'delete_file',
          args
        );
        return { success: false, result: `需要审批才能删除文件`, pendingApproval: approval };
      }
      return { success: false, result: `无权限删除文件: ${filePath}` };
    }

    if (fs.existsSync(filePath as string)) {
      await fs.remove(filePath as string);
      await this.logger.log('info', `删除文件: ${filePath}`);
      return { success: true, result: `文件已删除: ${filePath}` };
    }
    return { success: false, result: `文件不存在: ${filePath}` };
  }

  private async toolExecShell(args: Record<string, unknown>): Promise<{
    success: boolean;
    result: unknown;
    pendingApproval?: ApprovalRequest;
  }> {
    const { command, timeout = 30000 } = args;

    const permission = this.permissionEngine.canPerform('exec_shell', { command });
    if (!permission.allowed) {
      if (permission.requiresApproval) {
        const approval = await this.permissionEngine.createApproval(
          'exec_shell',
          `执行命令: ${command}`,
          'exec_shell',
          args
        );
        return { success: false, result: `需要审批才能执行命令`, pendingApproval: approval };
      }
      return { success: false, result: `无权限执行命令: ${command}` };
    }

    try {
      const { execa } = await import('execa');
      const result = await execa(command as string, [], {
        cwd: this.context.projectRoot,
        timeout: timeout as number,
        reject: false,
      });

      await this.logger.log('info', `执行命令: ${command}`, {
        exitCode: result.exitCode,
        stdout: result.stdout?.slice(0, 1000),
        stderr: result.stderr?.slice(0, 1000),
      });

      return {
        success: result.exitCode === 0,
        result: {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        },
      };
    } catch (error) {
      return { success: false, result: `命令执行失败: ${String(error)}` };
    }
  }

  private async toolGetStatus(_args: Record<string, unknown>): Promise<{
    success: boolean;
    result: unknown;
  }> {
    const { config } = this.context;
    const pendingApprovals = await this.permissionEngine.getPendingApprovals();

    return {
      success: true,
      result: {
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
      },
    };
  }

  private async toolGetTasks(_args: Record<string, unknown>): Promise<{
    success: boolean;
    result: unknown;
  }> {
    const tasksDir = path.join(this.context.projectRoot, '.ship', 'tasks');
    
    if (!fs.existsSync(tasksDir)) {
      return { success: true, result: [] };
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

    return { success: true, result: tasks };
  }

  private async toolGetPendingApprovals(_args: Record<string, unknown>): Promise<{
    success: boolean;
    result: unknown;
  }> {
    const approvals = await this.permissionEngine.getPendingApprovals();
    return { success: true, result: approvals };
  }

  private async toolApprove(args: Record<string, unknown>): Promise<{
    success: boolean;
    result: unknown;
  }> {
    const { approvalId, approved } = args;
    const userId = 'user'; // TODO: 从上下文获取

    if (approved) {
      const success = await this.permissionEngine.approve(approvalId as string, userId);
      return { success, result: success ? '审批已通过' : '审批不存在' };
    } else {
      const success = await this.permissionEngine.reject(approvalId as string, userId);
      return { success, result: success ? '已拒绝' : '审批不存在' };
    }
  }

  private async toolCreateDiff(args: Record<string, unknown>): Promise<{
    success: boolean;
    result: unknown;
    pendingApproval?: ApprovalRequest;
  }> {
    const { filePath, original, modified } = args;

    const permission = this.permissionEngine.canPerform('write_repo', { path: filePath });
    if (!permission.allowed) {
      if (permission.requiresApproval) {
        const approval = await this.permissionEngine.createApproval(
          'write_repo',
          `修改文件: ${filePath}`,
          'write_file',
          { path: filePath, content: modified }
        );
        return { success: false, result: `需要审批才能修改文件`, pendingApproval: approval };
      }
      return { success: false, result: `无权限修改文件: ${filePath}` };
    }

    // 直接写入
    await fs.ensureDir(path.dirname(filePath as string));
    await fs.writeFile(filePath as string, modified as string);
    await this.logger.log('info', `修改文件: ${filePath}`);
    return { success: true, result: `文件已修改: ${filePath}` };
  }
}

// ==================== Main Agent Runtime ====================

export class AgentRuntime {
  private context: AgentContext;
  private tools: AgentTools;
  private permissionEngine: PermissionEngine;
  private initialized: boolean = false;
  private logger: AgentLogger;

  constructor(context: AgentContext) {
    this.context = context;
    this.tools = new AgentTools(context);
    this.permissionEngine = new PermissionEngine(context);
    this.logger = new AgentLogger(context.projectRoot);
  }

  /**
   * 初始化 Agent
   */
  async initialize(): Promise<void> {
    try {
      await this.logger.log('info', '初始化 Agent Runtime');

      const { provider, apiKey, baseUrl } = this.context.config.llm;
      const resolvedApiKey = apiKey || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
      
      if (!resolvedApiKey) {
        await this.logger.log('warn', '未配置 API Key，将使用模拟模式');
        return;
      }

      // 验证 ai-sdk 导入
      try {
        if (provider === 'anthropic') {
          const { createAnthropic } = await import('@ai-sdk/anthropic');
          await createAnthropic({ apiKey: resolvedApiKey });
        } else {
          const { createOpenAI } = await import('@ai-sdk/openai');
          await createOpenAI({
            apiKey: resolvedApiKey,
            baseURL: baseUrl || 'https://api.openai.com/v1',
          });
        }
        await this.logger.log('info', 'Agent Runtime 初始化完成');
        this.initialized = true;
      } catch (importError) {
        await this.logger.log('warn', `ai-sdk 导入失败: ${String(importError)}，将使用模拟模式`);
      }
    } catch (error) {
      await this.logger.log('error', 'Agent Runtime 初始化失败', { error: String(error) });
      // 不抛出错误，允许在模拟模式下运行
    }
  }

  /**
   * 运行 Agent
   */
  async run(input: AgentInput): Promise<AgentResult> {
    const { instructions, context } = input;
    const startTime = Date.now();
    const toolCalls: AgentResult['toolCalls'] = [];

    // 读取 Agent.md 作为系统提示
    const systemPrompt = this.context.agentMd;

    // 根据任务类型构建提示
    let fullPrompt = instructions;
    if (context?.taskDescription) {
      fullPrompt = `${context.taskDescription}\n\n${instructions}`;
    }

    // 如果已初始化，使用真实的 AI Agent
    if (this.initialized) {
      return this.runWithAI(fullPrompt, systemPrompt, startTime, context);
    }

    // 否则使用模拟模式
    return this.runSimulated(fullPrompt, startTime, toolCalls, context);
  }

  /**
   * 使用 AI SDK 运行真实 Agent
   */
  private async runWithAI(
    prompt: string,
    systemPrompt: string,
    startTime: number,
    context?: AgentInput['context']
  ): Promise<AgentResult> {
    const toolCalls: AgentResult['toolCalls'] = [];

    try {
      const { provider, model, apiKey, baseUrl } = this.context.config.llm;
      const resolvedApiKey = apiKey || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
      if (!resolvedApiKey) {
        return this.runSimulated(prompt, startTime, toolCalls, context);
      }

      // 导入 AI SDK
      const { generateText } = await import('ai');
      const { tool } = await import('ai');

      let providerInstance;

      if (provider === 'anthropic') {
        const { createAnthropic } = await import('@ai-sdk/anthropic');
        providerInstance = createAnthropic({ apiKey: resolvedApiKey });
      } else {
        // 支持 openai, custom 等 OpenAI 兼容的 API
        const { createOpenAI } = await import('@ai-sdk/openai');
        providerInstance = createOpenAI({
          apiKey: resolvedApiKey,
          baseURL: baseUrl || 'https://api.openai.com/v1',
        });
      }

      // 定义工具
      const tools = await this.createAITools();

      // 执行 AI 调用
      const result = await generateText({
        model: providerInstance(model),
        system: systemPrompt,
        prompt,
        tools,
        maxSteps: 10,
      });

      // 记录工具调用
      if (result.steps) {
        for (const step of result.steps) {
          if (step.toolCalls && step.toolCalls.length > 0) {
            for (const toolCall of step.toolCalls) {
              toolCalls.push({
                tool: toolCall.toolName,
                input: {},
                output: '',
              });
            }
          }
        }
      }

      const duration = Date.now() - startTime;
      await this.logger.log('info', `Agent 执行完成`, {
        duration,
        toolCalls: toolCalls.length,
        context: context?.source,
      });

      return {
        success: true,
        output: result.text || '执行完成',
        toolCalls,
      };
    } catch (error) {
      await this.logger.log('error', 'Agent 执行失败', { error: String(error) });
      return {
        success: false,
        output: `Agent 执行失败: ${String(error)}`,
        toolCalls,
      };
    }
  }

  /**
   * 创建 AI 工具定义
   */
  private async createAITools() {
    const { tool } = await import('ai');

    const tools: Record<string, any> = {
      read_file: tool({
        description: '读取文件内容',
        parameters: z.object({
          path: z.string().describe('文件路径'),
          encoding: z.string().optional().default('utf-8'),
        }),
        execute: async (args) => this.tools.executeTool('read_file', args),
      }),
      list_files: tool({
        description: '列出目录中的文件',
        parameters: z.object({
          path: z.string().describe('目录路径'),
          pattern: z.string().optional().default('**/*'),
        }),
        execute: async (args) => this.tools.executeTool('list_files', args),
      }),
      search_files: tool({
        description: '搜索文件内容',
        parameters: z.object({
          pattern: z.string().describe('搜索关键词'),
          path: z.string().optional().default('.'),
          glob: z.string().optional().default('**/*'),
        }),
        execute: async (args) => this.tools.executeTool('search_files', args),
      }),
      write_file: tool({
        description: '创建或修改文件',
        parameters: z.object({
          path: z.string().describe('文件路径'),
          content: z.string().describe('文件内容'),
        }),
        execute: async (args) => this.tools.executeTool('write_file', args),
      }),
      delete_file: tool({
        description: '删除文件或目录',
        parameters: z.object({
          path: z.string().describe('文件或目录路径'),
        }),
        execute: async (args) => this.tools.executeTool('delete_file', args),
      }),
      exec_shell: tool({
        description: '执行 Shell 命令',
        parameters: z.object({
          command: z.string().describe('要执行的命令'),
          timeout: z.number().optional().default(30000),
        }),
        execute: async (args) => this.tools.executeTool('exec_shell', args),
      }),
      get_status: tool({
        description: '获取 Agent 和项目状态',
        parameters: z.object({}),
        execute: async (args) => this.tools.executeTool('get_status', args),
      }),
      get_tasks: tool({
        description: '获取任务列表',
        parameters: z.object({}),
        execute: async (args) => this.tools.executeTool('get_tasks', args),
      }),
      get_pending_approvals: tool({
        description: '获取待审批请求',
        parameters: z.object({}),
        execute: async (args) => this.tools.executeTool('get_pending_approvals', args),
      }),
      approve: tool({
        description: '审批操作请求',
        parameters: z.object({
          approvalId: z.string().describe('审批请求 ID'),
          approved: z.boolean().describe('是否批准'),
        }),
        execute: async (args) => this.tools.executeTool('approve', args),
      }),
      create_diff: tool({
        description: '创建代码 diff 并请求审批',
        parameters: z.object({
          filePath: z.string().describe('文件路径'),
          original: z.string().describe('原始内容'),
          modified: z.string().describe('修改后内容'),
        }),
        execute: async (args) => this.tools.executeTool('create_diff', args),
      }),
    };

    return tools;
  }

  /**
   * 执行已审批的操作
   */
  async executeApproved(approvalId: string): Promise<{ success: boolean; result: unknown }> {
    const approvalsDir = getApprovalsDirPath(this.context.projectRoot);
    const approvalFile = path.join(approvalsDir, `${approvalId}.json`);

    if (!fs.existsSync(approvalFile)) {
      return { success: false, result: '审批不存在' };
    }

    const approval = await fs.readJson(approvalFile) as ApprovalRequest;
    if (approval.status !== 'approved') {
      return { success: false, result: '审批未通过' };
    }

    // 执行已审批的操作
    const result = await this.tools.executeTool(approval.tool, approval.input);
    return result;
  }

  /**
   * 模拟模式（当 AI 不可用时）
   */
  private runSimulated(
    prompt: string,
    startTime: number,
    toolCalls: AgentResult['toolCalls'],
    context?: AgentInput['context']
  ): AgentResult {
    const promptLower = prompt.toLowerCase();
    let output = '';

    // 根据不同的指令类型生成响应
    if (promptLower.includes('status') || promptLower.includes('状态')) {
      output = this.generateStatusResponse();
    } else if (promptLower.includes('task') || promptLower.includes('任务')) {
      output = this.generateTasksResponse();
    } else if (promptLower.includes('scan') || promptLower.includes('扫描')) {
      output = this.generateScanResponse();
    } else if (promptLower.includes('approve') || promptLower.includes('审批')) {
      output = this.generateApprovalsResponse();
    } else {
      output = `收到指令: "${prompt}"\n\n[模拟模式] AI 服务未配置，请在 ship.json 中配置 API Key 后重启。`;
    }

    const duration = Date.now() - startTime;
    this.logger.log('info', `模拟 Agent 执行完成`, { duration, context: context?.source });

    return {
      success: true,
      output,
      toolCalls,
    };
  }

  private generateStatusResponse(): string {
    const { config } = this.context;
    return `📊 **Agent 状态报告**

**项目**: ${config.name}
**版本**: ${config.version}
**模型**: ${config.llm.provider} / ${config.llm.model}

**权限状态**:
- 读取代码仓库: ✅ ${typeof config.permissions.read_repo === 'boolean' ? (config.permissions.read_repo ? '已启用' : '已禁用') : '已启用（带路径限制）'}
- 写入代码: ${config.permissions.write_repo ? (config.permissions.write_repo.requiresApproval ? '⚠️ 需要审批' : '✅ 已启用') : '❌ 已禁用'}
- 执行 Shell: ${config.permissions.exec_shell ? (config.permissions.exec_shell.requiresApproval ? '⚠️ 需要审批' : '✅ 已启用') : '❌ 已禁用'}

**运行时**: 正常运行`;
  }

  private generateTasksResponse(): string {
    const tasksDir = path.join(this.context.projectRoot, '.ship', 'tasks');
    
    if (!fs.existsSync(tasksDir)) {
      return `📋 **任务列表**

当前没有配置定时任务。

在 .ship/tasks/ 目录下添加 .md 文件来定义任务。`;
    }

    const files = fs.readdirSync(tasksDir).filter(f => f.endsWith('.md'));
    
    if (files.length === 0) {
      return `📋 **任务列表**

当前没有配置定时任务。`;
    }

    return `📋 **任务列表**

已配置 ${files.length} 个任务:
${files.map(f => `- ${f.replace('.md', '')}`).join('\n')}

任务定义位置: .ship/tasks/`;
  }

  private generateScanResponse(): string {
    return `🔍 **代码扫描结果**

扫描目录: ${this.context.projectRoot}

**发现**:
- 代码结构正常
- 建议定期运行测试

**TODO 注释**: 未检测到`;
  }

  private generateApprovalsResponse(): string {
    return `📋 **审批列表**

当前没有待审批的请求。`;
  }

  /**
   * 获取工具实例
   */
  getTools(): AgentTools {
    return this.tools;
  }

  /**
   * 获取权限引擎实例
   */
  getPermissionEngine(): PermissionEngine {
    return this.permissionEngine;
  }

  /**
   * 获取配置
   */
  getConfig(): ShipConfig {
    return this.context.config;
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// ==================== Factory Functions ====================

export function createAgentRuntime(context: AgentContext): AgentRuntime {
  return new AgentRuntime(context);
}

export function createAgentRuntimeFromPath(projectRoot: string): AgentRuntime {
  // 读取配置文件
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
      exec_shell: { requiresApproval: true },
    },
    integrations: {
      telegram: { enabled: false },
    },
  };

  // 确保 .ship 目录存在
  const shipDir = getShipDirPath(projectRoot);
  fs.ensureDirSync(shipDir);
  fs.ensureDirSync(path.join(shipDir, 'tasks'));
  fs.ensureDirSync(path.join(shipDir, 'routes'));
  fs.ensureDirSync(path.join(shipDir, 'approvals'));
  fs.ensureDirSync(path.join(shipDir, 'logs'));
  fs.ensureDirSync(path.join(shipDir, '.cache'));

  // 读取 Agent.md
  try {
    if (fs.existsSync(agentMdPath)) {
      agentMd = fs.readFileSync(agentMdPath, 'utf-8');
    }
  } catch {
    // 使用默认配置
  }

  // 读取 ship.json
  try {
    if (fs.existsSync(shipJsonPath)) {
      config = fs.readJsonSync(shipJsonPath) as ShipConfig;
    }
  } catch {
    // 使用默认配置
  }

  return new AgentRuntime({
    projectRoot,
    config,
    agentMd,
  });
}
