import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { OpenTerminalClient } from "../src/open-terminal-client.ts";
import { OpenTerminalError, toMcpError } from "../src/errors.ts";

/**
 * Unit tests for OpenTerminalClient. Global `fetch` is mocked per-test so no
 * network is required. These assert request shape (URL, query string, body,
 * headers) and response mapping (text vs image, error propagation).
 */

type FetchCall = {
  url: string;
  init: RequestInit;
};

let calls: FetchCall[] = [];
let originalFetch: typeof globalThis.fetch;

function mockFetch(responder: (url: string, init: RequestInit) => {
  status: number;
  body: unknown;
  contentType?: string;
  headers?: Record<string, string>;
}): void {
  calls = [];
  globalThis.fetch = ((input: URL | RequestInfo, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const { status, body, contentType = "application/json", headers } = responder(url, init!);
    calls.push({ url, init: init ?? {} });
    const respHeaders = new Headers({ "content-type": contentType, ...(headers ?? {}) });
    const raw = body instanceof Uint8Array || typeof body === "string" ? body : JSON.stringify(body);
    return Promise.resolve(new Response(raw, { status, headers: respHeaders }));
  }) as typeof globalThis.fetch;
}

function lastCall(): FetchCall {
  const last = calls[calls.length - 1];
  if (!last) throw new Error("no fetch call recorded");
  return last;
}

function makeClient(): OpenTerminalClient {
  return new OpenTerminalClient({
    baseUrl: "http://ot.test:8000",
    apiKey: "test-key-not-real",
    sessionId: "sess-123",
    userId: "user-1",
    timeoutMs: 5000,
  });
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("OpenTerminalClient request shape", () => {
  it("runCommand POSTs to /execute with JSON body and forwards session + user headers", async () => {
    const client = makeClient();
    mockFetch(() => ({ status: 200, body: { id: "p1", command: "echo hi", status: "done", exit_code: 0 } }));

    await client.runCommand({ command: "echo hi", env: { FOO: "bar" } });

    const { url, init } = lastCall();
    assert.equal(url, "http://ot.test:8000/execute");
    assert.equal(init.method, "POST");
    const headers = new Headers(init.headers as HeadersInit);
    assert.equal(headers.get("authorization"), "Bearer test-key-not-real");
    assert.equal(headers.get("x-session-id"), "sess-123");
    assert.equal(headers.get("x-user-id"), "user-1");
    assert.equal(headers.get("content-type"), "application/json");
    assert.deepEqual(JSON.parse(init.body as string), { command: "echo hi", env: { FOO: "bar" } });
  });

  it("runCommand puts wait and tail in the query string, omits undefined", async () => {
    const client = makeClient();
    mockFetch(() => ({ status: 200, body: { id: "p1", command: "x", status: "running", exit_code: null } }));

    await client.runCommand({ command: "x", wait: 5, tail: 3 });

    const { url } = lastCall();
    assert.match(url, /\?wait=5&tail=3/);
  });

  it("getStatus GETs the status endpoint with offset and optional wait", async () => {
    const client = makeClient();
    mockFetch(() => ({ status: 200, body: { id: "p1", command: "x", status: "done", exit_code: 0 } }));

    await client.getStatus("p1", { offset: 10, wait: 2 });

    const { url, init } = lastCall();
    assert.match(url, /\/execute\/p1\/status\?/);
    assert.match(url, /offset=10/);
    assert.match(url, /wait=2/);
    assert.equal(init.method, "GET");
  });

  it("grep expands include array as repeated query keys", async () => {
    const client = makeClient();
    mockFetch(() => ({ status: 200, body: { query: "TODO", path: ".", matches: [], truncated: false } }));

    await client.grep({ query: "TODO", include: ["*.py", "*.ts"] });

    const { url } = lastCall();
    // encodeURIComponent does not escape '*'; array repeats the key.
    assert.match(url, /include=\*\.py&include=\*\.ts/);
  });

  it("glob sends type and exclude params", async () => {
    const client = makeClient();
    mockFetch(() => ({ status: 200, body: { pattern: "*", path: ".", matches: [], truncated: false } }));

    await client.glob({ pattern: "*.md", exclude: ["node_modules"] });

    const { url } = lastCall();
    // '*' is in the unreserved set and is NOT percent-encoded.
    assert.match(url, /pattern=\*\.md/);
    assert.match(url, /exclude=node_modules/);
  });
});

describe("OpenTerminalClient response mapping", () => {
  it("readFile returns image kind for image content-type", async () => {
    const client = makeClient();
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    mockFetch(() => ({ status: 200, body: pngBytes, contentType: "image/png" }));

    const result = await client.readFile("/x.png");

    assert.equal(result.kind, "image");
    if (result.kind === "image") {
      assert.equal(result.mime, "image/png");
      assert.deepEqual(Array.from(result.bytes), [0x89, 0x50, 0x4e, 0x47]);
    }
  });

  it("readFile returns text kind for JSON body", async () => {
    const client = makeClient();
    mockFetch(() => ({
      status: 200,
      body: { path: "/a.txt", total_lines: 3, content: "line1\nline2\nline3" },
    }));

    const result = await client.readFile("/a.txt");

    assert.equal(result.kind, "text");
    if (result.kind === "text") {
      assert.equal(result.totalLines, 3);
      assert.equal(result.content, "line1\nline2\nline3");
    }
  });

  it("upload builds a multipart body containing the filename and bytes", async () => {
    const client = makeClient();
    mockFetch(() => ({ status: 200, body: { path: "/d/f.bin", size: 4 } }));

    const bytes = new Uint8Array([1, 2, 3, 4]);
    const result = await client.upload("/d", "f.bin", bytes);

    assert.deepEqual(result, { path: "/d/f.bin", size: 4 });
    const { url, init } = lastCall();
    assert.match(url, /\/files\/upload\?directory=%2Fd/);
    const headers = new Headers(init.headers as HeadersInit);
    assert.match(headers.get("content-type")!, /^multipart\/form-data; boundary=/);
    const bodyStr = init.body instanceof Buffer ? init.body.toString() : String(init.body);
    assert.match(bodyStr, /name="file"/);
    assert.match(bodyStr, /filename="f.bin"/);
    // The raw bytes appear in the body between the boundaries.
    assert.ok(bodyStr.includes("\u0001\u0002\u0003\u0004"), "uploaded bytes must appear in the multipart body");
  });
});

describe("OpenTerminalClient error handling", () => {
  it("throws OpenTerminalError with status and detail on a non-2xx JSON body", async () => {
    const client = makeClient();
    mockFetch(() => ({ status: 404, body: { detail: "Process not found" } }));

    await assert.rejects(
      () => client.getStatus("nope", {}),
      (err: unknown) => {
        assert.ok(err instanceof OpenTerminalError);
        assert.equal((err as OpenTerminalError).status, 404);
        assert.equal((err as OpenTerminalError).detail, "Process not found");
        return true;
      },
    );
  });

  it("falls back to statusText when body is not JSON", async () => {
    const client = makeClient();
    mockFetch(() => ({ status: 500, body: "internal explosion", contentType: "text/plain" }));

    await assert.rejects(
      () => client.list(),
      (err: unknown) => {
        assert.ok(err instanceof OpenTerminalError);
        assert.equal((err as OpenTerminalError).status, 500);
        return true;
      },
    );
  });
});

describe("OpenTerminalClient killed-process cache", () => {
  it("kill() snapshots the process, returns the final state with inferred exit code, and caches it", async () => {
    const client = makeClient();
    const snapshot = {
      id: "p1",
      command: "sleep 300",
      status: "running",
      exit_code: null,
      output: [{ type: "output", data: "starting\r\n" }],
      truncated: false,
      next_offset: 1,
      log_path: "/tmp/p1.jsonl",
    };
    // First call: snapshot GET. Second call: DELETE.
    let callCount = 0;
    mockFetch((url) => {
      callCount++;
      if (callCount === 1) return { status: 200, body: snapshot };
      return { status: 200, body: { status: "killed" } };
    });

    const result = await client.kill("p1", false);

    assert.equal(result.status, "killed");
    assert.equal(result.id, "p1");
    assert.equal(result.command, "sleep 300");
    assert.equal(result.exit_code, 143); // SIGTERM convention
    assert.equal(result.output.length, 1);
  });

  it("getStatus() returns the cached killed record when upstream 404s", async () => {
    const client = makeClient();
    const snapshot = {
      id: "p2",
      command: "long-job",
      status: "running",
      exit_code: null,
      output: [],
      truncated: false,
      next_offset: 0,
    };
    // First call: snapshot GET. Second call: DELETE. Third call: getStatus -> 404.
    let call = 0;
    mockFetch((url) => {
      call++;
      if (call === 1) return { status: 200, body: snapshot };
      if (call === 2) return { status: 200, body: { status: "killed" } };
      return { status: 404, body: { detail: "Process not found" } };
    });

    await client.kill("p2", true); // force=true -> exit 137
    const after = await client.getStatus("p2", {});

    assert.equal(after.status, "killed");
    assert.equal(after.id, "p2");
    assert.equal(after.exit_code, 137); // SIGKILL convention
  });

  it("getStatus() still throws 404 for an unknown process not in the cache", async () => {
    const client = makeClient();
    mockFetch(() => ({ status: 404, body: { detail: "Process not found" } }));

    await assert.rejects(
      () => client.getStatus("never-killed", {}),
      (err: unknown) => err instanceof OpenTerminalError && (err as OpenTerminalError).status === 404,
    );
  });

  it("list() merges cached killed processes that are gone from upstream", async () => {
    const client = makeClient();
    const snapshot = {
      id: "p3",
      command: "old-job",
      status: "running",
      exit_code: null,
      output: [],
      truncated: false,
      next_offset: 0,
    };
    let call = 0;
    mockFetch((url) => {
      call++;
      if (call === 1) return { status: 200, body: snapshot };
      if (call === 2) return { status: 200, body: { status: "killed" } };
      // list() call: only the live process remains upstream.
      return { status: 200, body: [{ id: "p4", command: "still-running", status: "running", exit_code: null }] };
    });

    await client.kill("p3", false);
    const all = await client.list();

    const ids = all.map((p) => p.id);
    assert.ok(ids.includes("p3"), "cached killed process should appear in list");
    assert.ok(ids.includes("p4"), "live process should appear in list");
    const cached = all.find((p) => p.id === "p3")!;
    assert.equal(cached.status, "killed");
    assert.equal(cached.exit_code, 143);
  });

  it("kill() treats a DELETE 404 as success when the process already exited", async () => {
    // The snapshot GET succeeds, then the DELETE returns 404 because the
    // process exited between the two calls. kill() must not throw.
    const client = makeClient();
    mockFetch((url) => {
      if (url.includes("/status")) return { status: 200, body: { id: "p5", command: "quick-exit", status: "running", exit_code: null, output: [], truncated: false, next_offset: 0 } };
      if (url.endsWith("/p5") || url.includes("/p5?")) return { status: 404, body: { detail: "Process not found" } };
      return { status: 500, body: { detail: "unexpected" } };
    });

    const result = await client.kill("p5", false);

    assert.equal(result.status, "killed");
    assert.equal(result.id, "p5");
    assert.equal(result.command, "quick-exit");
    assert.equal(result.exit_code, 143);
  });
});

describe("OpenTerminalClient killed-process cache — TTL eviction", () => {
  it("entries expire after killedTtlMs", async () => {
    const client = new OpenTerminalClient({
      baseUrl: "http://ot.test:8000",
      apiKey: "test-key-not-real",
      sessionId: "sess-123",
      userId: "user-1",
      timeoutMs: 5000,
      killedTtlMs: 10,
    });
    const snapshot = { id: "p6", command: "short", status: "running", exit_code: null, output: [], truncated: false, next_offset: 0 };
    let call = 0;
    mockFetch((url) => {
      call++;
      if (call === 1) return { status: 200, body: snapshot }; // snapshot GET
      if (call === 2) return { status: 200, body: { status: "killed" } }; // DELETE
      return { status: 404, body: { detail: "Process not found" } }; // any later status GET
    });

    await client.kill("p6", false);
    // Wait past the TTL.
    await new Promise((r) => setTimeout(r, 30));
    // The cache should have been pruned; getStatus() now throws 404.
    await assert.rejects(
      () => client.getStatus("p6", {}),
      (err: unknown) => err instanceof OpenTerminalError && (err as OpenTerminalError).status === 404,
    );
  });
});

describe("toMcpError classification", () => {
  it("maps a TypeError with cause.code ECONNREFUSED to 'Open Terminal unreachable'", () => {
    const err = new TypeError("fetch failed");
    (err as { cause?: { code?: string } }).cause = { code: "ECONNREFUSED" };
    const result = toMcpError(err);
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /unreachable.*ECONNREFUSED/);
  });

  it("maps ABORT_ERR cause.code to 'Open Terminal request timed out'", () => {
    const err = new TypeError("aborted");
    (err as { cause?: { code?: string } }).cause = { code: "ABORT_ERR" };
    const result = toMcpError(err);
    assert.match(result.content[0]!.text, /timed out/);
  });
});
