import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/index.ts";
import { OpenTerminalClient } from "../src/open-terminal-client.ts";
import { OpenTerminalError } from "../src/errors.ts";
import { TOOL_COUNT } from "../src/tools/index.ts";

/**
 * Tool dispatch tests. A real MCP Client talks to the McpServer over an
 * in-memory transport, so tools are exercised through the full SDK path
 * (schema validation, dispatch, result mapping) without any HTTP.
 *
 * The OpenTerminalClient is replaced with a stub that records calls and can
 * be made to throw, so no network is involved.
 */

type StubAction = (method: string, ...args: unknown[]) => unknown;

function makeStubClient(action: StubAction): OpenTerminalClient {
  const stub = {
    runCommand: (...a: unknown[]) => action("runCommand", ...a),
    getStatus: (...a: unknown[]) => action("getStatus", ...a),
    sendInput: (...a: unknown[]) => action("sendInput", ...a),
    kill: (...a: unknown[]) => action("kill", ...a),
    list: (...a: unknown[]) => action("list", ...a),
    readFile: (...a: unknown[]) => action("readFile", ...a),
    writeFile: (...a: unknown[]) => action("writeFile", ...a),
    editFile: (...a: unknown[]) => action("editFile", ...a),
    listFiles: (...a: unknown[]) => action("listFiles", ...a),
    grep: (...a: unknown[]) => action("grep", ...a),
    glob: (...a: unknown[]) => action("glob", ...a),
    mkdir: (...a: unknown[]) => action("mkdir", ...a),
    delete: (...a: unknown[]) => action("delete", ...a),
    move: (...a: unknown[]) => action("move", ...a),
    getCwd: (...a: unknown[]) => action("getCwd", ...a),
    setCwd: (...a: unknown[]) => action("setCwd", ...a),
    upload: (...a: unknown[]) => action("upload", ...a),
  };
  return stub as unknown as OpenTerminalClient;
}

/** Wire a stub-backed McpServer to a real Client over an in-memory transport. */
async function connect(clientImpl: OpenTerminalClient): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  const server = createServer(clientImpl);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); } };
}

const EXPECTED_TOOLS = [
  "run_command",
  "get_command_status",
  "send_command_input",
  "kill_command",
  "list_commands",
  "read_file",
  "write_file",
  "edit_file",
  "list_files",
  "search_content",
  "find_by_name",
  "make_directory",
  "delete_path",
  "move_path",
  "get_working_directory",
  "set_working_directory",
  "upload_file",
];

describe("tool registration", () => {
  it("registers exactly the expected set of tools", async () => {
    const { client, close } = await connect(makeStubClient(() => ({})));
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      assert.equal(names.length, TOOL_COUNT);
      assert.equal(names.length, EXPECTED_TOOLS.length);
      for (const name of EXPECTED_TOOLS) {
        assert.ok(names.includes(name), `missing tool: ${name}`);
      }
    } finally {
      await close();
    }
  });
});

describe("tool dispatch — success", () => {
  it("run_command forwards args to the client and returns JSON text content", async () => {
    let captured: unknown;
    const stub = makeStubClient((method, ...args) => {
      captured = { method, args };
      return { id: "p1", command: "echo hi", status: "done", exit_code: 0 };
    });
    const { client, close } = await connect(stub);
    try {
      const result = await client.callTool({ name: "run_command", arguments: { command: "echo hi" } });
      assert.deepEqual(captured, { method: "runCommand", args: [{ command: "echo hi" }] });
      const content = result.content as Array<{ type: string; text: string }>;
      assert.equal(content[0]!.type, "text");
      assert.deepEqual(JSON.parse(content[0]!.text), { id: "p1", command: "echo hi", status: "done", exit_code: 0 });
    } finally {
      await close();
    }
  });

  it("read_file returns an image content block when the client returns an image kind", async () => {
    const stub = makeStubClient(() => ({
      kind: "image",
      mime: "image/png",
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    }));
    const { client, close } = await connect(stub);
    try {
      const result = await client.callTool({ name: "read_file", arguments: { path: "/x.png" } });
      const content = result.content as Array<{ type: string; data: string; mimeType: string }>;
      assert.equal(content[0]!.type, "image");
      assert.equal(content[0]!.mimeType, "image/png");
      assert.equal(content[0]!.data, "iVBORw==");
    } finally {
      await close();
    }
  });

  it("upload_file decodes base64 and forwards bytes to the client", async () => {
    let captured: unknown;
    const stub = makeStubClient((method, ...args) => {
      captured = { method, args };
      return { path: "/d/f.bin", size: 3 };
    });
    const { client, close } = await connect(stub);
    try {
      await client.callTool({
        name: "upload_file",
        arguments: { directory: "/d", filename: "f.bin", content_base64: "AAAA" }, // 3 zero bytes
      });
      const c = captured as { method: string; args: unknown[] };
      assert.equal(c.method, "upload");
      assert.equal(c.args[0], "/d");
      assert.equal(c.args[1], "f.bin");
      assert.deepEqual(Array.from(c.args[2] as Uint8Array), [0, 0, 0]);
    } finally {
      await close();
    }
  });
});

describe("tool dispatch — error", () => {
  it("maps an OpenTerminalError to an isError result", async () => {
    const stub = makeStubClient(() => {
      throw new OpenTerminalError(404, "File not found");
    });
    const { client, close } = await connect(stub);
    try {
      const result = await client.callTool({ name: "delete_path", arguments: { path: "/nope" } });
      assert.equal(result.isError, true);
      const content = result.content as Array<{ type: string; text: string }>;
      assert.match(content[0]!.text, /Open Terminal 404: File not found/);
    } finally {
      await close();
    }
  });
});
