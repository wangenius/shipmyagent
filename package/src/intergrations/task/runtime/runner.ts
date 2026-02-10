/**
 * Task runner.
 *
 * 职责（中文）
 * - 创建 run 目录（timestamp）
 * - 以“干净历史”调用当前 runtime 的 Agent（逻辑与正常 chat 一致）
 * - 把执行过程与结果写入 run 目录（history.jsonl / output.md / result.md / error.md）
 * - 执行结束后向 task.frontmatter.chatKey 推送一条结果消息（成功/失败都会发）
 */

import fs from "fs-extra";
import path from "node:path";
import { withChatRequestContext } from "../../../core/runtime/request-context.js";
import { getShipRuntimeContext } from "../../../server/ShipRuntimeContext.js";
import type { ShipTaskRunMetaV1, ShipTaskRunTriggerV1 } from "../../../types/task.js";
import { pickLastSuccessfulChatSendText } from "../../chat/runtime/user-visible-text.js";
import { createTaskRunChatKey, formatTaskRunTimestamp, getTaskRunDir } from "./paths.js";
import { ensureRunDir, readTask } from "./store.js";
import { sendTextByChatKey } from "../../chat/runtime/chatkey-send.js";

function toMdLink(relPath: string): string {
  const p = String(relPath || "").trim();
  return p ? `\`${p}\`` : "";
}

function summarizeText(text: string, maxChars: number): string {
  const t = String(text ?? "").trim();
  if (!t) return "";
  if (t.length <= maxChars) return t;
  return t.slice(0, Math.max(0, maxChars - 3)).trimEnd() + "...";
}

export async function runTaskNow(params: {
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
  const runtime = getShipRuntimeContext();
  const root = String(params.projectRoot || runtime.rootPath || "").trim();
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

  const runChatKey = createTaskRunChatKey(task.taskId, timestamp);

  let ok = false;
  let status: "success" | "failure" | "skipped" = "failure";
  let outputText = "";
  let errorText = "";

  try {
    const agent = runtime.chatRuntime.getAgent(runChatKey);

    // 关键点（中文）：以 scheduler channel 运行，但使用 task-run chatKey 让 history 落盘到 runDir。
    const result = await withChatRequestContext(
      {
        channel: "scheduler",
        chatId: task.taskId,
        chatKey: runChatKey,
        userId: "scheduler",
        username: "scheduler",
      },
      () =>
        agent.run({
          chatKey: runChatKey,
          query: task.body,
        }),
    );

    outputText = String((result as any)?.output || "");

    // 落盘 assistant UIMessage（包含 tool parts），以便 history.jsonl 可审计。
    try {
      const store = runtime.chatRuntime.getHistoryStore(runChatKey);
      const assistantMessage = (result as any)?.assistantMessage;
      if (assistantMessage && typeof assistantMessage === "object") {
        await store.append(assistantMessage as any);
      } else {
        const userVisible =
          pickLastSuccessfulChatSendText((result as any)?.toolCalls || []) ||
          String((result as any)?.output || "");
        if (userVisible && userVisible.trim()) {
          await store.append(
            store.createAssistantTextMessage({
              text: userVisible,
              metadata: {
                chatKey: runChatKey,
                channel: "scheduler",
                chatId: task.taskId,
                userId: "bot",
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
  resultLines.push(`- history: ${toMdLink(path.posix.join(runDirRel, "history.jsonl"))}`);
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

  // 通知 chatKey：成功/失败都发
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
    const send = await sendTextByChatKey({
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

