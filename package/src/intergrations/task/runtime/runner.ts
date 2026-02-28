/**
 * Task runner.
 *
 * 职责（中文）
 * - 创建 run 目录（timestamp）
 * - 以“干净历史”调用当前 runtime 的 Agent（逻辑与正常 chat 一致）
 * - 把执行过程与结果写入 run 目录（messages.jsonl / output.md / result.md / error.md）
 * - 执行结束后向 task.frontmatter.chatKey 推送一条结果消息（成功/失败都会发）
 */

import fs from "fs-extra";
import path from "node:path";
import {
  getIntegrationChatRuntimeBridge,
  getIntegrationRequestContextBridge,
  getIntegrationContextManager,
} from "../../../infra/integration-runtime-dependencies.js";
import type { IntegrationRuntimeDependencies } from "../../../infra/integration-runtime-types.js";
import type { ShipTaskRunMetaV1, ShipTaskRunTriggerV1 } from "../types/task.js";
import { createTaskRunContextId, formatTaskRunTimestamp, getTaskRunDir } from "./paths.js";
import { ensureRunDir, readTask } from "./store.js";

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

/**
 * 立即执行任务定义。
 *
 * 算法流程（中文）
 * 1) 解析 task + 创建 run 目录
 * 2) 在 scheduler 上下文里执行 agent
 * 3) 产物落盘（input/output/result/error/run.json）
 * 4) 向 chatKey 发送执行通知（成功/失败都通知）
 *
 * 返回值（中文）
 * - `ok`/`status`：任务执行结果。
 * - `runDir`/`runDirRel`：执行产物目录。
 * - `notified`/`notifyError`：回传 chat 通知状态。
 */
export async function runTaskNow(params: {
  context: IntegrationRuntimeDependencies;
  taskId: string;
  trigger: ShipTaskRunTriggerV1;
  projectRoot?: string;
}): Promise<{
  ok: boolean;
  status: "success" | "failure" | "skipped";
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
  const metaJsonPath = path.join(runDirAbs, "run.json");

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
      `- chatKey: \`${task.frontmatter.chatKey}\``,
      task.frontmatter.timezone ? `- timezone: \`${task.frontmatter.timezone}\`` : null,
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

  let ok = false;
  let status: "success" | "failure" | "skipped" = "failure";
  let outputText = "";
  let errorText = "";

  // phase 1：执行任务主体（agent run）
  // 失败容错（中文）：即使 agent 执行失败，仍会继续落盘 result/error 并尝试通知 chatKey。
  try {
    const agent = getIntegrationContextManager(context).getAgent(runContextId);

    // 关键点（中文）：以 scheduler channel 运行，但使用 task-run chatKey 让 messages 落盘到 runDir。
    const result = await getIntegrationRequestContextBridge(context).withContextRequestContext(
      {
        channel: "scheduler",
        targetId: task.taskId,
        contextId: runContextId,
        actorId: "scheduler",
        actorName: "scheduler",
      },
      () =>
        agent.run({
          contextId: runContextId,
          query: task.body,
        }),
    );

    outputText = String((result as any)?.output || "");

    // 落盘 assistant UIMessage（包含 tool parts），以便 messages.jsonl 可审计。
    try {
      const store = getIntegrationContextManager(context).getContextStore(runContextId);
      const assistantMessage = (result as any)?.assistantMessage;
      if (assistantMessage && typeof assistantMessage === "object") {
        await store.append(assistantMessage as any);
      } else {
        const userVisible =
          getIntegrationChatRuntimeBridge(context).pickLastSuccessfulChatSendText(
            (result as any)?.toolCalls || [],
          ) || String((result as any)?.output || "");
        if (userVisible && userVisible.trim()) {
          await store.append(
            store.createAssistantTextMessage({
              text: userVisible,
              metadata: {
                chatKey: runContextId,
                channel: "scheduler",
                targetId: task.taskId,
                actorId: "bot",
                extra: { via: "task_runner", note: "assistant_message_missing" },
              } as any,
              kind: "normal",
              source: "egress",
            }),
          );
        }
      }
    } catch {
      // ignore
    }

    ok = true;
    status = "success";
  } catch (e) {
    ok = false;
    status = "failure";
    errorText = String(e);
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

  const meta: ShipTaskRunMetaV1 = {
    v: 1,
    taskId: task.taskId,
    timestamp,
    chatKey: task.frontmatter.chatKey,
    trigger: params.trigger,
    status,
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
  if (status === "failure") {
    resultLines.push(`- error: ${toMdLink(path.posix.join(runDirRel, "error.md"))}`);
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

  // phase 3：通知 chatKey（成功/失败都发，便于可观测）
  // 通知策略（中文）：通知失败不影响任务主状态，只记录 `notifyError` 供排查。
  let notified = false;
  let notifyError: string | undefined;
  try {
    const textLines: string[] = [];
    textLines.push(`[Task] ${task.frontmatter.title}`);
    textLines.push(`taskId: ${task.taskId}`);
    textLines.push(`status: ${status}`);
    textLines.push(`run: ${runDirRel}`);
    textLines.push(`result: ${path.posix.join(runDirRel, "result.md")}`);
    if (status === "failure" && errorText) {
      textLines.push("");
      textLines.push(`error: ${summarizeText(errorText, 500)}`);
    }
    const send = await getIntegrationChatRuntimeBridge(context).sendTextByChatKey({
      chatKey: task.frontmatter.chatKey,
      text: textLines.join("\n"),
    });
    if ((send as any)?.success === false) {
      notified = false;
      notifyError = String((send as any)?.error || "chat send failed");
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
    taskId: task.taskId,
    timestamp,
    runDir: runDirAbs,
    runDirRel,
    notified,
    ...(notifyError ? { notifyError } : {}),
  };
}
