import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { Logger } from "../telemetry/index.js";
import type { Agent } from "../agent/context/index.js";
import { withChatRequestContext } from "../chat/request-context.js";
import http from "node:http";
import fs from "fs-extra";
import path from "path";
import { getShipRuntimeContext } from "./ShipRuntimeContext.js";
import { ChatManager } from "../chat/manager.js";
import { getShipPublicDirPath } from "../utils.js";

/**
 * HTTP server for ShipMyAgent.
 *
 * Provides:
 * - Health and status endpoints
 * - A minimal `/api/execute` endpoint for running ad-hoc instructions via AgentRuntime
 * - Static file serving for project `public/`
 * - Static file serving for `.ship/public/` (exposed under `/ship/public/*`)
 */
export interface ServerContext {
  projectRoot: string;
  logger: Logger;
  agentRuntime: Agent;
}

export interface StartOptions {
  port: number;
  host: string;
}

export class AgentServer {
  private app: Hono;
  private context: ServerContext;
  private server: ReturnType<typeof import("http").createServer> | null = null;
  private projectRoot: string;
  private chatManager: ChatManager;

  constructor(context: ServerContext) {
    this.context = context;
    this.projectRoot = context.projectRoot;
    // 优先复用进程级 ChatManager；若未初始化 runtime context，则 fallback（仅用于 HTTP API 审计）。
    this.chatManager = (() => {
      try {
        return getShipRuntimeContext().chatManager;
      } catch {
        return new ChatManager(this.projectRoot);
      }
    })();
    this.app = new Hono();

    // Middleware
    this.app.use("*", logger());
    this.app.use(
      "*",
      cors({
        origin: "*",
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization"],
      }),
    );

    // Routes
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Static file service (frontend pages)
    this.app.get("/", async (c) => {
      const indexPath = path.join(this.projectRoot, "public", "index.html");
      if (await fs.pathExists(indexPath)) {
        const content = await fs.readFile(indexPath, "utf-8");
        return c.body(content, 200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        });
      }
      return c.text("ShipMyAgent Agent Server", 200);
    });

    this.app.get("/styles.css", async (c) => {
      const cssPath = path.join(this.projectRoot, "public", "styles.css");
      if (await fs.pathExists(cssPath)) {
        const content = await fs.readFile(cssPath, "utf-8");
        return c.body(content, 200, {
          "Content-Type": "text/css; charset=utf-8",
          "Cache-Control": "no-cache",
        });
      }
      return c.text("Not Found", 404);
    });

    this.app.get("/app.js", async (c) => {
      const jsPath = path.join(this.projectRoot, "public", "app.js");
      if (await fs.pathExists(jsPath)) {
        const content = await fs.readFile(jsPath, "utf-8");
        return c.body(content, 200, {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "no-cache",
        });
      }
      return c.text("Not Found", 404);
    });

    // Public file service: `.ship/public/*` -> `/ship/public/*`
    this.app.get("/ship/public/*", async (c) => {
      const root = getShipPublicDirPath(this.projectRoot);
      const prefix = "/ship/public/";
      const requestPath = c.req.path;
      const rel = requestPath.startsWith(prefix) ? requestPath.slice(prefix.length) : "";
      if (!rel) return c.text("Not Found", 404);

      const full = path.resolve(root, rel);
      const rootResolved = path.resolve(root);
      if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) {
        return c.text("Forbidden", 403);
      }

      try {
        const stat = await fs.stat(full);
        if (!stat.isFile()) return c.text("Not Found", 404);
      } catch {
        return c.text("Not Found", 404);
      }

      const ext = path.extname(full).toLowerCase();
      const contentType =
        ext === ".html"
          ? "text/html; charset=utf-8"
          : ext === ".css"
            ? "text/css; charset=utf-8"
            : ext === ".js"
              ? "application/javascript; charset=utf-8"
              : ext === ".json"
                ? "application/json; charset=utf-8"
                : ext === ".txt" || ext === ".md"
                  ? "text/plain; charset=utf-8"
                  : ext === ".pdf"
                    ? "application/pdf"
                    : ext === ".png"
                      ? "image/png"
                      : ext === ".jpg" || ext === ".jpeg"
                        ? "image/jpeg"
                        : "application/octet-stream";

      const buf = await fs.readFile(full);
      return c.body(buf, 200, {
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
      });
    });

    // Health check
    this.app.get("/health", (c) => {
      return c.json({ status: "ok", timestamp: new Date().toISOString() });
    });

    // Get Agent status
    this.app.get("/api/status", (c) => {
      return c.json({
        name: "shipmyagent",
        status: "running",
        timestamp: new Date().toISOString(),
      });
    });

    // Execute instruction
    this.app.post("/api/execute", async (c) => {
      let bodyText;
      try {
        bodyText = await c.req.text();
      } catch {
        return c.json(
          { success: false, message: "Unable to read request body" },
          400,
        );
      }

      if (!bodyText) {
        return c.json(
          { success: false, message: "Request body is empty" },
          400,
        );
      }

      let body;
      try {
        body = JSON.parse(bodyText);
      } catch {
        return c.json(
          {
            success: false,
            message: `JSON parse failed: ${bodyText.substring(0, 50)}...`,
          },
          400,
        );
      }

      const instructions = body?.instructions;
      const chatId =
        typeof body?.chatId === "string" && body.chatId.trim()
          ? body.chatId.trim()
          : "default";
      const actorId =
        typeof body?.userId === "string" && body.userId.trim()
          ? body.userId.trim()
          : typeof body?.actorId === "string" && body.actorId.trim()
            ? body.actorId.trim()
            : "api";

      if (!instructions) {
        return c.json(
          { success: false, message: "Missing instructions field" },
          400,
        );
      }

      try {
        const chatKey = `api:chat:${chatId}`;
        const chat = this.chatManager.get(chatKey);
        await chat.append({
          channel: "api",
          chatId,
          userId: actorId,
          messageId:
            typeof body?.messageId === "string" ? body.messageId : undefined,
          role: "user",
          text: String(instructions),
        });

        if (!this.context.agentRuntime.isInitialized()) {
          await this.context.agentRuntime.initialize();
        }
        // API 也是一种 “chat”（有 chatKey + 可落盘历史），但它不是“平台消息回发”场景：
        // - 允许使用 chat_load_history 等依赖 chatKey 的工具
        // - 不提供 channel/chatId 的 dispatcher 回发能力（响应通过 HTTP body 返回）
        const result = await withChatRequestContext(
          { chatKey, chatId, userId: actorId, messageId: typeof body?.messageId === "string" ? body.messageId : undefined },
          () =>
            this.context.agentRuntime.run({
              chatKey,
              query: instructions,
            }),
        );

        await chat.append({
          channel: "api",
          chatId,
          userId: "bot",
          messageId:
            typeof body?.messageId === "string" ? body.messageId : undefined,
          role: "assistant",
          text: String(result?.output || ""),
          meta: { success: Boolean((result as any)?.success) },
        });

        return c.json(result);
      } catch (error) {
        return c.json({ success: false, message: String(error) }, 500);
      }
    });
  }

  async start(options: StartOptions): Promise<void> {
    const { port, host } = options;

    // Start server
    return new Promise((resolve) => {
      const server = http.createServer(async (req, res) => {
        try {
          const url = new URL(req.url || "/", `http://${host}:${port}`);
          const method = req.method || "GET";

          // Collect body
          const bodyBuffer = await new Promise<Buffer>((resolve, reject) => {
            let chunks: Buffer[] = [];
            req.on("data", (chunk) => chunks.push(chunk));
            req.on("end", () => resolve(Buffer.concat(chunks)));
            req.on("error", reject);
          });

          // Create a simple request adapter
          const request = new Request(url.toString(), {
            method,
            headers: new Headers(req.headers as Record<string, string>),
            body: bodyBuffer.length > 0 ? bodyBuffer : undefined,
          });

          const response = await this.app.fetch(request);

          // Convert Response to HTTP response
          res.statusCode = response.status;
          for (const [key, value] of response.headers.entries()) {
            res.setHeader(key, value);
          }
          const body = await response.text();
          res.end(body);
        } catch (error) {
          res.statusCode = 500;
          res.end("Internal Server Error");
        }
      });

      this.server = server;
      server.listen(port, host, () => {
        this.context.logger.info(
          `🚀 Agent Server started: http://${host}:${port}`,
        );
        this.context.logger.info("Available APIs:");
        this.context.logger.info("  GET  /health - Health check");
        this.context.logger.info("  GET  /api/status - Agent status");
        this.context.logger.info("  POST /api/execute - Execute instruction");
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      await this.context.logger.saveAllLogs();
      this.server.close();
      this.context.logger.info("Agent Server stopped");
    }
  }

  getApp(): Hono {
    return this.app;
  }
}

export function createServer(context: ServerContext): AgentServer {
  return new AgentServer(context);
}
