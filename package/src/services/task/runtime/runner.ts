/**
 * Task runner.
 *
 * 职责（中文）
 * - 创建 run 目录（timestamp）
 * - 以“干净历史”调用当前 runtime 的 Agent（逻辑与正常 chat 一致）
 * - 把执行过程与结果写入 run 目录（messages.jsonl / output.md / result.md / error.md）
 * - 执行结束后向 task.frontmatter.contextId 推送一条结果消息（成功/失败都会发）
 */

import fs from "fs-extra";
import path from "node:path";
import {
  getServiceChatRuntimeBridge,
  getServiceRequestContextBridge,
  getServiceContextManager,
} from "../../../process/runtime/ServiceRuntimeDependencies.js";
import type { ServiceRuntimeDependencies } from "../../../process/runtime/types/ServiceRuntimeTypes.js";
import type {
  ShipTaskFrontmatterV1,
  ShipTaskRunExecutionStatusV1,
  ShipTaskRunMetaV1,
  ShipTaskRunResultStatusV1,
  ShipTaskRunStatusV1,
  ShipTaskRunTriggerV1,
} from "../types/Task.js";
import type { AgentResult } from "../../../core/types/Agent.js";
import type { JsonObject } from "../../../types/Json.js";
import { createTaskRunContextId, formatTaskRunTimestamp, getTaskRunDir } from "./Paths.js";
import { ensureRunDir, readTask } from "./Store.js";

/**
 * 把相对路径渲染为 markdown 行内链接文本。
 */
function toMdLink(relPath: string): string {
  const p = String(relPath || "").trim();
  return p ? `\`${p}\`` : "";
}

/**
 * 文本摘要裁剪。
 *
 * 关键点（中文）
 * - 用于 result.md/error 通知，避免写入超长原文。
 */
function summarizeText(text: string, maxChars: number): string {
  const t = String(text ?? "").trim();
  if (!t) return "";
  if (t.length <= maxChars) return t;
  return t.slice(0, Math.max(0, maxChars - 3)).trimEnd() + "...";
}

type TaskResultValidation = {
  resultStatus: ShipTaskRunResultStatusV1;
  errors: string[];
};

type UserSimulatorDecision = {
  satisfied: boolean;
  reply: string;
  reason: string;
  score?: number;
  raw: string;
};

type DialogueRoundRecord = {
  round: number;
  executorOutput: string;
  ruleErrors: string[];
  userSimulator: UserSimulatorDecision;
};

const DEFAULT_MAX_DIALOGUE_ROUNDS = 3;

/**
 * 从文本中提取 JSON 对象（支持 ```json 代码块）。
 */
function tryExtractJsonObject(text: string): JsonObject | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;

  const tryParse = (s: string): JsonObject | null => {
    try {
      const parsed = JSON.parse(s);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as JsonObject;
      }
      return null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(raw);
  if (direct) return direct;

  const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    const parsed = tryParse(fenced[1].trim());
    if (parsed) return parsed;
  }

  const loose = raw.match(/\{[\s\S]*\}/);
  if (loose?.[0]) {
    const parsed = tryParse(loose[0]);
    if (parsed) return parsed;
  }

  return null;
}

/**
 * 解析模拟用户 agent 的判定结果。
 *
 * 关键点（中文）
 * - 优先 JSON 协议
 * - JSON 失败时使用保守启发式，默认不满意
 */
function parseUserSimulatorDecision(outputText: string): UserSimulatorDecision {
  const raw = String(outputText ?? "").trim();
  const obj = tryExtractJsonObject(raw);
  if (obj) {
    const satisfiedRaw = obj.satisfied;
    const satisfied =
      satisfiedRaw === true ||
      (typeof satisfiedRaw === "string" && satisfiedRaw.trim().toLowerCase() === "true");
    const reply = String(obj.reply ?? "").trim();
    const reason = String(obj.reason ?? "").trim();
    const scoreRaw = obj.score;
    const score =
      typeof scoreRaw === "number"
        ? scoreRaw
        : typeof scoreRaw === "string" && /^(\d+)(\.\d+)?$/.test(scoreRaw.trim())
          ? Number(scoreRaw)
          : undefined;
    const normalizedScore =
      typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 10
        ? score
        : undefined;
    return {
      satisfied,
      reply,
      reason,
      ...(typeof normalizedScore === "number" ? { score: normalizedScore } : {}),
      raw,
    };
  }

  const lower = raw.toLowerCase();
  const likelySatisfied =
    (lower.includes("satisfied") || lower.includes("满意") || lower.includes("通过")) &&
    !lower.includes("not satisfied") &&
    !lower.includes("不满意");

  return {
    satisfied: likelySatisfied,
    reply: raw,
    reason: likelySatisfied ? "heuristic satisfied" : "heuristic not satisfied",
    raw,
  };
}

/**
 * 构造执行 agent 的轮次输入。
 */
function buildExecutorRoundQuery(params: {
  taskBody: string;
  round: number;
  lastOutputText?: string;
  lastFeedback?: string;
}): string {
  if (params.round <= 1) return params.taskBody;
  return [
    "# 任务目标（保持不变）",
    "",
    params.taskBody || "_(empty body)_",
    "",
    `# 这是第 ${params.round} 轮执行`,
    "",
    "请根据以下“模拟用户反馈”和“上一轮输出”进行修订，并给出新的完整结果。",
    "",
    "## 模拟用户反馈",
    "",
    params.lastFeedback ? params.lastFeedback : "_(no feedback)_",
    "",
    "## 上一轮输出",
    "",
    params.lastOutputText ? params.lastOutputText : "_(empty output)_",
    "",
  ].join("\n");
}

/**
 * 构造模拟用户 agent 的判定输入。
 */
function buildUserSimulatorQuery(params: {
  taskTitle: string;
  taskDescription: string;
  taskBody: string;
  round: number;
  maxRounds: number;
  executorOutputText: string;
  ruleErrors: string[];
}): string {
  const ruleSection =
    params.ruleErrors.length > 0
      ? params.ruleErrors.map((x) => `- ${x}`).join("\n")
      : "- (none)";
  return [
    "你是一个“模拟用户”Agent。你要根据任务目标审阅执行结果，并给出用户回复。",
    "",
    "请严格输出 JSON 对象（不要输出 markdown）：",
    '{"satisfied": boolean, "reply": string, "reason": string, "score": number}',
    "",
    "规则：",
    "1) 如果结果还不满足目标，satisfied 必须是 false，reply 要像用户一样明确提出修改要求。",
    "2) 如果已经满足，satisfied=true，reply 给简短确认。",
    "3) score 范围 0-10。",
    "4) 如果系统规则校验有失败项（见下方），必须判定为不满意。",
    "",
    `任务标题: ${params.taskTitle}`,
    `任务描述: ${params.taskDescription}`,
    `当前轮次: ${params.round}/${params.maxRounds}`,
    "",
    "任务正文：",
    params.taskBody || "_(empty body)_",
    "",
    "系统规则校验失败项：",
    ruleSection,
    "",
    "执行 Agent 本轮输出：",
    params.executorOutputText || "_(empty output)_",
    "",
  ].join("\n");
}

/**
 * 执行一轮 agent.run。
 */
async function runAgentRound(params: {
  context: ServiceRuntimeDependencies;
  contextId: string;
  taskId: string;
  query: string;
  actorId: string;
  actorName: string;
}): Promise<{ outputText: string; rawResult: AgentResult }> {
  const agent = getServiceContextManager(params.context).getAgent(params.contextId);
  const result = await getServiceRequestContextBridge(params.context).withContextRequestContext(
    {
      channel: "scheduler",
      targetId: params.taskId,
      contextId: params.contextId,
      actorId: params.actorId,
      actorName: params.actorName,
    },
    () =>
      agent.run({
        contextId: params.contextId,
        query: params.query,
      }),
  );
  return {
    outputText: String(result.output || ""),
    rawResult: result,
  };
}

/**
 * 把 executor 的 assistant 消息落盘到 run context store。
 */
async function appendExecutorAssistantMessage(params: {
  context: ServiceRuntimeDependencies;
  runContextId: string;
  taskId: string;
  rawResult: AgentResult;
}): Promise<void> {
  const store = getServiceContextManager(params.context).getContextStore(params.runContextId);
  const assistantMessage = params.rawResult?.assistantMessage;
  if (assistantMessage && typeof assistantMessage === "object") {
    await store.append(assistantMessage);
    return;
  }

  const userVisible =
    getServiceChatRuntimeBridge(params.context).pickLastSuccessfulChatSendText(
      params.rawResult?.toolCalls || [],
    ) || String(params.rawResult?.output || "");
  if (userVisible && userVisible.trim()) {
    await store.append(
      store.createAssistantTextMessage({
        text: userVisible,
        metadata: {
          contextId: params.runContextId,
          channel: "scheduler",
          targetId: params.taskId,
          actorId: "bot",
          extra: {
            via: "task_runner",
            note: "assistant_message_missing",
            contextId: params.runContextId,
          },
        },
        kind: "normal",
        source: "egress",
      }),
    );
  }
}

/**
 * 校验任务结果是否满足“必须有结果”的规则。
 *
 * 关键点（中文）
 * - 默认要求输出至少 1 个字符；可通过 `minOutputChars: 0` 显式允许空输出
 * - 可通过 `requiredArtifacts` 强约束 run 目录必须产出指定文件
 */
async function validateTaskResult(params: {
  frontmatter: ShipTaskFrontmatterV1;
  runDirAbs: string;
  outputText: string;
  plannedArtifacts?: Set<string>;
}): Promise<TaskResultValidation> {
  const errors: string[] = [];
  const frontmatter = params.frontmatter;

  const minOutputChars =
    typeof frontmatter.minOutputChars === "number" && Number.isInteger(frontmatter.minOutputChars)
      ? frontmatter.minOutputChars
      : 1;

  const outputChars = String(params.outputText ?? "").trim().length;
  if (outputChars < minOutputChars) {
    errors.push(`output too short: got ${outputChars}, expected >= ${minOutputChars}`);
  }

  const requiredArtifacts = Array.isArray(frontmatter.requiredArtifacts)
    ? frontmatter.requiredArtifacts
    : [];
  for (const artifact of requiredArtifacts) {
    const rel = String(artifact || "").trim();
    if (!rel) continue;
    if (params.plannedArtifacts?.has(rel)) {
      // 关键点（中文）：runner 自身会在本次 run 中生成的产物，视为“将满足”。
      continue;
    }
    const abs = path.join(params.runDirAbs, rel);
    const exists = await fs.pathExists(abs);
    if (!exists) {
      errors.push(`missing artifact: ${rel}`);
    }
  }

  if (errors.length > 0) {
    return {
      resultStatus: "invalid",
      errors,
    };
  }

  return {
    resultStatus: "valid",
    errors: [],
  };
}

/**
 * 立即执行任务定义。
 *
 * 算法流程（中文）
 * 1) 解析 task + 创建 run 目录
 * 2) 在 scheduler 上下文里执行 agent
 * 3) 产物落盘（input/output/result/error/run.json）
 * 4) 向 contextId 发送执行通知（成功/失败都通知）
 *
 * 返回值（中文）
 * - `ok`/`status`：任务执行结果。
 * - `runDir`/`runDirRel`：执行产物目录。
 * - `notified`/`notifyError`：回传 chat 通知状态。
 */
export async function runTaskNow(params: {
  context: ServiceRuntimeDependencies;
  taskId: string;
  trigger: ShipTaskRunTriggerV1;
  projectRoot?: string;
}): Promise<{
  ok: boolean;
  status: ShipTaskRunStatusV1;
  executionStatus: ShipTaskRunExecutionStatusV1;
  resultStatus: ShipTaskRunResultStatusV1;
  resultErrors: string[];
  dialogueRounds: number;
  userSimulatorSatisfied: boolean;
  userSimulatorReply?: string;
  userSimulatorReason?: string;
  userSimulatorScore?: number;
  taskId: string;
  timestamp: string;
  runDir: string;
  runDirRel: string;
  notified: boolean;
  notifyError?: string;
}> {
  const context = params.context;
  const root = String(params.projectRoot || context.rootPath || "").trim();
  if (!root) throw new Error("projectRoot is required");

  const startedAt = Date.now();
  const timestamp = formatTaskRunTimestamp(new Date(startedAt));

  const task = await readTask({ taskId: params.taskId, projectRoot: root });
  const runDirAbs = getTaskRunDir(root, task.taskId, timestamp);
  const runDirRel = path.relative(root, runDirAbs).split(path.sep).join("/");

  await ensureRunDir({ taskId: task.taskId, timestamp, projectRoot: root });

  const inputMdPath = path.join(runDirAbs, "input.md");
  const outputMdPath = path.join(runDirAbs, "output.md");
  const resultMdPath = path.join(runDirAbs, "result.md");
  const errorMdPath = path.join(runDirAbs, "error.md");
  const dialogueMdPath = path.join(runDirAbs, "dialogue.md");
  const dialogueJsonPath = path.join(runDirAbs, "dialogue.json");
  const metaJsonPath = path.join(runDirAbs, "run.json");
  const maxDialogueRounds =
    typeof task.frontmatter.maxDialogueRounds === "number" &&
    Number.isInteger(task.frontmatter.maxDialogueRounds) &&
    task.frontmatter.maxDialogueRounds > 0
      ? task.frontmatter.maxDialogueRounds
      : DEFAULT_MAX_DIALOGUE_ROUNDS;

  // input.md：把 frontmatter 摘要 + 正文快照写入 run 目录，方便审计。
  await fs.writeFile(
    inputMdPath,
    [
      `# Task Input`,
      ``,
      `- taskId: \`${task.taskId}\``,
      `- title: ${task.frontmatter.title}`,
      `- cron: \`${task.frontmatter.cron}\``,
      `- status: \`${task.frontmatter.status}\``,
      `- contextId: \`${task.frontmatter.contextId}\``,
      task.frontmatter.timezone ? `- timezone: \`${task.frontmatter.timezone}\`` : null,
      Array.isArray(task.frontmatter.requiredArtifacts) && task.frontmatter.requiredArtifacts.length > 0
        ? `- requiredArtifacts: \`${task.frontmatter.requiredArtifacts.join(", ")}\``
        : null,
      typeof task.frontmatter.minOutputChars === "number"
        ? `- minOutputChars: \`${task.frontmatter.minOutputChars}\``
        : null,
      `- maxDialogueRounds: \`${maxDialogueRounds}\``,
      ``,
      `## Body`,
      ``,
      task.body ? task.body : "_(empty body)_",
      ``,
    ]
      .filter((x) => x !== null)
      .join("\n"),
    "utf-8",
  );

  const runContextId = createTaskRunContextId(task.taskId, timestamp);
  const userSimulatorContextId = `task-user-sim:${task.taskId}:${timestamp}`;

  let ok = false;
  let status: ShipTaskRunStatusV1 = "failure";
  let executionStatus: ShipTaskRunExecutionStatusV1 = "failure";
  let resultStatus: ShipTaskRunResultStatusV1 = "not_checked";
  let resultErrors: string[] = [];
  let dialogueRounds = 0;
  let userSimulatorSatisfied = false;
  let userSimulatorReply = "";
  let userSimulatorReason = "";
  let userSimulatorScore: number | undefined;
  let outputText = "";
  let errorText = "";
  const dialogueRecords: DialogueRoundRecord[] = [];

  // phase 1：双 agent 多轮对话（executor <-> user-simulator）
  // 关键点（中文）：直到“规则校验通过 + 模拟用户满意”或达到最大轮数。
  let lastRoundRuleErrors: string[] = [];
  let lastRoundDecision: UserSimulatorDecision | null = null;
  let lastFeedback = "";
  executionStatus = "success";

  for (let round = 1; round <= maxDialogueRounds; round++) {
    dialogueRounds = round;
    let executorRoundOutput = "";

    try {
      const executorQuery = buildExecutorRoundQuery({
        taskBody: task.body,
        round,
        ...(outputText ? { lastOutputText: outputText } : {}),
        ...(lastFeedback ? { lastFeedback } : {}),
      });
      const executorRound = await runAgentRound({
        context,
        contextId: runContextId,
        taskId: task.taskId,
        query: executorQuery,
        actorId: "scheduler",
        actorName: "scheduler",
      });
      executorRoundOutput = executorRound.outputText;
      outputText = executorRound.outputText;

      // executor assistant 消息写入 runDir 对应的 context store（messages.jsonl）。
      try {
        await appendExecutorAssistantMessage({
          context,
          runContextId,
          taskId: task.taskId,
          rawResult: executorRound.rawResult,
        });
      } catch {
        // ignore
      }
    } catch (e) {
      executionStatus = "failure";
      errorText = `Executor agent failed at round ${round}: ${String(e)}`;
      break;
    }

    const plannedArtifacts = new Set<string>([
      "input.md",
      "output.md",
      "result.md",
      "run.json",
      "dialogue.md",
      "dialogue.json",
    ]);
    const validation = await validateTaskResult({
      frontmatter: task.frontmatter,
      runDirAbs,
      outputText: executorRoundOutput,
      plannedArtifacts,
    });
    lastRoundRuleErrors = [...validation.errors];

    let decision: UserSimulatorDecision = {
      satisfied: false,
      reply: "",
      reason: "user simulator did not run",
      raw: "",
    };
    try {
      const simulatorQuery = buildUserSimulatorQuery({
        taskTitle: task.frontmatter.title,
        taskDescription: task.frontmatter.description,
        taskBody: task.body,
        round,
        maxRounds: maxDialogueRounds,
        executorOutputText: executorRoundOutput,
        ruleErrors: validation.errors,
      });
      const simulatorRound = await runAgentRound({
        context,
        contextId: userSimulatorContextId,
        taskId: task.taskId,
        query: simulatorQuery,
        actorId: "user_simulator",
        actorName: "user_simulator",
      });
      decision = parseUserSimulatorDecision(simulatorRound.outputText);
    } catch (e) {
      decision = {
        satisfied: false,
        reply: "",
        reason: `user simulator failed: ${String(e)}`,
        raw: String(e),
      };
    }

    // 关键点（中文）：系统规则校验失败时，强制判定不满意。
    const roundSatisfied = decision.satisfied && validation.errors.length === 0;
    userSimulatorSatisfied = roundSatisfied;
    userSimulatorReply = decision.reply;
    userSimulatorReason = decision.reason;
    userSimulatorScore = decision.score;
    lastRoundDecision = decision;

    dialogueRecords.push({
      round,
      executorOutput: executorRoundOutput,
      ruleErrors: [...validation.errors],
      userSimulator: {
        ...decision,
        satisfied: roundSatisfied,
      },
    });

    if (roundSatisfied) {
      ok = true;
      status = "success";
      resultStatus = "valid";
      resultErrors = [];
      break;
    }

    const feedbackLines: string[] = [];
    if (validation.errors.length > 0) {
      feedbackLines.push("系统规则校验失败：");
      for (const item of validation.errors) feedbackLines.push(`- ${item}`);
    }
    if (decision.reply) {
      feedbackLines.push("模拟用户回复：");
      feedbackLines.push(decision.reply);
    }
    if (decision.reason) {
      feedbackLines.push(`模拟用户理由：${decision.reason}`);
    }
    lastFeedback = feedbackLines.join("\n").trim();
  }

  if (!ok) {
    if (executionStatus === "failure") {
      status = "failure";
      resultStatus = "not_checked";
      resultErrors = [];
    } else {
      status = "failure";
      resultStatus = "invalid";
      resultErrors = [
        ...lastRoundRuleErrors,
        ...(lastRoundDecision?.reason
          ? [`user simulator unsatisfied: ${lastRoundDecision.reason}`]
          : ["user simulator unsatisfied"]),
        `max dialogue rounds reached: ${maxDialogueRounds}`,
      ];
      errorText = [
        "Task result not satisfied after dialogue rounds.",
        ...resultErrors.map((x) => `- ${x}`),
      ].join("\n");
    }
  }

  // phase 2：写入执行产物与元数据
  const endedAt = Date.now();
  const durationMs = endedAt - startedAt;

  // output.md
  await fs.writeFile(
    outputMdPath,
    [`# Task Output`, ``, outputText ? outputText : "_(empty output)_", ``].join(
      "\n",
    ),
    "utf-8",
  );

  if (status === "failure") {
    await fs.writeFile(
      errorMdPath,
      [`# Task Error`, ``, errorText || "Unknown error", ``].join("\n"),
      "utf-8",
    );
  } else {
    // 清理旧 error.md（如果存在）
    try {
      await fs.remove(errorMdPath);
    } catch {
      // ignore
    }
  }

  await fs.writeJson(
    dialogueJsonPath,
    {
      v: 1,
      taskId: task.taskId,
      timestamp,
      maxDialogueRounds,
      rounds: dialogueRecords,
    },
    { spaces: 2 },
  );

  const dialogueLines: string[] = [];
  dialogueLines.push("# Task Dialogue");
  dialogueLines.push("");
  dialogueLines.push(`- taskId: \`${task.taskId}\``);
  dialogueLines.push(`- maxDialogueRounds: \`${maxDialogueRounds}\``);
  dialogueLines.push(`- dialogueRounds: \`${dialogueRounds}\``);
  dialogueLines.push(`- userSimulatorSatisfied: \`${String(userSimulatorSatisfied)}\``);
  dialogueLines.push("");
  for (const round of dialogueRecords) {
    dialogueLines.push(`## Round ${round.round}`);
    dialogueLines.push("");
    dialogueLines.push("### Executor output preview");
    dialogueLines.push("");
    dialogueLines.push("```");
    dialogueLines.push(summarizeText(round.executorOutput, 1200) || "_(empty output)_");
    dialogueLines.push("```");
    dialogueLines.push("");
    dialogueLines.push("### Rule checks");
    dialogueLines.push("");
    if (round.ruleErrors.length === 0) {
      dialogueLines.push("- PASS");
    } else {
      for (const item of round.ruleErrors) dialogueLines.push(`- FAIL: ${item}`);
    }
    dialogueLines.push("");
    dialogueLines.push("### User simulator");
    dialogueLines.push("");
    dialogueLines.push(`- satisfied: \`${String(round.userSimulator.satisfied)}\``);
    if (typeof round.userSimulator.score === "number") {
      dialogueLines.push(`- score: \`${round.userSimulator.score}\``);
    }
    if (round.userSimulator.reason) {
      dialogueLines.push(`- reason: ${round.userSimulator.reason}`);
    }
    if (round.userSimulator.reply) {
      dialogueLines.push("");
      dialogueLines.push("reply:");
      dialogueLines.push("```");
      dialogueLines.push(summarizeText(round.userSimulator.reply, 1200));
      dialogueLines.push("```");
    }
    dialogueLines.push("");
  }
  await fs.writeFile(dialogueMdPath, dialogueLines.join("\n"), "utf-8");

  const meta: ShipTaskRunMetaV1 = {
    v: 1,
    taskId: task.taskId,
    timestamp,
    contextId: task.frontmatter.contextId,
    trigger: params.trigger,
    status,
    executionStatus,
    resultStatus,
    ...(resultErrors.length > 0 ? { resultErrors } : {}),
    dialogueRounds,
    userSimulatorSatisfied,
    ...(userSimulatorReply ? { userSimulatorReply: summarizeText(userSimulatorReply, 2000) } : {}),
    ...(userSimulatorReason ? { userSimulatorReason: summarizeText(userSimulatorReason, 2000) } : {}),
    ...(typeof userSimulatorScore === "number" ? { userSimulatorScore } : {}),
    startedAt,
    endedAt,
    ...(status === "failure" && errorText ? { error: summarizeText(errorText, 800) } : {}),
  };
  await fs.writeJson(metaJsonPath, meta, { spaces: 2 });

  // result.md：面向人类的摘要
  const outputPreview = summarizeText(outputText, 1200);
  const resultLines: string[] = [];
  resultLines.push(`# Task Result`);
  resultLines.push("");
  resultLines.push(`- taskId: \`${task.taskId}\``);
  resultLines.push(`- title: ${task.frontmatter.title}`);
  resultLines.push(`- trigger: \`${params.trigger.type}\``);
  resultLines.push(`- status: **${status.toUpperCase()}**`);
  resultLines.push(`- executionStatus: \`${executionStatus}\``);
  resultLines.push(`- resultStatus: \`${resultStatus}\``);
  resultLines.push(`- dialogueRounds: \`${dialogueRounds}/${maxDialogueRounds}\``);
  resultLines.push(`- userSimulatorSatisfied: \`${String(userSimulatorSatisfied)}\``);
  if (typeof userSimulatorScore === "number") {
    resultLines.push(`- userSimulatorScore: \`${userSimulatorScore}\``);
  }
  resultLines.push(`- startedAt: \`${new Date(startedAt).toISOString()}\``);
  resultLines.push(`- endedAt: \`${new Date(endedAt).toISOString()}\``);
  resultLines.push(`- durationMs: \`${durationMs}\``);
  resultLines.push(`- runDir: ${toMdLink(runDirRel)}`);
  resultLines.push("");
  resultLines.push(`## Artifacts`);
  resultLines.push("");
  resultLines.push(`- messages: ${toMdLink(path.posix.join(runDirRel, "messages.jsonl"))}`);
  resultLines.push(`- input: ${toMdLink(path.posix.join(runDirRel, "input.md"))}`);
  resultLines.push(`- output: ${toMdLink(path.posix.join(runDirRel, "output.md"))}`);
  resultLines.push(`- result: ${toMdLink(path.posix.join(runDirRel, "result.md"))}`);
  resultLines.push(`- dialogue: ${toMdLink(path.posix.join(runDirRel, "dialogue.md"))}`);
  resultLines.push(`- dialogueJson: ${toMdLink(path.posix.join(runDirRel, "dialogue.json"))}`);
  if (status === "failure") {
    resultLines.push(`- error: ${toMdLink(path.posix.join(runDirRel, "error.md"))}`);
  }
  resultLines.push("");

  resultLines.push(`## Result checks`);
  resultLines.push("");
  if (resultErrors.length === 0) {
    resultLines.push(`- PASS`);
  } else {
    for (const item of resultErrors) {
      resultLines.push(`- FAIL: ${item}`);
    }
  }
  resultLines.push("");

  if (outputPreview) {
    resultLines.push(`## Output preview`);
    resultLines.push("");
    resultLines.push("```");
    resultLines.push(outputPreview);
    resultLines.push("```");
    resultLines.push("");
  }

  if (status === "failure" && errorText) {
    resultLines.push(`## Error preview`);
    resultLines.push("");
    resultLines.push("```");
    resultLines.push(summarizeText(errorText, 1200));
    resultLines.push("```");
    resultLines.push("");
  }

  await fs.writeFile(resultMdPath, resultLines.join("\n"), "utf-8");

  // phase 3：通知 contextId（成功/失败都发，便于可观测）
  // 通知策略（中文）：通知失败不影响任务主状态，只记录 `notifyError` 供排查。
  let notified = false;
  let notifyError: string | undefined;
  try {
    const textLines: string[] = [];
    textLines.push(`[Task] ${task.frontmatter.title}`);
    textLines.push(`taskId: ${task.taskId}`);
    textLines.push(`status: ${status}`);
    textLines.push(`executionStatus: ${executionStatus}`);
    textLines.push(`resultStatus: ${resultStatus}`);
    textLines.push(`dialogueRounds: ${dialogueRounds}/${maxDialogueRounds}`);
    textLines.push(`userSimulatorSatisfied: ${String(userSimulatorSatisfied)}`);
    textLines.push(`run: ${runDirRel}`);
    textLines.push(`result: ${path.posix.join(runDirRel, "result.md")}`);
    textLines.push(`dialogue: ${path.posix.join(runDirRel, "dialogue.md")}`);
    if (resultErrors.length > 0) {
      textLines.push("");
      textLines.push(`resultChecks:`);
      for (const item of resultErrors.slice(0, 10)) {
        textLines.push(`- ${item}`);
      }
    }
    if (status === "failure" && errorText) {
      textLines.push("");
      textLines.push(`error: ${summarizeText(errorText, 500)}`);
    }
    const send = await getServiceChatRuntimeBridge(context).sendTextByContextId({
      contextId: task.frontmatter.contextId,
      text: textLines.join("\n"),
    });
    if (!send.success) {
      notified = false;
      notifyError = String(send.error || "chat send failed");
    } else {
      notified = true;
    }
  } catch (e) {
    notified = false;
    notifyError = String(e);
  }

  return {
    ok,
    status,
    executionStatus,
    resultStatus,
    resultErrors,
    dialogueRounds,
    userSimulatorSatisfied,
    ...(userSimulatorReply ? { userSimulatorReply } : {}),
    ...(userSimulatorReason ? { userSimulatorReason } : {}),
    ...(typeof userSimulatorScore === "number" ? { userSimulatorScore } : {}),
    taskId: task.taskId,
    timestamp,
    runDir: runDirAbs,
    runDirRel,
    notified,
    ...(notifyError ? { notifyError } : {}),
  };
}
