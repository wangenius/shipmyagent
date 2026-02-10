/**
 * Chat module.
 *
 * 关键点（中文）
 * - CLI：`sma chat send/context`
 * - Server：`/api/chat/send`、`/api/chat/context`
 * - chatKey 解析优先级：`--chat-key` > `SMA_CTX_CHAT_KEY` > request context
 */

import path from "node:path";
import type { Command } from "commander";
import {
  resolveChatContextSnapshot,
  resolveChatKey,
  sendChatTextByChatKey,
} from "./service.js";
import { callDaemonJsonApi } from "../../core/intergration/shared/daemon-client.js";
import { printResult } from "../../core/intergration/cli-output.js";
import type { ChatSendResponse, SmaModule } from "../../types/module-command.js";

function parsePortOption(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isFinite(port) || Number.isNaN(port) || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

type ChatSendCliOptions = {
  text: string;
  chatKey?: string;
  path?: string;
  host?: string;
  port?: number;
  json?: boolean;
};

async function runChatSendCommand(options: ChatSendCliOptions): Promise<void> {
  const projectRoot = path.resolve(String(options.path || "."));
  const text = String(options.text || "");
  const snapshot = resolveChatContextSnapshot({ chatKey: options.chatKey });
  const chatKey = resolveChatKey({ chatKey: snapshot.chatKey });

  if (!chatKey) {
    printResult({
      asJson: options.json,
      success: false,
      title: "chat send failed",
      payload: {
        error:
          "Missing chatKey. Provide --chat-key or ensure SMA_CTX_CHAT_KEY is injected in current shell session.",
      },
    });
    return;
  }

  const remote = await callDaemonJsonApi<ChatSendResponse>({
    projectRoot,
    path: "/api/chat/send",
    method: "POST",
    host: options.host,
    port: options.port,
    body: {
      text,
      chatKey,
    },
  });

  if (remote.success && remote.data) {
    const data = remote.data;
    printResult({
      asJson: options.json,
      success: Boolean(data.success),
      title: data.success ? "chat sent" : "chat send failed",
      payload: {
        chatKey: data.chatKey || chatKey,
        ...(data.success ? {} : { error: data.error || "chat send failed" }),
      },
    });
    return;
  }

  // 兜底（中文）：当本地 server 不可达时，给出明确错误，提示先启动服务。
  printResult({
    asJson: options.json,
    success: false,
    title: "chat send failed",
    payload: {
      chatKey,
      error:
        remote.error ||
        "Agent server is not reachable. Start service via `sma start` or run in foreground via `sma run`.",
    },
  });
}

function setupCli(registry: Parameters<SmaModule["registerCli"]>[0]): void {
  registry.group("chat", "Chat 服务命令（Bash-first）", (group) => {
    group.command("send", "发送消息到目标 chatKey", (command: Command) => {
      command
        .requiredOption("--text <text>", "消息正文")
        .option("--chat-key <chatKey>", "目标 chatKey（不传则尝试读取 SMA_CTX_CHAT_KEY）")
        .option("--path <path>", "项目根目录（默认当前目录）", ".")
        .option("--host <host>", "Server host（覆盖自动解析）")
        .option("--port <port>", "Server port（覆盖自动解析）", parsePortOption)
        .option("--json [enabled]", "以 JSON 输出", true)
        .action(async (opts: ChatSendCliOptions) => {
          await runChatSendCommand(opts);
        });
    });

    group.command("context", "查看当前会话上下文快照", (command: Command) => {
      command
        .option("--chat-key <chatKey>", "显式覆盖 chatKey")
        .option("--json [enabled]", "以 JSON 输出", true)
        .action((opts: { chatKey?: string; json?: boolean }) => {
          const snapshot = resolveChatContextSnapshot({ chatKey: opts.chatKey });
          printResult({
            asJson: opts.json,
            success: true,
            title: "chat context",
            payload: {
              context: snapshot,
            },
          });
        });
    });
  });
}

function setupServer(registry: Parameters<SmaModule["registerServer"]>[0]): void {
  registry.get("/api/chat/context", (c) => {
    const snapshot = resolveChatContextSnapshot();
    return c.json({
      success: true,
      context: snapshot,
    });
  });

  registry.post("/api/chat/send", async (c) => {
    let body: any = null;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "Invalid JSON body" }, 400);
    }

    const text = String(body?.text ?? "");
    const chatKey = String(body?.chatKey || "").trim();
    if (!chatKey) {
      return c.json({ success: false, error: "Missing chatKey" }, 400);
    }

    const result = await sendChatTextByChatKey({
      chatKey,
      text,
    });

    return c.json(result, result.success ? 200 : 400);
  });
}

export const chatModule: SmaModule = {
  name: "chat",
  registerCli(registry) {
    setupCli(registry);
  },
  registerServer(registry) {
    setupServer(registry);
  },
};
