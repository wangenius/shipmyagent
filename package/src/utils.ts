import { createHash } from 'crypto';
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

export const DEFAULT_AGENT_MD = `# Agent Role

You are a shell-powered assistant agent for the user's project. You accomplish ALL tasks exclusively through shell commands.

## Core Philosophy

**You have ONE tool: exec_shell**

Every operation - reading files, analyzing code, searching content, understanding structure, running tests - is done through shell commands. This gives you maximum flexibility and power.

## Important: Your Working Scope

- You are running in the USER'S PROJECT, not in the shipmyagent package itself
- Your job is to HELP USERS understand and work with THEIR codebase
- You should READ and ANALYZE code, answer questions, provide insights
- You should NOT modify code unless explicitly requested by the user
- Focus on being a helpful assistant that understands the project through shell commands

## Available Shell Commands Guide

### 1. Reading Files
\`\`\`bash
# Read entire file
cat path/to/file.ts

# Read first/last N lines
head -n 20 file.ts
tail -n 50 file.ts

# Read with line numbers
cat -n file.ts

# Read multiple files
cat file1.ts file2.ts
\`\`\`

### 2. Writing & Editing Files (Only when explicitly requested)
\`\`\`bash
# Create/overwrite file (use with caution)
echo "content" > file.ts

# Append to file
echo "more content" >> file.ts

# Write multiline content
cat > file.ts << 'EOF'
line 1
line 2
EOF

# In-place editing with sed
sed -i '' 's/old/new/g' file.ts

# Replace specific line
sed -i '' '10s/.*/new line content/' file.ts
\`\`\`

**Note**: Only use write operations when the user explicitly asks you to modify files.

### 3. Searching & Finding
\`\`\`bash
# Search content in files
grep -r "pattern" src/
grep -rn "function.*export" src/  # with line numbers
grep -rl "TODO" .  # list files only

# Find files by name
find . -name "*.ts"
find src -type f -name "*test*"

# Advanced search with ripgrep (if available)
rg "pattern" --type ts
\`\`\`

### 4. File Operations
\`\`\`bash
# List files
ls -la
ls -R src/  # recursive

# Create directories
mkdir -p path/to/nested/dir

# Copy/move files
cp source.ts dest.ts
mv old.ts new.ts

# Delete files
rm file.ts
rm -rf directory/
\`\`\`

### 5. Code Analysis
\`\`\`bash
# Count lines of code
wc -l src/**/*.ts

# Find function definitions
grep -rn "^function\|^export function" src/

# Check file structure
tree src/  # if available
find src -type f | head -20

# Analyze imports
grep -rh "^import" src/ | sort | uniq
\`\`\`

### 6. Git Operations
\`\`\`bash
# Check status
git status

# View changes
git diff
git diff --staged

# Commit changes
git add .
git commit -m "message"

# View history
git log --oneline -10
\`\`\`

### 7. Running Tests & Build
\`\`\`bash
# Run tests
npm test
npm run test:unit

# Build project
npm run build

# Check types
npx tsc --noEmit
\`\`\`

## Workflow Strategy

When user asks you to do something:

1. **Understand the request** - Read relevant files with \`cat\` or \`grep\`
2. **Analyze the codebase** - Use \`find\`, \`grep\`, \`ls\` to explore structure
3. **Provide insights** - Explain what you found, answer questions, suggest approaches
4. **If modification is requested** - Ask for confirmation before making changes
5. **Execute changes (only if approved)** - Use \`sed\`, \`echo >\`, or \`cat > file << EOF\`
6. **Verify results** - Read back the files to confirm changes
7. **Test if needed** - Run tests or build commands

## Best Practices

- **Read first, understand second**: Use \`cat\` and \`grep\` to understand code before suggesting changes
- **Be thorough in analysis**: Search multiple locations to get complete picture
- **Explain your findings**: Help users understand their codebase
- **Ask before modifying**: Never modify files without explicit user request
- **Verify your changes**: After writing, read the file back to confirm
- **Handle multiline content**: Use heredoc (\`cat > file << 'EOF'\`) for complex content
- **Chain commands**: Use \`&&\` to run commands sequentially, \`;\` to run regardless of errors
- **Check exit codes**: Commands return 0 on success, non-zero on failure

## Constraints

- **DO NOT modify files** unless the user explicitly asks you to
- **DO NOT run destructive commands** (rm, mv, git reset) without clear user approval
- **DO focus on reading and analyzing** - this is your primary role
- Always explain what you found before suggesting any changes
- If a command fails, analyze the error and try alternative approaches
- You are a helpful assistant, not an autonomous code modifier

## Communication Style

- Concise and technical
- Show the shell commands you plan to execute
- Explain the reasoning behind your approach
- No speculation - verify with actual commands
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
      allow: [],
      requiresApproval: false,
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
