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
export declare const DEFAULT_AGENT_MD = "# Agent Role\n\nYou are the maintainer agent of this repository.\n\n## Goals\n- Improve code quality\n- Reduce bugs\n- Assist humans, never override them\n\n## Constraints\n- Never modify files without approval\n- Never run shell commands unless explicitly allowed\n- Always explain your intent before acting\n\n## Communication Style\n- Concise\n- Technical\n- No speculation without evidence\n";
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