function safeJsonParse(input: unknown): unknown | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
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
  if (typeof content === "string") return truncate(content, maxChars);
  if (Array.isArray(content)) {
    const parts = content
      .map((p) => {
        if (!p || typeof p !== "object") return "";
        if (p.type === "text") return String((p as any).text ?? "");
        if (p.type === "input_text") return String((p as any).text ?? "");
        if (p.type === "tool-approval-request") {
          const toolName = ((p as any).toolCall as any)?.toolName;
          return `Approval requested: ${String(toolName ?? "")}`;
        }
        if (p.type === "tool-call") {
          const toolName = (p as any).toolName;
          return `Tool call: ${String(toolName ?? "")}`;
        }
        if (p.type === "tool-result") {
          const toolName = (p as any).toolName;
          return `Tool result: ${String(toolName ?? "")}`;
        }
        if (p.type === "tool-error") {
          const toolName = (p as any).toolName;
          return `Tool error: ${String(toolName ?? "")}`;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
    return truncate(parts, maxChars);
  }
  if (content && typeof content === "object")
    return stringifyCompact(content, maxChars);
  return truncate(String(content ?? ""), maxChars);
}

function extractMessages(payload: any): any[] | null {
  if (!payload || typeof payload !== "object") return null;
  if (Array.isArray((payload as any).messages))
    return (payload as any).messages;
  if (Array.isArray((payload as any).input)) return (payload as any).input;
  return null;
}

function indentBlock(text: string, indent: string): string {
  return text
    .split("\n")
    .map((l) => `${indent}${l}`)
    .join("\n");
}

function formatToolCalls(toolCalls: any, maxArgsChars: number): any[] | null {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return null;
  const out: any[] = [];
  for (const tc of toolCalls) {
    if (!tc || typeof tc !== "object") continue;
    const id = typeof (tc as any).id === "string" ? (tc as any).id : undefined;
    const type =
      typeof (tc as any).type === "string" ? (tc as any).type : undefined;
    const fn = (tc as any).function;
    const name =
      fn && typeof fn === "object" && typeof fn.name === "string"
        ? fn.name
        : typeof (tc as any).tool === "string"
          ? (tc as any).tool
          : undefined;
    const argsRaw =
      fn && typeof fn === "object"
        ? (fn as any).arguments
        : (tc as any).arguments;
    const args =
      typeof argsRaw === "string"
        ? truncate(argsRaw, maxArgsChars)
        : truncate(JSON.stringify(argsRaw ?? {}), maxArgsChars);

    out.push({
      ...(id ? { id } : {}),
      ...(type ? { type } : {}),
      ...(name ? { name } : {}),
      ...(args ? { arguments: args } : {}),
    });
  }
  return out.length > 0 ? out : null;
}

function formatMessagesForLog(messages: any[], opts: {
  maxContentChars: number;
  maxToolArgsChars: number;
}): any[] {
  const out: any[] = [];

  for (const m of messages) {
    if (!m || typeof m !== "object") continue;

    const role = typeof (m as any).role === "string" ? (m as any).role : "unknown";
    const name = typeof (m as any).name === "string" ? (m as any).name : undefined;
    const toolCallId =
      typeof (m as any).tool_call_id === "string"
        ? (m as any).tool_call_id
        : undefined;

    const formatted: any = {
      role,
      ...(name ? { name } : {}),
      ...(toolCallId ? { tool_call_id: toolCallId } : {}),
    };

    // 关键注释：不要做“整体截断”，而是每条消息独立截断，并保留完整消息序列（含 tool）。
    if ("content" in (m as any)) {
      formatted.content = contentToText((m as any).content, opts.maxContentChars);
    }

    // OpenAI-compatible: assistant tool_calls
    const toolCalls = formatToolCalls((m as any).tool_calls, opts.maxToolArgsChars);
    if (toolCalls) formatted.tool_calls = toolCalls;

    out.push(formatted);
  }

  return out;
}


export type ProviderFetch = (input: any, init?: any) => Promise<any>;

export function parseFetchRequestForLog(
  input: any,
  init: any,
): {
  url: string;
  method: string;
  payload: unknown | null;
  includePayload: boolean;
  maxChars: number;
  messages: any[] | null;
  system: unknown;
  model?: string;
  toolsCount: number;
  systemLength?: number;
  requestText: string;
  meta: Record<string, unknown>;
} | null {
  // 关键注释：这里的 maxChars 不用于“整体截断请求日志”，仅作为 payload 兜底 stringify 的保护上限。
  const maxChars = 12000;
  // 统一开关：只由 ship.json 的 llm.logMessages 控制（见 core/agent/model.ts）。
  // 这里不支持额外的“更敏感 payload”开关，避免不一致与误配置。
  const includePayload = false;

  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url;
  const method = String(
    init?.method ||
      (typeof input !== "string" && input instanceof Request
        ? input.method
        : "POST"),
  );

  const payload = safeJsonParse((init as any)?.body);
  if (!payload || typeof payload !== "object") {
    if ((init as any)?.body) {
      return {
        url,
        method,
        payload: null,
        includePayload,
        maxChars,
        messages: null,
        system: undefined,
        toolsCount: 0,
        requestText: `===== LLM REQUEST BEGIN =====\nmethod: ${method}\nurl: ${url}\n(non-JSON body)\n===== LLM REQUEST END =====`,
        meta: { kind: "llm_request", url, method },
      };
    }
    return null;
  }

  const model =
    typeof (payload as any).model === "string"
      ? (payload as any).model
      : undefined;
  const system = (payload as any).system;
  const messages = extractMessages(payload);
  const tools = (payload as any).tools;
  const toolsCount = Array.isArray(tools)
    ? tools.length
    : tools && typeof tools === "object"
      ? Object.keys(tools).length
      : 0;

  const headerLines: string[] = [
    "===== LLM REQUEST BEGIN =====",
    `method: ${method}`,
    `url: ${url}`,
    ...(model ? [`model: ${model}`] : []),
    ...(toolsCount ? [`tools: ${toolsCount}`] : []),
  ];

  const messageTextParts: string[] = [headerLines.join("\n")];
  if (typeof system === "string" && system.trim()) {
    messageTextParts.push(
      ["system:", indentBlock(truncate(system, 4000), "  ")].join("\n"),
    );
  }
  if (messages && Array.isArray(messages)) {
    const formattedMessages = formatMessagesForLog(messages, {
      maxContentChars: 2000,
      maxToolArgsChars: 1200,
    });
    messageTextParts.push(`messages: ${JSON.stringify(formattedMessages, null, 2)}`);
  } else {
    messageTextParts.push(
      ["payload:", indentBlock(stringifyCompact(payload, maxChars), "  ")].join(
        "\n",
      ),
    );
  }
  messageTextParts.push("===== LLM REQUEST END =====");

  return {
    url,
    method,
    payload,
    includePayload,
    maxChars,
    messages,
    system,
    model,
    toolsCount,
    systemLength: typeof system === "string" ? system.length : undefined,
    // 注意：不做整体截断；每条消息已单独截断。
    requestText: messageTextParts.join("\n"),
    meta: {
      kind: "llm_request",
      url,
      method,
      model,
      toolsCount,
      messagesCount: Array.isArray(messages) ? messages.length : 0,
      systemLength: typeof system === "string" ? system.length : undefined,
      ...(includePayload ? { payload } : {}),
    },
  };
}
