import fs from "fs-extra";
import path from "path";
import type { ModelMessage, ToolApprovalResponse } from "ai";
import { generateText, type LanguageModel } from "ai";
import { withLlmRequestContext } from "../llm-logging/index.js";
import { getApprovalsDirPath, getTimestamp } from "../../utils.js";
import type { PermissionEngine } from "../permission/index.js";
import type { AgentInput, AgentResult, ApprovalDecisionResult } from "./types.js";

type ToolApprovalRequestPart = {
  type: "tool-approval-request";
  approvalId: string;
  toolCall: { toolName: string; input: unknown; toolCallId?: string };
};

export async function maybeCreatePendingApprovalFromToolLoopResult(input: {
  result: any;
  messagesSnapshot: ModelMessage[];
  toolCalls: AgentResult["toolCalls"];
  projectRoot: string;
  permissionEngine: PermissionEngine;
  sessionId: string;
  requestId: string;
  context?: AgentInput["context"];
}): Promise<AgentResult | null> {
  const approvalParts = ((input.result?.content || []) as any[]).filter(
    (p: any) => p && typeof p === "object" && p.type === "tool-approval-request",
  ) as ToolApprovalRequestPart[];

  if (approvalParts.length === 0) return null;

  const created: Array<{
    id: string;
    toolName: string;
    args: Record<string, unknown>;
    aiApprovalId: string;
  }> = [];

  for (const part of approvalParts) {
    const toolName = part.toolCall.toolName;
    const rawInput = (part.toolCall as any).input || {};
    const args =
      rawInput && typeof rawInput === "object"
        ? (rawInput as Record<string, unknown>)
        : {};

    let approvalId: string | undefined;
    let requiresApproval = false;

    if (toolName === "exec_shell") {
      const command = String((args as any).command || "").trim();
      const permission = await input.permissionEngine.checkExecShell(command);
      if (permission.requiresApproval && (permission as any).approvalId) {
        approvalId = String((permission as any).approvalId);
        requiresApproval = true;
      }
    } else if (toolName && String(toolName).includes(":")) {
      const approvalRequest = await input.permissionEngine.createGenericApprovalRequest({
        type: "mcp_tool",
        action: `Call MCP tool: ${toolName}`,
        details: { toolName, args },
        tool: toolName,
        input: args,
      });
      approvalId = approvalRequest.id;
      requiresApproval = true;
    }

    if (!requiresApproval || !approvalId) continue;

    await input.permissionEngine.updateApprovalRequest(approvalId, {
      tool: toolName,
      input: args,
      messages: [...input.messagesSnapshot] as unknown[],
      meta: {
        sessionId: input.sessionId,
        source: input.context?.source,
        userId: input.context?.userId,
        actorId: input.context?.actorId,
        initiatorId: input.context?.initiatorId ?? input.context?.actorId,
        requestId: input.requestId,
        aiApprovalId: part.approvalId,
        runId: input.context?.runId,
      },
    });

    created.push({
      id: approvalId,
      toolName,
      args,
      aiApprovalId: part.approvalId,
    });
  }

  if (created.length === 0) return null;

  const first = created[0];
  const description =
    first.toolName === "exec_shell"
      ? `Execute command: ${String((first.args as any)?.command || "")}`
      : `Call tool: ${first.toolName}`;

  const pendingText =
    `⏳ 需要你确认一下我接下来要做的操作（已发起审批请求）。\n` +
    `操作: ${description}\n\n` +
    `你可以直接用自然语言回复，比如：\n` +
    `- "可以" / "同意"\n` +
    `- "不可以，因为 …" / "拒绝，因为 …"\n` +
    `- "全部同意" / "全部拒绝"`;

  return {
    success: false,
    output: pendingText,
    toolCalls: input.toolCalls,
    pendingApproval: {
      id: first.id,
      type: first.toolName === "exec_shell" ? "exec_shell" : "other",
      description,
      data: {
        toolName: first.toolName,
        args: first.args,
        aiApprovalId: first.aiApprovalId,
      },
    },
  };
}

export async function decideApprovalsWithModel(input: {
  initialized: boolean;
  model: LanguageModel | null;
  userMessage: string;
  pendingApprovals: Array<{
    id: string;
    type: string;
    action: string;
    tool?: string;
    input?: unknown;
    details?: unknown;
  }>;
  ctx?: { sessionId?: string; requestId?: string };
}): Promise<ApprovalDecisionResult> {
  if (!input.initialized || !input.model) {
    return {
      pass: Object.fromEntries(input.pendingApprovals.map((a) => [a.id, ""])),
    };
  }

  const compactList = input.pendingApprovals.map((a) => ({
    id: a.id,
    type: a.type,
    action: a.action,
    tool: a.tool,
    input: a.input,
    details: a.details,
  }));

  const result = await withLlmRequestContext(
    { sessionId: input.ctx?.sessionId, requestId: input.ctx?.requestId },
    () =>
      generateText({
        model: input.model!,
        system: [
          "You are an approval-routing assistant.",
          "Given a user message and a list of pending approval requests, decide which approvals to approve, refuse, or pass.",
          "Return ONLY valid JSON with this exact structure:",
          '{ "approvals": { "<id>": "<any string>" }, "refused": { "<id>": "<reason>" }, "pass": { "<id>": "<any string>" } }',
          'If the user is ambiguous, put everything into "pass".',
        ].join("\n"),
        prompt: `User message:\n${input.userMessage}\n\nPending approvals:\n${JSON.stringify(compactList, null, 2)}\n\nReturn JSON only.`,
      }),
  );

  try {
    const parsed = JSON.parse((result.text || "").trim()) as ApprovalDecisionResult;
    return parsed && typeof parsed === "object"
      ? parsed
      : { pass: Object.fromEntries(input.pendingApprovals.map((a) => [a.id, ""])) };
  } catch {
    return {
      pass: Object.fromEntries(input.pendingApprovals.map((a) => [a.id, ""])),
    };
  }
}

export function filterRelevantApprovals(
  pending: any[],
  sessionId: string,
  context?: AgentInput["context"],
): any[] {
  return pending.filter((a: any) => {
    const metaSessionId = (a as any)?.meta?.sessionId;
    const metaUserId = (a as any)?.meta?.userId;
    if (metaSessionId && metaSessionId === sessionId) return true;
    if (!metaSessionId && metaUserId && context?.userId && metaUserId === context.userId)
      return true;
    return false;
  });
}

export async function loadBaseMessagesFromApprovals(input: {
  projectRoot: string;
  approvedIds: string[];
  refusedIds: string[];
  sessionMessagesSnapshot: ModelMessage[];
  coerceStoredMessagesToModelMessages: (messages: unknown[]) => ModelMessage[];
}): Promise<ModelMessage[]> {
  const approvalsDir = getApprovalsDirPath(input.projectRoot);
  const idsToTry = [...input.approvedIds, ...input.refusedIds];

  for (const id of idsToTry) {
    const file = path.join(approvalsDir, `${id}.json`);
    if (!fs.existsSync(file)) continue;
    try {
      const data = (await fs.readJson(file)) as any;
      if (Array.isArray(data?.messages)) {
        return input.coerceStoredMessagesToModelMessages(data.messages as unknown[]);
      }
    } catch {
      // ignore
    }
  }

  return [...input.sessionMessagesSnapshot];
}

export async function applyApprovalActionsAndBuildResponses(input: {
  projectRoot: string;
  permissionEngine: PermissionEngine;
  approvals: Record<string, string>;
  refused: Record<string, string>;
}): Promise<ToolApprovalResponse[]> {
  const approvalsDir = getApprovalsDirPath(input.projectRoot);
  const approvedIds = Object.keys(input.approvals);
  const refusedEntries = Object.entries(input.refused);

  const approvalResponses: ToolApprovalResponse[] = [];

  for (const approvalId of approvedIds) {
    const file = path.join(approvalsDir, `${approvalId}.json`);
    if (!fs.existsSync(file)) continue;
    try {
      const data = (await fs.readJson(file)) as any;
      const aiApprovalId = data?.meta?.aiApprovalId;
      if (!aiApprovalId) continue;
      approvalResponses.push({
        type: "tool-approval-response",
        approvalId: String(aiApprovalId),
        approved: true,
        reason: input.approvals[approvalId] || "Approved",
      });
    } catch {
      // ignore
    }
  }

  for (const [approvalId, reason] of refusedEntries) {
    const file = path.join(approvalsDir, `${approvalId}.json`);
    if (!fs.existsSync(file)) continue;
    try {
      const data = (await fs.readJson(file)) as any;
      const aiApprovalId = data?.meta?.aiApprovalId;
      if (!aiApprovalId) continue;
      approvalResponses.push({
        type: "tool-approval-response",
        approvalId: String(aiApprovalId),
        approved: false,
        reason: reason || "Rejected",
      });
    } catch {
      // ignore
    }
  }

  for (const approvalId of approvedIds) {
    await input.permissionEngine.updateApprovalRequest(approvalId, {
      status: "approved",
      respondedAt: getTimestamp(),
      response: input.approvals[approvalId] || "Approved",
    });
    await input.permissionEngine.deleteApprovalRequest(approvalId);
  }

  for (const [approvalId, reason] of refusedEntries) {
    await input.permissionEngine.updateApprovalRequest(approvalId, {
      status: "rejected",
      respondedAt: getTimestamp(),
      response: reason || "Rejected",
    });
    await input.permissionEngine.deleteApprovalRequest(approvalId);
  }

  return approvalResponses;
}
