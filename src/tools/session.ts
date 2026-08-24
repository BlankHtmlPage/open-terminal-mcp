import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OpenTerminalClient } from "../open-terminal-client.js";
import { toMcpError } from "../errors.js";

/** Register the working-directory tools on the given server. */
export function registerSessionTools(server: McpServer, client: OpenTerminalClient): void {
  server.tool(
    "get_working_directory",
    "Get the current working directory tracked for this MCP server session, plus the home directory and (if configured) the visual file-browser root.",
    {},
    async () => {
      try {
        const result = await client.getCwd();
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );

  server.tool(
    "set_working_directory",
    "Change the working directory used by subsequent commands and file operations in this session. The directory must exist.",
    {
      path: z.string().describe("Directory to switch to."),
    },
    async (args) => {
      try {
        const result = await client.setCwd(args.path);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );
}
