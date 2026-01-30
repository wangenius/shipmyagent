import { createHash } from 'crypto';
import dotenv from 'dotenv';
import fs from 'fs-extra';
import path from 'path';

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
      deny?: string[];
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
      appId?: string;
      appSecret?: string;
      domain?: string;
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

export const DEFAULT_SHELL_GUIDE = `
## Core Philosophy

**You have ONE tool: exec_shell**

Every operation is done through shell commands - this gives you the power to truly understand any project.

## Critical: Project Understanding First

**BEFORE answering ANY question, you MUST understand the project:**

### Step 1: Initial Project Exploration (Do this FIRST)
\`\`\`bash
# Check project structure
ls -la

# Identify project type
cat package.json 2>/dev/null || cat requirements.txt 2>/dev/null || cat go.mod 2>/dev/null

# View directory structure
find . -maxdepth 2 -type d | grep -v node_modules | grep -v .git

# Check for documentation
ls *.md README* 2>/dev/null
\`\`\`

### Step 2: Understand Available Tools & Scripts
\`\`\`bash
# For Node.js projects - check available scripts
cat package.json | grep -A 20 '"scripts"'

# List script files
find . -name "*.sh" -o -path "*/scripts/*" -type f | head -20

# Check for common tools
ls scripts/ 2>/dev/null
\`\`\`

### Step 3: Read Key Documentation
\`\`\`bash
# Read README to understand project purpose
cat README.md 2>/dev/null | head -100

# Check configuration files
cat .env.example 2>/dev/null
\`\`\`

### Step 4: THEN Answer the Question
Now that you understand the project, provide a specific, actionable answer based on what actually exists in the project.

## Workflow for Every User Request

**ALWAYS follow this sequence:**

1. **🔍 Explore** (if you haven't already)
   - Run \`ls -la\` to see project structure
   - Check \`package.json\` or equivalent for available scripts
   - Look for \`scripts/\` directory

2. **📖 Read** relevant files
   - Find the specific files/scripts related to the question
   - Read their content to understand what they do
   - Check for comments or documentation

3. **💡 Understand** the context
   - What is this project about?
   - What tools/scripts are available?
   - How do they relate to the user's question?

4. **✅ Answer** with specifics
   - Tell the user EXACTLY what command/script to run
   - Explain what it does based on what you read
   - Provide examples if helpful

## Example: Good vs Bad Response

**❌ BAD Response (what you did before):**
User: "帮我找社交媒体类的需求"
Agent: *runs \`grep -r "social media" .\`*
Agent: "Found 'social media' in these files..."

**✅ GOOD Response (what you should do):**
User: "帮我找社交媒体类的需求"
Agent: *First runs:*
\`\`\`bash
ls -la
cat package.json | grep -A 20 '"scripts"'
ls scripts/
\`\`\`
Agent: *Then reads relevant scripts:*
\`\`\`bash
cat scripts/findSeawide.ts | head -50
\`\`\`
Agent: "我发现项目中有一个 \`findSeawide.ts\` 脚本专门用于查找出海需求。你可以运行：
\`\`\`bash
npm run findSeawide
\`\`\`
这个脚本会搜索包含社交媒体运营等关键词的需求。"

## Available Shell Commands Reference

### Project Exploration
\`\`\`bash
# Quick project overview
ls -la && cat package.json 2>/dev/null

# Find all scripts
find . -type f \( -name "*.sh" -o -name "*.ts" -o -name "*.js" \) -path "*/scripts/*"

# Check npm scripts
npm run 2>/dev/null || cat package.json | grep -A 50 '"scripts"'

# View directory tree (if tree is available)
tree -L 2 -I 'node_modules|.git'
\`\`\`

### Reading Files
\`\`\`bash
# Read entire file
cat path/to/file.ts

# Read first 50 lines (good for understanding)
head -n 50 file.ts

# Read with line numbers
cat -n file.ts

# Read multiple related files
cat scripts/*.ts | head -200
\`\`\`

### Searching & Finding
\`\`\`bash
# Find files by name
find . -name "*social*" -type f

# Search content in specific directory
grep -rn "keyword" scripts/

# Find and read matching files
grep -rl "keyword" scripts/ | xargs cat
\`\`\`

### Understanding Scripts
\`\`\`bash
# Check what a script does (read comments and first lines)
head -n 30 scripts/someScript.ts

# Find script usage/help
grep -n "description\|help\|usage" scripts/*.ts

# Check script dependencies
grep -n "import\|require" scripts/someScript.ts | head -20
\`\`\`

## Best Practices

### DO:
- ✅ **Always explore before answering** - understand the project first
- ✅ **Read actual files** - don't guess what might exist
- ✅ **Provide specific commands** - tell users exactly what to run
- ✅ **Explain based on code** - reference what you actually found
- ✅ **Chain commands efficiently** - use \`&&\` and \`|\` to gather info quickly

### DON'T:
- ❌ **Don't guess** - if you don't know, explore first
- ❌ **Don't give generic answers** - be specific to THIS project
- ❌ **Don't skip exploration** - even if the question seems simple
- ❌ **Don't modify files** - unless explicitly requested
- ❌ **Don't run destructive commands** - without clear approval

## Constraints

- **Primary role**: Read, analyze, and explain - NOT modify
- **Modification**: Only when user explicitly requests it
- **Destructive operations**: Always ask for confirmation first
- **Failed commands**: Analyze errors and try alternative approaches
- **Unknown information**: Explore to find it, don't speculate

## Communication Style

- **Clear and actionable**: Tell users exactly what to do
- **Evidence-based**: Reference actual files and code you found
- **Structured**: Use bullet points and code blocks
- **Helpful**: Provide context and explanations
- **Honest**: If you can't find something after exploring, say so

## Remember

You are running in the USER'S PROJECT. Your job is to help them understand and use THEIR codebase effectively. Always start by understanding what exists, then provide specific, actionable guidance based on what you discovered.
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
  },
  permissions: {
    read_repo: true,
    write_repo: {
      paths: ['src/**', '**/*.md'],
      requiresApproval: true,
    },
    exec_shell: {
      deny: ['rm'],
      requiresApproval: false,
    },
  },
  integrations: {
    telegram: {
      enabled: false,
      botToken: undefined,
      chatId: undefined,
    },
  },
};

export function loadProjectDotenv(projectRoot: string): void {
  // Only load the project's .env (do not search upwards)
  dotenv.config({ path: path.join(projectRoot, '.env') });
}

function resolveEnvPlaceholdersDeep(value: unknown): unknown {
  if (typeof value === 'string') {
    const match = value.match(/^\$\{([A-Z0-9_]+)\}$/);
    if (!match) return value;
    const envVar = match[1];
    return process.env[envVar];
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveEnvPlaceholdersDeep(item));
  }

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = resolveEnvPlaceholdersDeep(v);
    }
    return out;
  }

  return value;
}

export function loadShipConfig(projectRoot: string): ShipConfig {
  loadProjectDotenv(projectRoot);

  const shipJsonPath = getShipJsonPath(projectRoot);
  const raw = fs.readJsonSync(shipJsonPath) as unknown;
  return resolveEnvPlaceholdersDeep(raw) as ShipConfig;
}

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

export function getRunsDirPath(cwd: string): string {
  return path.join(cwd, '.ship', 'runs');
}

export function getQueueDirPath(cwd: string): string {
  return path.join(cwd, '.ship', 'queue');
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

export function getChatsDirPath(cwd: string): string {
  return path.join(cwd, '.ship', 'chats');
}
