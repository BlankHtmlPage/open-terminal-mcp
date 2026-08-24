import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OpenTerminalClient } from "../open-terminal-client.js";
import { toMcpError } from "../errors.js";

/** Register the file upload tool on the given server. */
export function registerUploadTool(server: McpServer, client: OpenTerminalClient): void {
  server.tool(
    "upload_file",
    "Upload bytes to a path on the Open Terminal host. Content is base64-encoded. The filename is derived from the provided filename and placed under the given directory.",
    {
      directory: z.string().describe("Destination directory for the file."),
      filename: z.string().describe("Name of the file (e.g. 'report.csv')."),
      content_base64: z.string().describe("File contents, base64-encoded."),
    },
    async (args) => {
      try {
        const bytes = Buffer.from(args.content_base64, "base64");
        const result = await client.upload(args.directory, args.filename, new Uint8Array(bytes));
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );
}
