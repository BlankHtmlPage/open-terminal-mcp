import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OpenTerminalClient } from "../open-terminal-client.js";
import { registerCommandTools } from "./commands.js";
import { registerFileTools } from "./files.js";
import { registerSessionTools } from "./session.js";
import { registerUploadTool } from "./upload.js";

/** Total number of tools registered by {@link registerAllTools}. */
export const TOOL_COUNT = 17;

/** Register every Open Terminal tool on the given server. */
export function registerAllTools(server: McpServer, client: OpenTerminalClient): void {
  registerCommandTools(server, client);
  registerFileTools(server, client);
  registerSessionTools(server, client);
  registerUploadTool(server, client);
}
