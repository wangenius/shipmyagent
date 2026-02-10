/**
 * UIMessage 解析辅助。
 *
 * 关键点（中文）
 * - 这些能力属于 runtime 执行结果处理，不属于 prompts 组装
 * - 用于提取最终 assistant 文本与工具调用摘要
 */

/**
 * 从 UIMessage 中提取纯文本。
 */
export function extractTextFromUiMessage(message: any): string {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  return parts
    .filter((part: any) => part && typeof part === "object" && part.type === "text")
    .map((part: any) => String(part.text ?? ""))
    .join("\n")
    .trim();
}

/**
 * 从 UIMessage 中提取 tool 调用记录。
 */
export function extractToolCallsFromUiMessage(message: any): Array<{
  tool: string;
  input: Record<string, unknown>;
  output: string;
}> {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  const out: Array<{
    tool: string;
    input: Record<string, unknown>;
    output: string;
  }> = [];

  for (const part of parts) {
    if (!part || typeof part !== "object") continue;

    const type = String((part as any).type || "");
    const toolName = type.startsWith("tool-")
      ? type.slice("tool-".length)
      : type === "dynamic-tool"
        ? String((part as any).toolName || "")
        : "";
    if (!toolName) continue;

    const rawInput =
      (part as any).input ??
      (part as any).rawInput ??
      (part as any).arguments ??
      undefined;
    const input: Record<string, unknown> =
      rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
        ? (rawInput as Record<string, unknown>)
        : { value: rawInput };

    const state = String((part as any).state || "");
    const outputObj =
      state === "output-available"
        ? (part as any).output
        : state === "output-error"
          ? { error: (part as any).errorText ?? "tool_error" }
          : state === "output-denied"
            ? { error: "tool_denied", reason: (part as any)?.approval?.reason }
            : undefined;
    const output = outputObj === undefined ? "" : JSON.stringify(outputObj);

    out.push({
      tool: toolName,
      input,
      output,
    });
  }

  return out;
}
