/**
 * Live smoke test against a running Open Terminal instance.
 *
 * Verifies the real client + REST wiring end to end: runs `echo hello`, reads
 * the result, and asserts the captured output contains "hello".
 *
 * Requires a running Open Terminal reachable at OPEN_TERMINAL_URL. Does NOT
 * hit the MCP server — it exercises the OpenTerminalClient directly, which is
 * the layer most likely to drift from the real API.
 *
 * Usage:
 *   OPEN_TERMINAL_URL=http://localhost:8000 \
 *   OPEN_TERMINAL_API_KEY=bk_... \
 *   npx tsx scripts/smoke.ts
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenTerminalClient } from "../src/open-terminal-client.ts";

const url = process.env.OPEN_TERMINAL_URL?.replace(/\/+$/, "");
const apiKey = process.env.OPEN_TERMINAL_API_KEY;

if (!url || !apiKey) {
  process.stderr.write(
    "OPEN_TERMINAL_URL and OPEN_TERMINAL_API_KEY must be set.\n",
  );
  process.exit(2);
}

const client = new OpenTerminalClient({
  baseUrl: url,
  apiKey,
  sessionId: `smoke-${Date.now()}`,
  timeoutMs: 30000,
});

let failures = 0;
function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    process.stdout.write(`  ok  - ${label}\n`);
  } else {
    failures++;
    process.stdout.write(`  FAIL- ${label}${detail ? ` :: ${detail}` : ""}\n`);
  }
}

async function main(): Promise<void> {
  process.stdout.write(`smoke against ${url}\n`);

  // 1. Run a command and wait briefly for output.
  process.stdout.write("run_command: echo hello\n");
  const proc = await client.runCommand({ command: "echo hello", wait: 3 });
  check("command has an id", typeof proc.id === "string" && proc.id.length > 0);
  check("status is done or running", proc.status === "done" || proc.status === "running");

  // 2. Poll for completed output if it was still running.
  let status = proc;
  if (proc.status !== "done") {
    status = await client.getStatus(proc.id, { wait: 3 });
  }
  const output = JSON.stringify(status.output ?? "");
  check("output contains 'hello'", output.includes("hello"), output);

  // 3. Round-trip a file: write, read, delete.
  process.stdout.write("file round-trip\n");
  const testPath = join(tmpdir(), `smoke-${Date.now()}.txt`);
  await client.writeFile(testPath, "smoke-payload");
  const read = await client.readFile(testPath);
  if (read.kind === "text") {
    check("written file reads back its content", read.content === "smoke-payload", read.content);
  } else {
    check("written file reads back as text", false, `got kind=${read.kind}`);
  }
  await client.delete(testPath);

  // 4. Working directory.
  process.stdout.write("working directory\n");
  const cwd = await client.getCwd();
  check("getCwd returns a path", typeof cwd.cwd === "string" && cwd.cwd.length > 0);

  process.stdout.write(failures === 0 ? "\nall checks passed\n" : `\n${failures} check(s) failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`smoke crashed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
