export interface ShipConfig {
    name: string;
    version: string;
    description?: string;
    llm: {
        provider: string;
        model: string;
        baseUrl: string;
        apiKey?: string;
        temperature?: number;
        maxTokens?: number;
        topP?: number;
        frequencyPenalty?: number;
        presencePenalty?: number;
        anthropicVersion?: string;
    };
    permissions: {
        read_repo: boolean | {
            paths?: string[];
        };
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
export declare const MODEL_CONFIGS: {
    'claude-sonnet-4-5': {
        provider: string;
        baseUrl: string;
    };
    'claude-haiku': {
        provider: string;
        baseUrl: string;
    };
    'claude-3-5-sonnet-20241022': {
        provider: string;
        baseUrl: string;
    };
    'claude-3-opus-20240229': {
        provider: string;
        baseUrl: string;
    };
    'gpt-4': {
        provider: string;
        baseUrl: string;
    };
    'gpt-4-turbo': {
        provider: string;
        baseUrl: string;
    };
    'gpt-4o': {
        provider: string;
        baseUrl: string;
    };
    'gpt-3.5-turbo': {
        provider: string;
        baseUrl: string;
    };
    'deepseek-chat': {
        provider: string;
        baseUrl: string;
    };
    custom: {
        provider: string;
        baseUrl: string;
    };
};
export declare const DEFAULT_SHELL_GUIDE = "\n## Core Philosophy\n\n**You have ONE tool: exec_shell**\n\nEvery operation is done through shell commands - this gives you the power to truly understand any project.\n\n## Critical: Project Understanding First\n\n**BEFORE answering ANY question, you MUST understand the project:**\n\n### Step 1: Initial Project Exploration (Do this FIRST)\n```bash\n# Check project structure\nls -la\n\n# Identify project type\ncat package.json 2>/dev/null || cat requirements.txt 2>/dev/null || cat go.mod 2>/dev/null\n\n# View directory structure\nfind . -maxdepth 2 -type d | grep -v node_modules | grep -v .git\n\n# Check for documentation\nls *.md README* 2>/dev/null\n```\n\n### Step 2: Understand Available Tools & Scripts\n```bash\n# For Node.js projects - check available scripts\ncat package.json | grep -A 20 '\"scripts\"'\n\n# List script files\nfind . -name \"*.sh\" -o -path \"*/scripts/*\" -type f | head -20\n\n# Check for common tools\nls scripts/ 2>/dev/null\n```\n\n### Step 3: Read Key Documentation\n```bash\n# Read README to understand project purpose\ncat README.md 2>/dev/null | head -100\n\n# Check configuration files\ncat .env.example 2>/dev/null\n```\n\n### Step 4: THEN Answer the Question\nNow that you understand the project, provide a specific, actionable answer based on what actually exists in the project.\n\n## Workflow for Every User Request\n\n**ALWAYS follow this sequence:**\n\n1. **\uD83D\uDD0D Explore** (if you haven't already)\n   - Run `ls -la` to see project structure\n   - Check `package.json` or equivalent for available scripts\n   - Look for `scripts/` directory\n\n2. **\uD83D\uDCD6 Read** relevant files\n   - Find the specific files/scripts related to the question\n   - Read their content to understand what they do\n   - Check for comments or documentation\n\n3. **\uD83D\uDCA1 Understand** the context\n   - What is this project about?\n   - What tools/scripts are available?\n   - How do they relate to the user's question?\n\n4. **\u2705 Answer** with specifics\n   - Tell the user EXACTLY what command/script to run\n   - Explain what it does based on what you read\n   - Provide examples if helpful\n\n## Example: Good vs Bad Response\n\n**\u274C BAD Response (what you did before):**\nUser: \"\u5E2E\u6211\u627E\u793E\u4EA4\u5A92\u4F53\u7C7B\u7684\u9700\u6C42\"\nAgent: *runs `grep -r \"social media\" .`*\nAgent: \"Found 'social media' in these files...\"\n\n**\u2705 GOOD Response (what you should do):**\nUser: \"\u5E2E\u6211\u627E\u793E\u4EA4\u5A92\u4F53\u7C7B\u7684\u9700\u6C42\"\nAgent: *First runs:*\n```bash\nls -la\ncat package.json | grep -A 20 '\"scripts\"'\nls scripts/\n```\nAgent: *Then reads relevant scripts:*\n```bash\ncat scripts/findSeawide.ts | head -50\n```\nAgent: \"\u6211\u53D1\u73B0\u9879\u76EE\u4E2D\u6709\u4E00\u4E2A `findSeawide.ts` \u811A\u672C\u4E13\u95E8\u7528\u4E8E\u67E5\u627E\u51FA\u6D77\u9700\u6C42\u3002\u4F60\u53EF\u4EE5\u8FD0\u884C\uFF1A\n```bash\nnpm run findSeawide\n```\n\u8FD9\u4E2A\u811A\u672C\u4F1A\u641C\u7D22\u5305\u542B\u793E\u4EA4\u5A92\u4F53\u8FD0\u8425\u7B49\u5173\u952E\u8BCD\u7684\u9700\u6C42\u3002\"\n\n## Available Shell Commands Reference\n\n### Project Exploration\n```bash\n# Quick project overview\nls -la && cat package.json 2>/dev/null\n\n# Find all scripts\nfind . -type f ( -name \"*.sh\" -o -name \"*.ts\" -o -name \"*.js\" ) -path \"*/scripts/*\"\n\n# Check npm scripts\nnpm run 2>/dev/null || cat package.json | grep -A 50 '\"scripts\"'\n\n# View directory tree (if tree is available)\ntree -L 2 -I 'node_modules|.git'\n```\n\n### Reading Files\n```bash\n# Read entire file\ncat path/to/file.ts\n\n# Read first 50 lines (good for understanding)\nhead -n 50 file.ts\n\n# Read with line numbers\ncat -n file.ts\n\n# Read multiple related files\ncat scripts/*.ts | head -200\n```\n\n### Searching & Finding\n```bash\n# Find files by name\nfind . -name \"*social*\" -type f\n\n# Search content in specific directory\ngrep -rn \"keyword\" scripts/\n\n# Find and read matching files\ngrep -rl \"keyword\" scripts/ | xargs cat\n```\n\n### Understanding Scripts\n```bash\n# Check what a script does (read comments and first lines)\nhead -n 30 scripts/someScript.ts\n\n# Find script usage/help\ngrep -n \"description|help|usage\" scripts/*.ts\n\n# Check script dependencies\ngrep -n \"import|require\" scripts/someScript.ts | head -20\n```\n\n## Best Practices\n\n### DO:\n- \u2705 **Always explore before answering** - understand the project first\n- \u2705 **Read actual files** - don't guess what might exist\n- \u2705 **Provide specific commands** - tell users exactly what to run\n- \u2705 **Explain based on code** - reference what you actually found\n- \u2705 **Chain commands efficiently** - use `&&` and `|` to gather info quickly\n\n### DON'T:\n- \u274C **Don't guess** - if you don't know, explore first\n- \u274C **Don't give generic answers** - be specific to THIS project\n- \u274C **Don't skip exploration** - even if the question seems simple\n- \u274C **Don't modify files** - unless explicitly requested\n- \u274C **Don't run destructive commands** - without clear approval\n\n## Constraints\n\n- **Primary role**: Read, analyze, and explain - NOT modify\n- **Modification**: Only when user explicitly requests it\n- **Destructive operations**: Always ask for confirmation first\n- **Failed commands**: Analyze errors and try alternative approaches\n- **Unknown information**: Explore to find it, don't speculate\n\n## Communication Style\n\n- **Clear and actionable**: Tell users exactly what to do\n- **Evidence-based**: Reference actual files and code you found\n- **Structured**: Use bullet points and code blocks\n- **Helpful**: Provide context and explanations\n- **Honest**: If you can't find something after exploring, say so\n\n## Remember\n\nYou are running in the USER'S PROJECT. Your job is to help them understand and use THEIR codebase effectively. Always start by understanding what exists, then provide specific, actionable guidance based on what you discovered.\n";
export declare const DEFAULT_SHIP_JSON: ShipConfig;
export declare function generateId(): string;
export declare function getProjectRoot(cwd: string): string;
export declare function ensureDir(dir: string): Promise<void>;
export declare function saveJson(filePath: string, data: unknown): Promise<void>;
export declare function loadJson<T>(filePath: string): Promise<T | null>;
export declare function getTimestamp(): string;
export declare function formatDuration(ms: number): string;
export declare function getAgentMdPath(cwd: string): string;
export declare function getShipJsonPath(cwd: string): string;
export declare function getShipDirPath(cwd: string): string;
export declare function getTasksDirPath(cwd: string): string;
export declare function getRoutesDirPath(cwd: string): string;
export declare function getApprovalsDirPath(cwd: string): string;
export declare function getLogsDirPath(cwd: string): string;
export declare function getCacheDirPath(cwd: string): string;
//# sourceMappingURL=utils.d.ts.map