import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OpenTerminalClient } from "../open-terminal-client.js";
import { toMcpError } from "../errors.js";

/** Register the five command-execution tools on the given server. */
export function registerCommandTools(server: McpServer, client: OpenTerminalClient): void {
  server.tool(
    "run_command",
    "Run a shell command on the Open Terminal host in the background. Returns a command id plus any output captured during the optional wait window. Poll with get_command_status. Supports chaining (&&, ||, ;), pipes, and redirections.",
    {
      command: z.string().describe("Shell command to execute."),
      cwd: z.string().optional().describe("Working directory. Defaults to the session cwd."),
      env: z.record(z.string(), z.string()).optional().describe("Extra environment variables for the subprocess."),
      wait: z.number().min(0).max(300).optional().describe("Seconds to wait for the command to finish before returning. Output captured in the window is returned inline."),
      tail: z.number().min(1).optional().describe("Return only the last N output entries."),
    },
    async (args) => {
      try {
        const result = await client.runCommand(args);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );

  server.tool(
    "get_command_status",
    "Get status and new output for a background command. Pass the next_offset from a previous response to fetch only incremental output. Returns the process status (running/done/killed) and exit code.",
    {
      process_id: z.string().describe("Command id returned by run_command."),
      wait: z.number().min(0).max(300).optional().describe("Seconds to wait for the process to finish before returning."),
      offset: z.number().min(0).default(0).describe("Skip this many output entries. Use next_offset from the previous response."),
      tail: z.number().min(1).optional().describe("Return only the last N output entries."),
    },
    async (args) => {
      try {
        const result = await client.getStatus(args.process_id, args);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );

  server.tool(
    "send_command_input",
    "Write text to a running command's stdin. Include newline characters as needed. Use this to answer prompts, page through pagers, or drive interactive CLIs. Ctrl-C can be sent as \\x03.",
    {
      process_id: z.string().describe("Command id returned by run_command."),
      input: z.string().describe("Text to send to the process's stdin."),
    },
    async (args) => {
      try {
        const result = await client.sendInput(args.process_id, args.input);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );

  server.tool(
    "kill_command",
    "Terminate a running command. Sends SIGTERM by default for graceful shutdown. Set force to true to send SIGKILL.",
    {
      process_id: z.string().describe("Command id returned by run_command."),
      force: z.boolean().default(false).describe("Send SIGKILL instead of SIGTERM."),
    },
    async (args) => {
      try {
        const result = await client.kill(args.process_id, args.force);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );

  server.tool(
    "list_commands",
    "List all tracked background commands on the Open Terminal host, including running, done, and killed.",
    {},
    async () => {
      try {
        const result = await client.list();
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );
}
