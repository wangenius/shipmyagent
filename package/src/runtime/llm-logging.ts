import { AsyncLocalStorage } from 'node:async_hooks';

export type LlmRequestContext = {
  sessionId?: string;
  requestId?: string;
};

export const llmRequestContext = new AsyncLocalStorage<LlmRequestContext>();

type ProviderFetch = (input: any, init?: any) => Promise<any>;

function envFlag(name: string): boolean | undefined {
  const raw = process.env[name];
  if (typeof raw !== 'string') return undefined;
  return raw !== '0';
}

function safeJsonParse(input: unknown): unknown | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + `…(truncated, ${text.length} chars total)`;
}

function stringifyCompact(value: unknown, maxChars: number): string {
  try {
    return truncate(JSON.stringify(value), maxChars);
  } catch {
    return truncate(String(value), maxChars);
  }
}

function contentToText(content: any, maxChars: number): string {
  if (typeof content === 'string') return truncate(content, maxChars);
  if (Array.isArray(content)) {
    const parts = content
      .map((p) => {
        if (!p || typeof p !== 'object') return '';
        if (p.type === 'text') return String((p as any).text ?? '');
        if (p.type === 'input_text') return String((p as any).text ?? '');
        if (p.type === 'tool-approval-request') {
          const toolName = ((p as any).toolCall as any)?.toolName;
          return `Approval requested: ${String(toolName ?? '')}`;
        }
        if (p.type === 'tool-call') {
          const toolName = (p as any).toolName;
          return `Tool call: ${String(toolName ?? '')}`;
        }
        if (p.type === 'tool-result') {
          const toolName = (p as any).toolName;
          return `Tool result: ${String(toolName ?? '')}`;
        }
        if (p.type === 'tool-error') {
          const toolName = (p as any).toolName;
          return `Tool error: ${String(toolName ?? '')}`;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
    return truncate(parts, maxChars);
  }
  if (content && typeof content === 'object') return stringifyCompact(content, maxChars);
  return truncate(String(content ?? ''), maxChars);
}

function extractMessages(payload: any): any[] | null {
  if (!payload || typeof payload !== 'object') return null;
  if (Array.isArray((payload as any).messages)) return (payload as any).messages;
  if (Array.isArray((payload as any).input)) return (payload as any).input; // OpenAI Responses API
  return null;
}

function indentBlock(text: string, indent: string): string {
  return text
    .split('\n')
    .map((l) => `${indent}${l}`)
    .join('\n');
}

function formatMessagesForLog(messages: any[], maxCharsTotal: number): string {
  const lines: string[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const role = m && typeof m === 'object' ? String((m as any).role ?? 'unknown') : 'unknown';
    const content = m && typeof m === 'object' ? (m as any).content : m;
    const text = contentToText(content, 4000);
    const header = `[#${i}] role=${role}`;
    lines.push([header, indentBlock(text || '(empty)', '  ')].join('\n'));
  }
  return truncate(lines.join('\n'), maxCharsTotal);
}

export function withLlmRequestContext<T>(ctx: LlmRequestContext, fn: () => T): T {
  return llmRequestContext.run(ctx, fn);
}

export function createLlmLoggingFetch(args: {
  logger: { log(level: string, message: string, data?: Record<string, unknown>): Promise<void> };
  enabled: boolean;
  maxChars?: number;
}): ProviderFetch {
  const baseFetch: ProviderFetch = (globalThis.fetch as any).bind(globalThis);
  const maxChars = args.maxChars ?? 12000;
  const includePayload = envFlag('SMA_LOG_LLM_PAYLOAD') ?? false;

  return async (input, init) => {
    if (args.enabled) {
      try {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : (input as Request).url;
        const method = String(init?.method || (typeof input !== 'string' && input instanceof Request ? input.method : 'POST'));

        const payload = safeJsonParse((init as any)?.body);
        const ctx = llmRequestContext.getStore();

        if (payload && typeof payload === 'object') {
          const model = typeof (payload as any).model === 'string' ? (payload as any).model : undefined;
          const system = (payload as any).system;
          const messages = extractMessages(payload);
          const tools = (payload as any).tools;
          const toolsCount = Array.isArray(tools) ? tools.length : tools && typeof tools === 'object' ? Object.keys(tools).length : 0;

          const headerLines: string[] = [
            '===== LLM REQUEST BEGIN =====',
            `method: ${method}`,
            `url: ${url}`,
            ...(model ? [`model: ${model}`] : []),
            ...(ctx?.sessionId ? [`sessionId: ${ctx.sessionId}`] : []),
            ...(ctx?.requestId ? [`requestId: ${ctx.requestId}`] : []),
            ...(toolsCount ? [`tools: ${toolsCount}`] : []),
          ];

          const messageTextParts: string[] = [headerLines.join('\n')];
          if (typeof system === 'string' && system.trim()) {
            messageTextParts.push(['system:', indentBlock(truncate(system, 4000), '  ')].join('\n'));
          }
          if (messages && Array.isArray(messages)) {
            messageTextParts.push(`messages: (n=${messages.length})\n${formatMessagesForLog(messages, maxChars)}`);
          } else {
            messageTextParts.push(['payload:', indentBlock(stringifyCompact(payload, maxChars), '  ')].join('\n'));
          }
          messageTextParts.push('===== LLM REQUEST END =====');

          await args.logger.log('info', truncate(messageTextParts.join('\n'), maxChars), {
            kind: 'llm_request',
            url,
            method,
            model,
            sessionId: ctx?.sessionId,
            requestId: ctx?.requestId,
            toolsCount,
            messagesCount: Array.isArray(messages) ? messages.length : undefined,
            systemLength: typeof system === 'string' ? system.length : undefined,
            ...(includePayload ? { payload } : {}),
          });
        } else if ((init as any)?.body) {
          await args.logger.log('info', `===== LLM REQUEST BEGIN =====\nmethod: ${method}\nurl: ${url}\n(non-JSON body)\n===== LLM REQUEST END =====`, {
            kind: 'llm_request',
            url,
            method,
            sessionId: ctx?.sessionId,
            requestId: ctx?.requestId,
          });
        }
      } catch {
        // ignore logging failures
      }
    }

    return baseFetch(input, init);
  };
}
