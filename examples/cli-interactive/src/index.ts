#!/usr/bin/env node

/**
 * ShipMyAgent Interactive CLI
 * 使用 @clack/prompts 构建的交互式命令行界面
 * 通过 HTTP 与 ShipMyAgent Runtime 服务交互
 */

import * as p from '@clack/prompts';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { setTimeout } from 'timers/promises';

// ==================== Types ====================

interface AgentStatus {
  name: string;
  status: string;
  tasksCount: number;
  pendingApprovalsCount: number;
  timestamp: string;
}

interface Task {
  id: string;
  name: string;
  description?: string;
  schedule?: string;
  enabled: boolean;
}

interface Approval {
  id: string;
  type: string;
  action: string;
  details: string;
  status: string;
  createdAt: string;
}

interface ExecuteResult {
  success: boolean;
  output?: string;
  message?: string;
  error?: string;
}

// ==================== Configuration ====================

const DEFAULT_SERVER_URL = 'http://localhost:3000';
let serverUrl = DEFAULT_SERVER_URL;

// ==================== API Client ====================

class AgentClient {
  constructor(private baseUrl: string) {}

  /**
   * 发送 HTTP 请求
   */
  private async request(
    path: string,
    options?: { method?: string; body?: string }
  ): Promise<{ data?: unknown; error?: string }> {
    try {
      const url = `${this.baseUrl}${path}`;
      const response = await fetch(url, {
        method: options?.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        body: options?.body,
      });

      const data = await response.json();

      if (!response.ok) {
        return { error: data?.message || `HTTP ${response.status}` };
      }

      return { data };
    } catch (error) {
      return { error: String(error) };
    }
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    const result = await this.request('/health');
    return !result.error;
  }

  /**
   * 获取 Agent 状态
   */
  async getStatus(): Promise<AgentStatus | null> {
    const result = await this.request('/api/status');
    return result.error ? null : (result.data as AgentStatus);
  }

  /**
   * 获取任务列表
   */
  async getTasks(): Promise<Task[]> {
    const result = await this.request('/api/tasks');
    return result.error ? [] : ((result.data as any)?.tasks || []);
  }

  /**
   * 执行任务
   */
  async runTask(taskId: string): Promise<boolean> {
    const result = await this.request(`/api/tasks/${taskId}/run`, {
      method: 'POST',
    });
    return !result.error;
  }

  /**
   * 获取待审批列表
   */
  async getApprovals(): Promise<Approval[]> {
    const result = await this.request('/api/approvals');
    return result.error ? [] : ((result.data as any)?.approvals || []);
  }

  /**
   * 审批通过
   */
  async approve(approvalId: string, response?: string): Promise<boolean> {
    const result = await this.request(
      `/api/approvals/${approvalId}/approve`,
      {
        method: 'POST',
        body: JSON.stringify({ response }),
      }
    );
    return !result.error;
  }

  /**
   * 审批拒绝
   */
  async reject(approvalId: string, response?: string): Promise<boolean> {
    const result = await this.request(
      `/api/approvals/${approvalId}/reject`,
      {
        method: 'POST',
        body: JSON.stringify({ response }),
      }
    );
    return !result.error;
  }

  /**
   * 执行指令
   */
  async execute(instructions: string): Promise<ExecuteResult | null> {
    const result = await this.request('/api/execute', {
      method: 'POST',
      body: JSON.stringify({ instructions }),
    });
    return result.error ? null : (result.data as ExecuteResult);
  }

  /**
   * 列出文件
   */
  async listFiles(pattern?: string): Promise<string[]> {
    const result = await this.request(`/api/files?pattern=${pattern || '**/*'}`);
    return result.error ? [] : ((result.data as any)?.files || []);
  }

  /**
   * 获取日志
   */
  async getLogs(): Promise<unknown[]> {
    const result = await this.request('/api/logs');
    return result.error ? [] : ((result.data as any)?.logs || []);
  }
}

// ==================== UI Components ====================

/**
 * 显示欢迎信息
 */
function showWelcome(): void {
  console.clear();
  p.intro('ShipMyAgent Interactive CLI');
}

/**
 * 显示主菜单
 */
async function showMainMenu(client: AgentClient): Promise<void> {
  const status = await client.getStatus();

  const choice = await p.select({
    message: '请选择操作',
    options: [
      {
        value: 'status',
        label: '查看 Agent 状态',
        hint: status ? `${status.tasksCount} 个任务, ${status.pendingApprovalsCount} 个待审批` : undefined,
      },
      {
        value: 'execute',
        label: '执行指令',
        hint: '向 Agent 发送指令',
      },
      {
        value: 'tasks',
        label: '管理任务',
        hint: '查看和执行任务',
      },
      {
        value: 'approvals',
        label: '审批管理',
        hint: '查看和处理审批请求',
      },
      {
        value: 'files',
        label: '文件浏览',
        hint: '浏览项目文件',
      },
      {
        value: 'logs',
        label: '查看日志',
        hint: '查看运行日志',
      },
      {
        value: 'exit',
        label: '退出',
        hint: '退出程序',
      },
    ],
  });

  if (p.isCancel(choice)) {
    p.cancel('操作已取消');
    return;
  }

  switch (choice) {
    case 'status':
      await showStatus(client);
      break;
    case 'execute':
      await executeCommand(client);
      break;
    case 'tasks':
      await manageTasks(client);
      break;
    case 'approvals':
      await manageApprovals(client);
      break;
    case 'files':
      await browseFiles(client);
      break;
    case 'logs':
      await viewLogs(client);
      break;
    case 'exit':
      p.outro('再见！');
      process.exit(0);
  }

  // 返回主菜单
  await showMainMenu(client);
}

/**
 * 显示 Agent 状态
 */
async function showStatus(client: AgentClient): Promise<void> {
  const s = p.spinner();
  s.start('获取状态...');

  const status = await client.getStatus();
  s.stop('获取完成');

  if (!status) {
    p.note('无法获取状态', 'Agent 状态');
    await p.confirm({ message: '按 Enter 继续' });
    return;
  }

  p.note(
    `名称: ${status.name}
状态: ${status.status}
任务数: ${status.tasksCount}
待审批: ${status.pendingApprovalsCount}
更新时间: ${status.timestamp}`,
    'Agent 状态'
  );

  await p.confirm({ message: '按 Enter 继续' });
}

/**
 * 执行指令
 */
async function executeCommand(client: AgentClient): Promise<void> {
  const instructions = await p.text({
    message: '请输入指令',
    placeholder: '例如: 列出当前目录的文件',
    validate: (value) => {
      if (!value) return '指令不能为空';
    },
  });

  if (p.isCancel(instructions)) {
    p.cancel('操作已取消');
    return;
  }

  const s = p.spinner();
  s.start('执行指令...');

  const result = await client.execute(instructions);

  if (result?.success) {
    s.stop('执行完成');
    p.note(result.output || result.message || '成功', '执行结果');
  } else {
    s.stop('执行失败');
    p.note(result?.error || '未知错误', '执行结果');
  }

  await p.confirm({ message: '按 Enter 继续' });
}

/**
 * 管理任务
 */
async function manageTasks(client: AgentClient): Promise<void> {
  const s = p.spinner();
  s.start('获取任务列表...');

  const tasks = await client.getTasks();
  s.stop(`找到 ${tasks.length} 个任务`);

  if (tasks.length === 0) {
    p.note('暂无任务', '任务列表');
    await p.confirm({ message: '按 Enter 继续' });
    return;
  }

  const choice = await p.select({
    message: '选择任务',
    options: tasks.map((task) => ({
      value: task.id,
      label: task.name,
      hint: task.schedule || '手动执行',
    })),
  });

  if (p.isCancel(choice)) {
    p.cancel('操作已取消');
    return;
  }

  const action = await p.select({
    message: '选择操作',
    options: [
      { value: 'run', label: '立即执行' },
      { value: 'back', label: '返回' },
    ],
  });

  if (p.isCancel(action) || action === 'back') {
    return;
  }

  if (action === 'run') {
    const s = p.spinner();
    s.start('执行任务...');

    const success = await client.runTask(choice);

    if (success) {
      s.stop('任务执行中');
      p.note('任务已启动执行', '执行结果');
    } else {
      s.stop('执行失败');
      p.note('任务执行失败', '执行结果');
    }
  }

  await p.confirm({ message: '按 Enter 继续' });
}

/**
 * 管理审批
 */
async function manageApprovals(client: AgentClient): Promise<void> {
  const s = p.spinner();
  s.start('获取待审批列表...');

  const approvals = await client.getApprovals();
  s.stop(`找到 ${approvals.length} 个待审批`);

  if (approvals.length === 0) {
    p.note('暂无待审批请求', '审批列表');
    await p.confirm({ message: '按 Enter 继续' });
    return;
  }

  const choice = await p.select({
    message: '选择审批请求',
    options: approvals.map((approval) => ({
      value: approval.id,
      label: `${approval.type} - ${approval.action}`,
      hint: approval.details?.substring(0, 50) + (approval.details?.length > 50 ? '...' : ''),
    })),
  });

  if (p.isCancel(choice)) {
    p.cancel('操作已取消');
    return;
  }

  const action = await p.select({
    message: '选择操作',
    options: [
      { value: 'approve', label: '通过' },
      { value: 'reject', label: '拒绝' },
      { value: 'back', label: '返回' },
    ],
  });

  if (p.isCancel(action) || action === 'back') {
    return;
  }

  let response: string | symbol = '';
  if (action === 'approve' || action === 'reject') {
    response = await p.text({
      message: '输入回复 (可选)',
      placeholder: '例如: 同意执行',
    });
  }

  if (p.isCancel(response)) {
    p.cancel('操作已取消');
    return;
  }

  s.start('处理审批...');

  let success = false;
  if (action === 'approve') {
    success = await client.approve(choice, response as string);
  } else if (action === 'reject') {
    success = await client.reject(choice, response as string);
  }

  if (success) {
    s.stop('处理完成');
  } else {
    s.stop('处理失败');
  }

  await p.confirm({ message: '按 Enter 继续' });
}

/**
 * 浏览文件
 */
async function browseFiles(client: AgentClient): Promise<void> {
  const pattern = await p.text({
    message: '输入文件匹配模式',
    placeholder: '例如: **/*.ts 或 src/**/*',
    initialValue: '**/*',
  });

  if (p.isCancel(pattern)) {
    p.cancel('操作已取消');
    return;
  }

  const s = p.spinner();
  s.start('获取文件列表...');

  const files = await client.listFiles(pattern);
  s.stop(`找到 ${files.length} 个文件`);

  if (files.length === 0) {
    p.note('未找到文件', '文件列表');
  } else {
    p.note(files.slice(0, 20).join('\n') + (files.length > 20 ? `\n... 还有 ${files.length - 20} 个文件` : ''), '文件列表');
  }

  await p.confirm({ message: '按 Enter 继续' });
}

/**
 * 查看日志
 */
async function viewLogs(client: AgentClient): Promise<void> {
  const s = p.spinner();
  s.start('获取日志...');

  const logs = await client.getLogs();
  s.stop(`找到 ${logs.length} 条日志`);

  if (logs.length === 0) {
    p.note('暂无日志', '日志');
  } else {
    const logText = logs.slice(-10).map((log: any) =>
      `[${log.timestamp}] ${log.level}: ${log.message}`
    ).join('\n');

    p.note(logText, '最近 10 条日志');
  }

  await p.confirm({ message: '按 Enter 继续' });
}

// ==================== Main ====================

/**
 * 从当前目录加载 ship.json 获取服务器地址
 */
function loadServerUrl(): string {
  // 检查 .ship 目录
  if (existsSync(join(process.cwd(), '.ship', 'ship.json'))) {
    try {
      const shipJson = JSON.parse(
        readFileSync(join(process.cwd(), '.ship', 'ship.json'), 'utf-8')
      );
      if (shipJson.server?.port) {
        return `http://localhost:${shipJson.server.port}`;
      }
    } catch {
      // 忽略错误
    }
  }

  return DEFAULT_SERVER_URL;
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  showWelcome();

  // 加载服务器地址
  serverUrl = loadServerUrl();

  // 尝试连接服务器
  const client = new AgentClient(serverUrl);
  const s = p.spinner();

  s.start(`连接到 ${serverUrl}...`);

  await setTimeout(500); // 给一点时间显示 loading

  const isHealthy = await client.healthCheck();

  if (!isHealthy) {
    s.stop('连接失败');
    p.note(
      `无法连接到 ${serverUrl}\n请确保 ShipMyAgent 服务正在运行`,
      '连接错误'
    );

    const retry = await p.confirm({
      message: '是否重试？',
      initialValue: true,
    });

    if (p.isCancel(retry) || !retry) {
      p.outro('再见！');
      process.exit(1);
    }

    // 递归重试
    await main();
    return;
  }

  s.stop('连接成功');

  // 显示主菜单
  await showMainMenu(client);
}

// 运行主函数
main().catch((error) => {
  console.error('发生错误:', error);
  process.exit(1);
});
