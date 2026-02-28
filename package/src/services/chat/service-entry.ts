/**
 * Chat service。
 *
 * 关键点（中文）
 * - CLI：`sma chat send/context`
 * - Server：`/api/chat/send`、`/api/chat/context`
 * - 只保留最小注册层，业务逻辑下沉到 service/runtime
 */

import path from "node:path";
import fs from "node:fs/promises";
import type { Command } from "commander";
import {
  resolveChatContextSnapshot,
  resolveChatKey,
  sendChatTextByChatKey,
} from "./service.js";
import { callDaemonJsonApi } from "../../process/daemon/client.js";
import { printResult } from "../../process/utils/cli-output.js";
import type { SmaService } from "../../core/services/types/service-registry.js";
import type { ChatSendResponse } from "./types/chat-command.js";

/**
 * 解析端口参数。
 *
 * 关键点（中文）
 * - 统一校验范围 1~65535，避免各命令重复实现。
 */
function parsePortOption(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isFinite(port) || Number.isNaN(port) || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

type ChatSendCliOptions = {
  text?: string;
  stdin?: boolean;
  textFile?: string;
  chatKey?: string;
  path?: string;
  host?: string;
  port?: number;
  json?: boolean;
};

function printSendFailed(params: {
  asJson?: boolean;
  chatKey?: string;
  error: string;
}): void {
  printResult({
    asJson: params.asJson,
    success: false,
    title: "chat send failed",
    payload: {
      ...(params.chatKey ? { chatKey: params.chatKey } : {}),
      error: params.error,
    },
  });
}

/**
 * CLI: `chat send`。
 *
 * 流程（中文）
 * 1) 解析 chatKey（显式参数优先）
 * 2) 通过 daemon API 转发到 server
 * 3) 标准化输出 JSON/文本结果
 */
async function runChatSendCommand(options: ChatSendCliOptions): Promise<void> {
  const projectRoot = path.resolve(String(options.path || "."));
  const explicitText = String(options.text || "");
  const useStdin = Boolean(options.stdin);
  const textFile = String(options.textFile || "").trim();
  const inputSourcesCount =
    (explicitText ? 1 : 0) + (useStdin ? 1 : 0) + (textFile ? 1 : 0);

  if (inputSourcesCount !== 1) {
    printSendFailed({
      asJson: options.json,
      error:
        "Exactly one text source is required: use one of --text, --stdin, or --text-file.",
    });
    return;
  }

  let text = explicitText;
  if (useStdin) {
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of process.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
    } catch (error) {
      printSendFailed({
        asJson: options.json,
        error: `Failed to read stdin: ${String(error)}`,
      });
      return;
    }
    text = Buffer.concat(chunks).toString("utf8");
  } else if (textFile) {
    const filePath = path.isAbsolute(textFile)
      ? textFile
      : path.resolve(projectRoot, textFile);
    try {
      text = await fs.readFile(filePath, "utf8");
    } catch (error) {
      printSendFailed({
        asJson: options.json,
        error: `Failed to read --text-file: ${filePath}. ${String(error)}`,
      });
      return;
    }
  }

  const chatKey = resolveChatKey({ chatKey: options.chatKey });

  if (!chatKey) {
    printSendFailed({
      asJson: options.json,
      error:
        "Missing chatKey. Provide --chat-key or ensure SMA_CTX_CONTEXT_ID (or SMA_CTX_CHANNEL + SMA_CTX_TARGET_ID) is injected in current shell context.",
    });
    return;
  }

  const remote = await callDaemonJsonApi<ChatSendResponse>({
    projectRoot,
    path: "/api/chat/send",
    method: "POST",
    host: options.host,
    port: options.port,
    body: { text, chatKey },
  });

  if (!remote.success || !remote.data) {
    // 兜底（中文）：当本地 server 不可达时，给出明确错误，提示先启动服务。
    printSendFailed({
      asJson: options.json,
      chatKey,
      error:
        remote.error ||
        "Agent server is not reachable. Start service via `sma start` or run in foreground via `sma run`.",
    });
    return;
  }

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
}

/**
 * CLI: `chat context`。
 *
 * 关键点（中文）
 * - 只读取上下文快照，不做任何写操作。
 */
function runChatContextCommand(opts: { chatKey?: string; json?: boolean }): void {
  const snapshot = resolveChatContextSnapshot({ chatKey: opts.chatKey });
  printResult({
    asJson: opts.json,
    success: true,
    title: "chat context",
    payload: { context: snapshot },
  });
}

export const chatService: SmaService = {
  name: "chat",

  registerCli(registry) {
    registry.group("chat", "Chat 服务命令（Bash-first）", (group) => {
      group.command("send", "发送消息到目标 chatKey", (command: Command) => {
        command
          .option("--text <text>", "消息正文")
          .option("--stdin", "从标准输入读取消息正文", false)
          .option("--text-file <file>", "从文件读取消息正文（相对路径基于 --path）")
          .option("--chat-key <chatKey>", "目标 chatKey（不传则尝试读取 SMA_CTX_CHAT_KEY）")
          .option("--path <path>", "项目根目录（默认当前目录）", ".")
          .option("--host <host>", "Server host（覆盖自动解析）")
          .option("--port <port>", "Server port（覆盖自动解析）", parsePortOption)
          .option("--json [enabled]", "以 JSON 输出", true)
          .action(runChatSendCommand);
      });

      group.command("context", "查看当前会话上下文快照", (command: Command) => {
        command
          .option("--chat-key <chatKey>", "显式覆盖 chatKey")
          .option("--json [enabled]", "以 JSON 输出", true)
          .action(runChatContextCommand);
      });
    });
  },

  registerServer(registry, context) {
    registry.get("/api/chat/context", (c) => {
      return c.json({
        success: true,
        context: resolveChatContextSnapshot({ context }),
      });
    });

    registry.post("/api/chat/send", async (c) => {
      const body = await c.req.json().catch(() => null as any);
      if (!body || typeof body !== "object") {
        return c.json({ success: false, error: "Invalid JSON body" }, 400);
      }

      const text = String((body as any).text ?? "");
      const chatKey = String((body as any).chatKey || "").trim();
      if (!chatKey) return c.json({ success: false, error: "Missing chatKey" }, 400);

      const result = await sendChatTextByChatKey({
        context,
        chatKey,
        text,
      });
      return c.json(result, result.success ? 200 : 400);
    });
  },
};
