import { randomUUID } from "node:crypto";

const MIN_TOKEN_LEN = 16;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `Missing required environment variable: ${name}. Set it in the environment or a .env file.`,
    );
  }
  return value;
}

function optionalInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid integer for ${name}: ${raw!}`);
  }
  return parsed;
}

/**
 * Validated, immutable runtime configuration loaded from the environment.
 * Exits with a clear message at boot if any required value is missing.
 */
export interface Config {
  /** Base URL of the Open Terminal REST API (no trailing slash). */
  openTerminalUrl: string;
  /** API key forwarded as `Authorization: Bearer <key>` to Open Terminal. */
  openTerminalApiKey: string;
  /** Shared secret clients must present to call this MCP server. */
  mcpAuthToken: string;
  /** TCP port the MCP HTTP server listens on. */
  port: number;
  /** Outbound fetch timeout to Open Terminal, in milliseconds. */
  openTerminalTimeoutMs: number;
  /** Value of the `Access-Control-Allow-Origin` response header. */
  corsOrigin: string;
  /** Optional `X-User-Id` for Open Terminal multi-user mode. */
  openTerminalUserId: string | undefined;
  /** Stable `X-Session-Id` so Open Terminal remembers this server's cwd. */
  openTerminalSessionId: string;
}

export function loadConfig(): Config {
  const openTerminalUrl = requireEnv("OPEN_TERMINAL_URL").replace(/\/+$/, "");
  const openTerminalApiKey = requireEnv("OPEN_TERMINAL_API_KEY");
  const mcpAuthToken = requireEnv("MCP_AUTH_TOKEN");
  if (mcpAuthToken.length < MIN_TOKEN_LEN) {
    throw new Error(
      `MCP_AUTH_TOKEN must be at least ${MIN_TOKEN_LEN} characters. Received ${mcpAuthToken.length}.`,
    );
  }
  const port = optionalInt("PORT", 3000);
  const openTerminalTimeoutMs = optionalInt("OPEN_TERMINAL_TIMEOUT_MS", 30000);
  const corsOrigin = process.env.MCP_CORS_ORIGIN ?? "*";
  const openTerminalUserId =
    process.env.OPEN_TERMINAL_USER_ID && process.env.OPEN_TERMINAL_USER_ID !== ""
      ? process.env.OPEN_TERMINAL_USER_ID
      : undefined;
  const openTerminalSessionId =
    process.env.OPEN_TERMINAL_SESSION_ID && process.env.OPEN_TERMINAL_SESSION_ID !== ""
      ? process.env.OPEN_TERMINAL_SESSION_ID
      : `mcp-${randomUUID()}`;

  return Object.freeze({
    openTerminalUrl,
    openTerminalApiKey,
    mcpAuthToken,
    port,
    openTerminalTimeoutMs,
    corsOrigin,
    openTerminalUserId,
    openTerminalSessionId,
  });
}
