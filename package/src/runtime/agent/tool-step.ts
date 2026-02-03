export function extractUserFacingTextFromStep(step: any): string {
  const normalize = (s: string): string =>
    s
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  const extractUserFacingTextFromContent = (content: any): string => {
    const parts: string[] = [];
    if (typeof content === "string") {
      if (content.trim()) parts.push(content.trim());
      return parts.join("\n");
    }
    if (Array.isArray(content)) {
      for (const p of content) {
        if (!p || typeof p !== "object") continue;
        const type = String((p as any).type || "");
        if (type === "text" || type === "input_text") {
          const t = String((p as any).text ?? "").trim();
          if (t) parts.push(t);
        }
      }
      return parts.join("\n").trim();
    }
    return "";
  };

  const candidates: string[] = [];
  const stepText = typeof step?.text === "string" ? normalize(step.text) : "";
  if (stepText) candidates.push(stepText);

  const contentTextRaw = extractUserFacingTextFromContent(step?.content);
  const contentText = contentTextRaw ? normalize(contentTextRaw) : "";
  if (contentText) candidates.push(contentText);

  const msgs = Array.isArray(step?.messages) ? step.messages : [];
  for (const m of msgs) {
    if (!m || typeof m !== "object") continue;
    const role = String((m as any).role || "");
    if (role !== "assistant") continue;
    const t = extractUserFacingTextFromContent((m as any).content);
    const tt = t ? normalize(t) : "";
    if (tt) candidates.push(tt);
  }

  const out = candidates.find(Boolean) || "";
  return out.trim();
}

export async function emitToolSummariesFromStep(
  step: any,
  emitStep: (type: string, text: string, data?: Record<string, unknown>) => Promise<void>,
  meta: { requestId?: string; chatKey: string },
): Promise<void> {
  for (const tr of step?.toolResults || []) {
    if (tr?.type !== "tool-result") continue;
    const toolName = (tr as any).toolName;

    if (toolName === "exec_shell") {
      const command = String(((tr as any).input as any)?.command || "").trim();
      const exitCode = ((tr as any).output as any)?.exitCode;
      const stdout = String(((tr as any).output as any)?.stdout || "").trim();
      const stderr = String(((tr as any).output as any)?.stderr || "").trim();
      const snippet = (stdout || stderr).slice(0, 500);
      await emitStep(
        "step_finish",
        `已执行：${command}${typeof exitCode === "number" ? `（exitCode=${exitCode}）` : ""}${snippet ? `\n摘要：${snippet}${(stdout || stderr).length > 500 ? "…" : ""}` : ""}`,
        {
          toolName: "exec_shell",
          command,
          exitCode: typeof exitCode === "number" ? exitCode : undefined,
          requestId: meta.requestId,
          chatKey: meta.chatKey,
        },
      );
    } else if (toolName && String(toolName).includes(":")) {
      const output = ((tr as any).output as any)?.output || "";
      const snippet = String(output).slice(0, 500);
      await emitStep(
        "step_finish",
        `已执行 MCP 工具：${toolName}${snippet ? `\n结果：${snippet}${String(output).length > 500 ? "…" : ""}` : ""}`,
        { toolName, requestId: meta.requestId, chatKey: meta.chatKey },
      );
    }
  }
}
