import { OpenTerminalError } from "./errors.js";

/**
 * Build a query string from a record, omitting undefined/null/empty values.
 * Array values are repeated as multiple keys (FastAPI list params).
 */
function buildQuery(params: Record<string, unknown>): string {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const v of value) pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    } else {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return pairs.length ? `?${pairs.join("&")}` : "";
}

interface RequestOptions {
  query?: Record<string, unknown>;
  body?: unknown;
  rawBody?: { bytes: Uint8Array; contentType: string };
}

/** Result of reading a file that Open Terminal returns as raw binary (images, etc.). */
export interface BinaryFileResult {
  kind: "image";
  mime: string;
  bytes: Uint8Array;
}

/** Result of reading a file that Open Terminal returns as text JSON. */
export interface TextFileResult {
  kind: "text";
  path: string;
  totalLines: number;
  content: string;
}

/** A background process as returned by /execute endpoints. */
export interface ProcessResult {
  id: string;
  command: string;
  status: string;
  exit_code: number | null;
  output?: unknown[];
  truncated?: boolean;
  next_offset?: number;
  log_path?: string;
}

export interface ListEntry {
  name: string;
  type: string;
  size?: number;
  modified?: number;
}

/**
 * Typed wrapper around the Open Terminal REST API.
 *
 * One instance is shared across all MCP tool handlers. Every call sends the
 * API key, the stable session id, and (optionally) a user id for multi-user
 * mode. Outbound calls time out after `timeoutMs`.
 */
export class OpenTerminalClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly sessionId: string;
  private readonly userId: string | undefined;
  private readonly timeoutMs: number;

  /**
   * Local cache of processes killed through this client. Open Terminal deletes
   * a process from its tracking dict immediately after `DELETE /execute/{id}`,
   * so subsequent polls return 404. We capture the final state before the
   * kill so the caller can still inspect exit code and last output.
   *
   * Entries expire after KILLED_TTL_MS (matches Open Terminal's own
   * `_EXPIRY_SECONDS` of 300s). Single-instance state — a multi-node setup
   * would need an external store.
   */
  private static readonly KILLED_TTL_MS = 5 * 60 * 1000;
  private readonly killedTtlMs: number;
  private readonly killedCache = new Map<string, { result: ProcessResult; at: number }>();

  private pruneKilledCache(): void {
    const now = Date.now();
    for (const [id, entry] of this.killedCache) {
      if (now - entry.at > this.killedTtlMs) {
        this.killedCache.delete(id);
      }
    }
  }

  constructor(opts: {
    baseUrl: string;
    apiKey: string;
    sessionId: string;
    userId?: string;
    timeoutMs: number;
    /** Optional override for the killed-process cache TTL, mainly for tests. */
    killedTtlMs?: number;
  }) {
    this.baseUrl = opts.baseUrl;
    this.apiKey = opts.apiKey;
    this.sessionId = opts.sessionId;
    this.userId = opts.userId;
    this.timeoutMs = opts.timeoutMs;
    this.killedTtlMs = opts.killedTtlMs ?? OpenTerminalClient.KILLED_TTL_MS;
  }

  /** Issue a request and return the raw Response, throwing on non-2xx. */
  private async fetchRaw(
    method: string,
    path: string,
    { query, body, rawBody }: RequestOptions = {},
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}${buildQuery(query ?? {})}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "X-Session-Id": this.sessionId,
    };
    if (this.userId) headers["X-User-Id"] = this.userId;
    let init: RequestInit = { method, headers, signal: controller.signal };
    if (rawBody !== undefined) {
      headers["Content-Type"] = rawBody.contentType;
      // Cast: Uint8Array is valid BodyInit but TS's BodyInit type union
      // doesn't include it across all DOM lib versions. Buffer extends
      // Uint8Array so the cast is safe at runtime.
      init = { ...init, body: rawBody.bytes as unknown as BodyInit };
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init = { ...init, body: JSON.stringify(body) };
    }
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        const detail = await this.extractDetail(res);
        throw new OpenTerminalError(res.status, detail);
      }
      return res;
    } catch (err) {
      if (err instanceof OpenTerminalError) throw err;
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(`Request timed out after ${this.timeoutMs}ms: ${method} ${path}`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Parse a FastAPI error body into a single detail string. */
  private async extractDetail(res: Response): Promise<string> {
    try {
      const data = await res.json();
      if (typeof data?.detail === "string") return data.detail;
      return JSON.stringify(data);
    } catch {
      try {
        const text = await res.text();
        return text || res.statusText;
      } catch {
        return res.statusText;
      }
    }
  }

  /** JSON request helper: throws on non-2xx, parses JSON on success. */
  private async json<T>(
    method: string,
    path: string,
    opts?: RequestOptions,
  ): Promise<T> {
    const res = await this.fetchRaw(method, path, opts);
    return (await res.json()) as T;
  }

  // -- Execute ---------------------------------------------------------------

  async runCommand(args: {
    command: string;
    cwd?: string;
    env?: Record<string, string>;
    wait?: number;
    tail?: number;
  }): Promise<ProcessResult> {
    const { command, cwd, env, wait, tail } = args;
    return this.json<ProcessResult>("POST", "/execute", {
      query: { wait, tail },
      body: { command, ...(cwd !== undefined && { cwd }), ...(env !== undefined && { env }) },
    });
  }

  async getStatus(
    processId: string,
    args: { wait?: number; offset?: number; tail?: number },
  ): Promise<ProcessResult> {
    this.pruneKilledCache();
    try {
      return await this.json<ProcessResult>("GET", `/execute/${encodeURIComponent(processId)}/status`, {
        query: { wait: args.wait, offset: args.offset ?? 0, tail: args.tail },
      });
    } catch (err) {
      // If upstream 404s and we have a cached killed-process record, serve it
      // so the caller can still see the final state. See killedCache notes.
      if (err instanceof OpenTerminalError && err.status === 404) {
        const cached = this.killedCache.get(processId);
        if (cached) return cached.result;
      }
      throw err;
    }
  }

  async sendInput(processId: string, input: string): Promise<{ status: string }> {
    return this.json("POST", `/execute/${encodeURIComponent(processId)}/input`, {
      body: { input },
    });
  }

  async kill(processId: string, force: boolean): Promise<ProcessResult> {
    this.pruneKilledCache();
    // Snapshot the process before Open Terminal deletes the record. If the
    // process is already gone, we skip the snapshot and just forward the kill.
    let snapshot: ProcessResult | undefined;
    try {
      snapshot = await this.json<ProcessResult>("GET", `/execute/${encodeURIComponent(processId)}/status`, {
        query: { offset: 0 },
      });
    } catch {
      // Process not found — nothing to snapshot; proceed with kill.
    }
    try {
      await this.json("DELETE", `/execute/${encodeURIComponent(processId)}`, {
        query: { force },
      });
    } catch (err) {
      // If the process was already gone by the time we tried to kill it,
      // treat it as success — we have the snapshot and the caller wants
      // confirmation that it is no longer running.
      if (!(err instanceof OpenTerminalError && err.status === 404)) throw err;
    }
    const exit_code = force ? 137 : 143; // SIGKILL / SIGTERM convention
    const final: ProcessResult = {
      id: processId,
      command: snapshot?.command ?? "",
      status: "killed",
      exit_code,
      output: snapshot?.output ?? [],
      truncated: snapshot?.truncated ?? false,
      next_offset: snapshot?.next_offset ?? 0,
      log_path: snapshot?.log_path,
    };
    this.killedCache.set(processId, { result: final, at: Date.now() });
    return final;
  }

  async list(): Promise<ProcessResult[]> {
    this.pruneKilledCache();
    const live = await this.json<ProcessResult[]>("GET", "/execute");
    // Merge in cached killed processes that have aged out of upstream tracking.
    const liveIds = new Set(live.map((p) => p.id));
    const cachedKilled: ProcessResult[] = [];
    for (const [, entry] of this.killedCache) {
      cachedKilled.push(entry.result);
    }
    // De-dupe against the live list in case Open Terminal still has the process.
    const dedupedCached = cachedKilled.filter((p) => !liveIds.has(p.id));
    return [...live, ...dedupedCached];
  }

  // -- Files -----------------------------------------------------------------

  /**
   * Read a file. Open Terminal returns text files as JSON and image/binary
   * files as raw bytes; this method discriminates by content-type.
   */
  async readFile(
    path: string,
    range?: { start_line?: number; end_line?: number },
  ): Promise<TextFileResult | BinaryFileResult> {
    const res = await this.fetchRaw("GET", "/files/read", {
      query: { path, start_line: range?.start_line, end_line: range?.end_line },
    });
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.startsWith("image/")) {
      const buf = new Uint8Array(await res.arrayBuffer());
      return { kind: "image", mime: contentType.split(";")[0]!.trim(), bytes: buf };
    }
    const data = (await res.json()) as { path: string; total_lines: number; content: string };
    return { kind: "text", path: data.path, totalLines: data.total_lines, content: data.content };
  }

  async writeFile(path: string, content: string): Promise<{ path: string; size: number }> {
    return this.json("POST", "/files/write", { body: { path, content } });
  }

  async editFile(
    path: string,
    replacements: Array<{
      target: string;
      replacement: string;
      start_line?: number;
      end_line?: number;
      allow_multiple?: boolean;
    }>,
  ): Promise<{ path: string; size: number }> {
    return this.json("POST", "/files/replace", { body: { path, replacements } });
  }

  async listFiles(directory: string): Promise<{ dir: string; entries: ListEntry[] }> {
    return this.json("GET", "/files/list", { query: { directory } });
  }

  async grep(args: {
    query: string;
    path?: string;
    regex?: boolean;
    case_insensitive?: boolean;
    include?: string[];
    match_per_line?: boolean;
    max_results?: number;
  }): Promise<{ query: string; path: string; matches: unknown[]; truncated: boolean }> {
    return this.json("GET", "/files/grep", { query: args });
  }

  async glob(args: {
    pattern: string;
    path?: string;
    exclude?: string[];
    type?: string;
    max_results?: number;
  }): Promise<{ pattern: string; path: string; matches: unknown[]; truncated: boolean }> {
    return this.json("GET", "/files/glob", { query: args });
  }

  async mkdir(path: string): Promise<{ path: string }> {
    return this.json("POST", "/files/mkdir", { body: { path } });
  }

  async delete(path: string): Promise<{ path: string; type: string }> {
    return this.json("DELETE", "/files/delete", { query: { path } });
  }

  async move(source: string, destination: string): Promise<{ source: string; destination: string }> {
    return this.json("POST", "/files/move", { body: { source, destination } });
  }

  // -- Working directory -----------------------------------------------------

  async getCwd(): Promise<{ cwd: string; home: string; root?: { path: string; label: string } }> {
    return this.json("GET", "/files/cwd");
  }

  async setCwd(path: string): Promise<{ cwd: string }> {
    return this.json("POST", "/files/cwd", { body: { path } });
  }

  // -- Upload ----------------------------------------------------------------

  /**
   * Upload a file via multipart/form-data. The body is built manually to
   * avoid a form-data dependency and to keep control over the filename.
   */
  async upload(directory: string, filename: string, bytes: Uint8Array): Promise<{ path: string; size: number }> {
    const boundary = `----mcp${Math.random().toString(16).slice(2)}`;
    const head = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename.replace(/"/g, "")}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([head, Buffer.from(bytes), tail]);
    const res = await this.fetchRaw("POST", "/files/upload", {
      query: { directory },
      rawBody: {
        bytes: body,
        contentType: `multipart/form-data; boundary=${boundary}`,
      },
    });
    return (await res.json()) as { path: string; size: number };
  }
}
