import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OpenTerminalClient } from "../open-terminal-client.js";
import { toMcpError } from "../errors.js";

/** Register the nine filesystem tools on the given server. */
export function registerFileTools(server: McpServer, client: OpenTerminalClient): void {
  server.tool(
    "read_file",
    "Read a file and return its contents. Text files return their content (optionally a line range). Image files (PNG, JPEG, WebP) are returned as image content blocks you can view directly.",
    {
      path: z.string().describe("Path to the file to read."),
      start_line: z.number().min(1).optional().describe("First line to return (1-indexed, inclusive)."),
      end_line: z.number().min(1).optional().describe("Last line to return (1-indexed, inclusive)."),
    },
    async (args) => {
      try {
        const result = await client.readFile(args.path, { start_line: args.start_line, end_line: args.end_line });
        if (result.kind === "image") {
          const data = Buffer.from(result.bytes).toString("base64");
          return { content: [{ type: "image", data, mimeType: result.mime }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );

  server.tool(
    "write_file",
    "Write text content to a file. Creates parent directories automatically. Overwrites if the file already exists.",
    {
      path: z.string().describe("Path to write to. Parent directories are created automatically."),
      content: z.string().describe("Text content to write."),
    },
    async (args) => {
      try {
        const result = await client.writeFile(args.path, args.content);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );

  server.tool(
    "edit_file",
    "Find and replace exact strings in a file. Supports multiple replacements in one call with optional line-range narrowing. Errors if a target is not found or is ambiguous, unless allow_multiple is set.",
    {
      path: z.string().describe("Path to the file to modify."),
      replacements: z
        .array(
          z.object({
            target: z.string().describe("Exact string to find."),
            replacement: z.string().describe("Content to replace the target with."),
            start_line: z.number().min(1).optional().describe("Narrow the search to lines at or after this (1-indexed)."),
            end_line: z.number().min(1).optional().describe("Narrow the search to lines at or before this (1-indexed)."),
            allow_multiple: z.boolean().optional().describe("If true, replaces all occurrences. If false (default), errors when multiple matches are found."),
          }),
        )
        .describe("List of find-and-replace operations to apply sequentially."),
    },
    async (args) => {
      try {
        const result = await client.editFile(args.path, args.replacements);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );

  server.tool(
    "list_files",
    "List files and directories at a path. Returns a structured listing with names, types, sizes, and modification times.",
    {
      directory: z.string().default(".").describe("Directory path to list."),
    },
    async (args) => {
      try {
        const result = await client.listFiles(args.directory);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );

  server.tool(
    "search_content",
    "Search for a text or regex pattern across files in a directory. Returns matches with file paths, line numbers, and matching lines. Skips binary files.",
    {
      query: z.string().describe("Text or regex pattern to search for."),
      path: z.string().optional().describe("Directory or file to search in. Defaults to the session cwd."),
      regex: z.boolean().optional().describe("Use regex (default true). Set false for literal search."),
      case_insensitive: z.boolean().optional().describe("Perform case-insensitive matching."),
      include: z.array(z.string()).optional().describe("Glob patterns to filter files (e.g. '*.py'). Files must match at least one."),
      match_per_line: z.boolean().optional().describe("If true (default), return each matching line with line numbers. If false, return only matching file names."),
      max_results: z.number().min(1).max(500).optional().describe("Maximum matches to return (default 50)."),
    },
    async (args) => {
      try {
        const result = await client.grep(args);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );

  server.tool(
    "find_by_name",
    "Search for files and subdirectories by name using glob patterns within a directory. Returns relative path, type, size, and modification time.",
    {
      pattern: z.string().describe("Glob pattern to search for (e.g. '*.py')."),
      path: z.string().optional().describe("Directory to search within. Defaults to the session cwd."),
      exclude: z.array(z.string()).optional().describe("Glob patterns to exclude from results."),
      type: z.enum(["file", "directory", "any"]).optional().describe("Type filter (default 'any')."),
      max_results: z.number().min(1).max(500).optional().describe("Maximum matches to return (default 50)."),
    },
    async (args) => {
      try {
        const result = await client.glob(args);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );

  server.tool(
    "make_directory",
    "Create a directory. Parent directories are created automatically.",
    {
      path: z.string().describe("Directory path to create."),
    },
    async (args) => {
      try {
        const result = await client.mkdir(args.path);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );

  server.tool(
    "delete_path",
    "Delete a file or directory. Directories are removed recursively.",
    {
      path: z.string().describe("Path to delete."),
    },
    async (args) => {
      try {
        const result = await client.delete(args.path);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );

  server.tool(
    "move_path",
    "Move or rename a file or directory. Errors if the source does not exist or the destination already exists.",
    {
      source: z.string().describe("Path to the file or directory to move."),
      destination: z.string().describe("Destination path."),
    },
    async (args) => {
      try {
        const result = await client.move(args.source, args.destination);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );
}
