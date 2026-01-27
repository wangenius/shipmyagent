import { createHash } from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ShipConfig {
  name: string;
  version: string;
  description?: string;
  // LLM 配置
  llm: {
    provider: string;
    model: string;
    baseUrl: string;
    apiKey?: string;
    // 模型参数
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    // 特定模型配置
    anthropicVersion?: string;
  };
  permissions: {
    read_repo: boolean | { paths?: string[] };
    write_repo?: {
      paths?: string[];
      requiresApproval: boolean;
    };
    exec_shell?: {
      allow?: string[];
      requiresApproval: boolean;
    };
  };
  integrations: {
    telegram?: {
      enabled: boolean;
      botToken?: string;
      chatId?: string;
    };
    discord?: {
      enabled: boolean;
      botToken?: string;
    };
    feishu?: {
      enabled: boolean;
    };
  };
}

// 模型配置模板
export const MODEL_CONFIGS = {
  // Claude 系列
  'claude-sonnet-4-5': {
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
  },
  'claude-haiku': {
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
  },
  'claude-3-5-sonnet-20241022': {
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
  },
  'claude-3-opus-20240229': {
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
  },
  // OpenAI GPT 系列
  'gpt-4': {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
  },
  'gpt-4-turbo': {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
  },
  'gpt-4o': {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
  },
  'gpt-3.5-turbo': {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
  },
  // DeepSeek
  'deepseek-chat': {
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
  },
  // 自定义模型
  'custom': {
    provider: 'custom',
    baseUrl: '',
  },
};

export const DEFAULT_AGENT_MD = `# Agent Role

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
- No speculation without evidence
`;

export const DEFAULT_SHIP_JSON: ShipConfig = {
  name: 'shipmyagent',
  version: '1.0.0',
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: '${API_KEY}',
    temperature: 0.7,
    maxTokens: 4096,
  },
  permissions: {
    read_repo: true,
    write_repo: {
      paths: ['src/**', '**/*.md'],
      requiresApproval: true,
    },
    exec_shell: {
      allow: ['npm test', 'pnpm test', 'bun test'],
      requiresApproval: true,
    },
  },
  integrations: {
    telegram: {
      enabled: false,
    },
  },
};

export function generateId(): string {
  return createHash('md5').update(Date.now().toString()).digest('hex').slice(0, 8);
}

export function getProjectRoot(cwd: string): string {
  return path.resolve(cwd);
}

export async function ensureDir(dir: string): Promise<void> {
  if (!fs.existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true });
  }
}

export async function saveJson(filePath: string, data: unknown): Promise<void> {
  await fs.writeJson(filePath, data, { spaces: 2 });
}

export async function loadJson<T>(filePath: string): Promise<T | null> {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readJson(filePath) as Promise<T>;
}

export function getTimestamp(): string {
  return new Date().toISOString();
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function getAgentMdPath(cwd: string): string {
  return path.join(cwd, 'Agent.md');
}

export function getShipJsonPath(cwd: string): string {
  return path.join(cwd, 'ship.json');
}

export function getShipDirPath(cwd: string): string {
  return path.join(cwd, '.ship');
}

export function getTasksDirPath(cwd: string): string {
  return path.join(cwd, '.ship', 'tasks');
}

export function getRoutesDirPath(cwd: string): string {
  return path.join(cwd, '.ship', 'routes');
}

export function getApprovalsDirPath(cwd: string): string {
  return path.join(cwd, '.ship', 'approvals');
}

export function getLogsDirPath(cwd: string): string {
  return path.join(cwd, '.ship', 'logs');
}

export function getCacheDirPath(cwd: string): string {
  return path.join(cwd, '.ship', '.cache');
}
