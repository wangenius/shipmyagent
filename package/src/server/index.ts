import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { Logger } from "../runtime/logging/index.js";
import type { AgentRuntime } from "../runtime/agent/index.js";
import { ChatStore } from "../runtime/chat/store.js";
import http from "node:http";
import fs from "fs-extra";
import path from "path";
import { Readable } from "node:stream";

/**
 * HTTP server for ShipMyAgent.
 *
 * Provides:
 * - Health and status endpoints
 * - A minimal `/api/execute` endpoint for running ad-hoc instructions via AgentRuntime
 * - Static file serving for project `public/` and `.ship/public/*` (via `/public/*`)
 */
function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  if (ext === ".md") return "text/markdown; charset=utf-8";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".webp") return "image/webp";
  if (ext === ".zip") return "application/zip";
  return "application/octet-stream";
}

function safePublicRelativePath(urlPath: string): string | null {
  if (!urlPath.startsWith("/public")) return null;
  const raw = urlPath.replace(/^\/public\/?/, "");
  if (!raw) return "";
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const normalized = path.posix.normalize(decoded.replace(/\\/g, "/"));
  if (normalized === "." || normalized === "") return "";
  if (normalized.startsWith("..") || normalized.includes("/..")) return null;
  return normalized;
}

export interface ServerContext {
  projectRoot: string;
  logger: Logger;
  agentRuntime: AgentRuntime;
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
  private chatStore: ChatStore;

  constructor(context: ServerContext) {
    this.context = context;
    this.projectRoot = context.projectRoot;
    this.chatStore = new ChatStore(this.projectRoot);
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

    // Serve project runtime public files: .ship/public/* => /public/*
    this.app.all("/public/*", async (c) => {
      const method = c.req.method.toUpperCase();
      if (method !== "GET" && method !== "HEAD") {
        return c.text("Method Not Allowed", 405);
      }

      const rel = safePublicRelativePath(c.req.path);
      if (rel === null) return c.text("Not Found", 404);

      const baseDir = path.join(this.projectRoot, ".ship", "public");
      const absolutePath = path.resolve(baseDir, rel);
      const baseResolved = path.resolve(baseDir);
      if (
        absolutePath !== baseResolved &&
        !absolutePath.startsWith(baseResolved + path.sep)
      ) {
        return c.text("Not Found", 404);
      }

      const exists = await fs.pathExists(absolutePath);
      if (!exists) return c.text("Not Found", 404);
      const stat = await fs.stat(absolutePath).catch(() => null);
      if (!stat || !stat.isFile()) return c.text("Not Found", 404);

      const headers: Record<string, string> = {
        "Content-Type": guessContentType(absolutePath),
        "Cache-Control": "no-cache",
      };
      if (method === "HEAD") {
        headers["Content-Length"] = String(stat.size);
        return c.body(null, 200, headers);
      }

      const stream = Readable.toWeb(fs.createReadStream(absolutePath)) as any;
      return new Response(stream, { status: 200, headers });
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
        await this.chatStore.append({
          channel: "api",
          chatId,
          chatKey,
          userId: actorId,
          messageId:
            typeof body?.messageId === "string" ? body.messageId : undefined,
          role: "user",
          text: String(instructions),
        });

        if (!this.context.agentRuntime.isInitialized()) {
          await this.context.agentRuntime.initialize();
        }
        const result = await this.context.agentRuntime.run({
          instructions,
          context: { source: "api", userId: chatId, chatKey, actorId },
        });

        await this.chatStore.append({
          channel: "api",
          chatId,
          chatKey,
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
