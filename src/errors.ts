/**
 * Error type for non-2xx responses from the Open Terminal REST API.
 * The `detail` matches FastAPI's standard error body: either a string
 * (from `{"detail": "..."}`) or the raw body when it does not parse.
 */
export class OpenTerminalError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(`Open Terminal ${status}: ${detail}`);
    this.name = "OpenTerminalError";
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Map any thrown error to an MCP tool result with `isError: true`.
 * Keeps the agent-facing message short and explicit.
 */
export function toMcpError(error: unknown): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  let text: string;
  if (error instanceof OpenTerminalError) {
    text = error.message;
  } else if (error instanceof Error) {
    // Node's fetch wraps network failures in a TypeError with a `.cause`
    // carrying the actual error code. Checking the code is more reliable
    // than parsing message strings.
    const cause = error as { cause?: { code?: string } };
    const code = cause.cause?.code;
    if (
      code === "ECONNREFUSED" ||
      code === "ENOTFOUND" ||
      code === "ECONNRESET" ||
      code === "EAI_AGAIN" ||
      code === "EPIPE"
    ) {
      text = `Open Terminal unreachable: ${code}`;
    } else if (code === "ABORT_ERR" || error.name === "TimeoutError") {
      text = `Open Terminal request timed out.`;
    } else {
      text = error.message;
    }
  } else {
    text = String(error);
  }
  return { content: [{ type: "text", text }], isError: true };
}
