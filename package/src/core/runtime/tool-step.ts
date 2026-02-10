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
  meta: { requestId?: string; sessionId: string },
): Promise<void> {
  for (const tr of step?.toolResults || []) {
    if (tr?.type !== "tool-result") continue;
    const toolName = (tr as any).toolName;

    if (toolName === "exec_command" || toolName === "write_stdin" || toolName === "close_session") {
      const output = ((tr as any).output as any) || {};
      const command =
        toolName === "exec_command"
          ? String(((tr as any).input as any)?.cmd || "").trim()
          : "";
      const sessionId =
        output?.process_id ??
        output?.session_id ??
        ((tr as any).input as any)?.session_id;
      const exitCode = output?.exit_code;
      const pageOutput = String(output?.output || "").trim();
      const note = String(output?.note || "").trim();
      const snippet = (pageOutput || note).slice(0, 500);

      const title =
        toolName === "exec_command"
          ? `已启动命令会话：${command}${sessionId ? `（session_id=${sessionId}）` : ""}`
          : toolName === "write_stdin"
            ? `已轮询命令会话：${sessionId ? `session_id=${sessionId}` : "(unknown)"}`
            : `已关闭命令会话：${sessionId ? `session_id=${sessionId}` : "(unknown)"}`;

      await emitStep(
        "step_finish",
        `${title}${typeof exitCode === "number" ? `（exitCode=${exitCode}）` : ""}${snippet ? `\n摘要：${snippet}${(pageOutput || note).length > 500 ? "…" : ""}` : ""}`,
        {
          toolName,
          ...(command ? { command } : {}),
          ...(sessionId ? { sessionId } : {}),
          exitCode: typeof exitCode === "number" ? exitCode : undefined,
          requestId: meta.requestId,
          sessionId: meta.sessionId,
        },
      );
    } else if (toolName && String(toolName).includes(":")) {
      const output = ((tr as any).output as any)?.output || "";
      const snippet = String(output).slice(0, 500);
      await emitStep(
        "step_finish",
        `已执行 MCP 工具：${toolName}${snippet ? `\n结果：${snippet}${String(output).length > 500 ? "…" : ""}` : ""}`,
        { toolName, requestId: meta.requestId, sessionId: meta.sessionId },
      );
    }
  }
}
