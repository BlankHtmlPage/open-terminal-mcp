import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import { createApp } from "../src/index.ts";
import { loadConfig, type Config } from "../src/config.ts";
import { OpenTerminalClient } from "../src/open-terminal-client.ts";

const VALID_TOKEN = "test-token-valid-1234567890123456ab"; // 36 chars, >32
const WRONG_TOKEN = "wrong-token-12345678901234567890xx"; // 34 chars, >32 but wrong
const SHORT_TOKEN = "short"; // <32

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    openTerminalUrl: "http://ot.test:8000",
    openTerminalApiKey: "test-key-not-real",
    mcpAuthToken: VALID_TOKEN,
    port: 0,
    bindHost: "127.0.0.1",
    openTerminalTimeoutMs: 5000,
    corsOrigin: "*",
    openTerminalUserId: undefined,
    openTerminalSessionId: "test-session",
    ...overrides,
  };
}

function makeClient(config: Config): OpenTerminalClient {
  return new OpenTerminalClient({
    baseUrl: config.openTerminalUrl,
    apiKey: config.openTerminalApiKey,
    sessionId: config.openTerminalSessionId,
    timeoutMs: config.openTerminalTimeoutMs,
  });
}

async function withServer(
  app: Express,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

describe("HTTP auth boundary", () => {
  it("GET /health returns 200 with exactly {\"status\":\"ok\"} and requires no token", async () => {
    const config = makeConfig();
    const client = makeClient(config);
    const app = createApp(config, client);

    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health`);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.equal(text, JSON.stringify({ status: "ok" }));
      const body = JSON.parse(text);
      assert.deepEqual(body, { status: "ok" });
      // must not leak host details
      assert.equal(body.hostname, undefined);
      assert.equal(body.version, undefined);
      assert.equal(body.cwd, undefined);
      assert.equal(body.uptime, undefined);
      assert.equal(body.openTerminalUrl, undefined);
      assert.ok(!text.includes(config.openTerminalUrl), "health body must not contain upstream url");
      assert.ok(!text.includes("127.0.0.1"), "health body must not contain host");
    });
  });

  it("POST /mcp with no Authorization header returns 401", async () => {
    const config = makeConfig();
    const client = makeClient(config);
    const app = createApp(config, client);

    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      });
      assert.equal(res.status, 401);
      const body = await res.text();
      assert.ok(body.includes("Missing or invalid bearer token"));
      // must not echo token or upstream url
      assert.ok(!body.includes(VALID_TOKEN));
      assert.ok(!body.includes(config.openTerminalUrl));
      assert.equal(res.headers.get("www-authenticate"), 'Bearer realm="open-terminal-mcp"');
    });
  });

  it("POST /mcp with a wrong token returns 401", async () => {
    const config = makeConfig();
    const client = makeClient(config);
    const app = createApp(config, client);

    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${WRONG_TOKEN}`,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      });
      assert.equal(res.status, 401);
      const body = await res.text();
      assert.ok(!body.includes(WRONG_TOKEN), "401 body must not echo the presented token");
      assert.ok(!body.includes(VALID_TOKEN), "401 body must not contain the valid token");
      assert.ok(!body.includes(config.openTerminalUrl));
    });
  });

  it("POST /mcp with a token shorter than MIN_TOKEN_LEN is rejected", async () => {
    const config = makeConfig();
    const client = makeClient(config);
    const app = createApp(config, client);

    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SHORT_TOKEN}`,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      });
      assert.equal(res.status, 401);
      const body = await res.text();
      assert.ok(!body.includes(SHORT_TOKEN) || body.includes("Missing or invalid bearer token"));
      assert.ok(!body.includes(VALID_TOKEN));
      assert.ok(!body.includes(config.openTerminalUrl));
    });
  });

  it("GET /mcp and DELETE /mcp return 405", async () => {
    const config = makeConfig();
    const client = makeClient(config);
    const app = createApp(config, client);

    await withServer(app, async (baseUrl) => {
      const getRes = await fetch(`${baseUrl}/mcp`, { method: "GET" });
      assert.equal(getRes.status, 405);
      const getBody: any = await getRes.json();
      assert.equal(getBody.error.code, -32000);

      const delRes = await fetch(`${baseUrl}/mcp`, { method: "DELETE" });
      assert.equal(delRes.status, 405);
      const delBody: any = await delRes.json();
      assert.equal(delBody.error.code, -32000);
    });
  });

  it("401 body contains no token material and no upstream URL", async () => {
    const config = makeConfig();
    const client = makeClient(config);
    const app = createApp(config, client);

    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${WRONG_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 401);
      const text = await res.text();
      assert.ok(!text.includes(VALID_TOKEN));
      assert.ok(!text.includes(WRONG_TOKEN));
      assert.ok(!text.includes(config.openTerminalUrl));
      assert.ok(!text.includes(config.openTerminalApiKey));
    });
  });
});

describe("config bind host", () => {
  it("default bind host is loopback when MCP_BIND_HOST is unset", async () => {
    const saved = {
      MCP_BIND_HOST: process.env.MCP_BIND_HOST,
      OPEN_TERMINAL_URL: process.env.OPEN_TERMINAL_URL,
      OPEN_TERMINAL_API_KEY: process.env.OPEN_TERMINAL_API_KEY,
      MCP_AUTH_TOKEN: process.env.MCP_AUTH_TOKEN,
    };
    try {
      delete process.env.MCP_BIND_HOST;
      process.env.OPEN_TERMINAL_URL = "http://ot.test:8000";
      process.env.OPEN_TERMINAL_API_KEY = "test-key-not-real";
      process.env.MCP_AUTH_TOKEN = VALID_TOKEN;
      // ensure other optional vars don't interfere
      delete process.env.PORT;
      const cfg = loadConfig();
      assert.equal(cfg.bindHost, "127.0.0.1");
    } finally {
      if (saved.MCP_BIND_HOST === undefined) delete process.env.MCP_BIND_HOST;
      else process.env.MCP_BIND_HOST = saved.MCP_BIND_HOST;
      if (saved.OPEN_TERMINAL_URL === undefined) delete process.env.OPEN_TERMINAL_URL;
      else process.env.OPEN_TERMINAL_URL = saved.OPEN_TERMINAL_URL;
      if (saved.OPEN_TERMINAL_API_KEY === undefined) delete process.env.OPEN_TERMINAL_API_KEY;
      else process.env.OPEN_TERMINAL_API_KEY = saved.OPEN_TERMINAL_API_KEY;
      if (saved.MCP_AUTH_TOKEN === undefined) delete process.env.MCP_AUTH_TOKEN;
      else process.env.MCP_AUTH_TOKEN = saved.MCP_AUTH_TOKEN;
    }
  });
});
