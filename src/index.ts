import "dotenv/config";
import { createHash, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig, type Config } from "./config.js";
import { OpenTerminalClient } from "./open-terminal-client.js";
import { registerAllTools } from "./tools/index.js";

/**
 * Build a fresh McpServer wired to the shared client. A new server instance is
 * created per request because the v1 SDK's Server.connect() refuses a second
 * transport on the same instance. Registration is cheap (no I/O).
 */
function createServer(client: OpenTerminalClient): McpServer {
  const server = new McpServer(
    { name: "open-terminal", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  registerAllTools(server, client);
  return server;
}

/**
 * Constant-time bearer-token check. Both inputs are hashed to a fixed-length
 * SHA-256 digest first, which eliminates the length side-channel (a wrong-
 * length token no longer takes a different path than a right-length one)
 * and removes the zero-length edge case.
 */
function timingSafeEqualString(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

function extractBearer(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1]! : undefined;
}

function loadConfigOrExit(): Config {
  try {
    return loadConfig();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Configuration error: ${msg}\n`);
    process.exit(1);
  }
}

export function createApp(config: Config, client: OpenTerminalClient): express.Express {
  const app = express();

  // CORS — set at the hosting layer (the transport sets none itself).
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", config.corsOrigin);
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  // Structured JSON request logging.
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      const entry = {
        time: new Date().toISOString(),
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
      };
      process.stdout.write(`${JSON.stringify(entry)}\n`);
    });
    next();
  });

  // Bearer auth — every route below this needs a valid token except /health.
  function requireAuth(req: Request, res: Response, next: NextFunction): void {
    const token = extractBearer(req);
    if (!token || !timingSafeEqualString(token, config.mcpAuthToken)) {
      res
        .status(401)
        .setHeader("WWW-Authenticate", 'Bearer realm="open-terminal-mcp"')
        .json({ error: "Missing or invalid bearer token" });
      return;
    }
    next();
  }

  // Health check — no auth, for liveness probes.
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // MCP endpoint — stateless Streamable HTTP (protocol 2025-03-26).
  // The 50 MB JSON parser is scoped to this route behind auth so unauthenticated
  // clients cannot force large body parsing (upload_file needs the 50 MB limit).
  app.post("/mcp", requireAuth, express.json({ limit: "50mb" }), async (req, res) => {
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const server = createServer(client);
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: `Internal error: ${message}` },
          id: null,
        });
      }
    }
  });

  // Stateless server: GET (SSE stream) and DELETE (session teardown) are not supported.
  const methodNotAllowed = (_req: Request, res: Response): void => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed: this server is stateless and only accepts POST." },
      id: null,
    });
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  return app;
}

function main(): void {
  const config = loadConfigOrExit();

  const client = new OpenTerminalClient({
    baseUrl: config.openTerminalUrl,
    apiKey: config.openTerminalApiKey,
    sessionId: config.openTerminalSessionId,
    userId: config.openTerminalUserId,
    timeoutMs: config.openTerminalTimeoutMs,
  });

  const app = createApp(config, client);

  const httpServer = app.listen(config.port, config.bindHost, () => {
    if (config.bindHost !== "127.0.0.1" && config.bindHost !== "::1") {
      process.stderr.write(
        `WARNING: MCP server is bound to ${config.bindHost} (not loopback). This service grants shell access to anyone with the bearer token and is now reachable beyond localhost. Put it behind TLS and a reverse proxy.\n`,
      );
    }
    process.stdout.write(
      JSON.stringify({
        time: new Date().toISOString(),
        event: "listening",
        host: config.bindHost,
        port: config.port,
        openTerminalUrl: config.openTerminalUrl,
        sessionId: config.openTerminalSessionId,
      }) + "\n",
    );
  });

  function shutdown(signal: string): void {
    process.stdout.write(JSON.stringify({ time: new Date().toISOString(), event: "shutdown", signal }) + "\n");
    httpServer.close(() => process.exit(0));
    // Force exit after 5s if connections hang.
    setTimeout(() => process.exit(1), 5000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// Re-export for tests.
export { createServer, timingSafeEqualString, extractBearer };

// Only start the server when run as the entry module, not when imported.
// pathToFileURL normalizes the path so symlinks and absolute paths compare correctly.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
