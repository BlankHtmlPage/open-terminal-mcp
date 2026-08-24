# open-terminal-mcp

A remote **Model Context Protocol** server that exposes [Open Terminal](https://github.com/open-webui/open-terminal) as MCP tools over Streamable HTTP. Open Terminal is a self-hosted remote shell with a REST API; this server is the MCP bridge that lets any MCP client (Claude Desktop, Cursor, Open WebUI, etc.) drive it.

## Why

Open Terminal ships a `mcp_server.py`, but it is stdio-only and not exposed over the network (see [open-webui/open-terminal#66](https://github.com/open-webui/open-terminal/discussions/66)). This project is the missing remote MCP layer: stateless Streamable HTTP, bearer-token auth, one process you can put behind any load balancer.

## What it exposes

17 tools, one per Open Terminal capability:

| Tool | What it does |
| --- | --- |
| `run_command` | Run a shell command in the background, optionally waiting for output. |
| `get_command_status` | Poll a running command for status and incremental output. |
| `send_command_input` | Write to a running command's stdin. |
| `kill_command` | Terminate a running command (SIGTERM or SIGKILL). |
| `list_commands` | List all tracked background commands. |
| `read_file` | Read a text file (with optional line range) or an image. |
| `write_file` | Write text to a file (creates parent dirs). |
| `edit_file` | Find-and-replace exact strings in a file. |
| `list_files` | List directory contents. |
| `search_content` | Grep across files (regex or literal). |
| `find_by_name` | Glob-search files by name. |
| `make_directory` | Create a directory. |
| `delete_path` | Delete a file or directory. |
| `move_path` | Move or rename a file or directory. |
| `get_working_directory` | Get the session's current working directory. |
| `set_working_directory` | Change the session's working directory. |
| `upload_file` | Upload base64-encoded bytes to a path. |

## Requirements

- Node.js 20+ (built and tested on 24)
- A running Open Terminal instance (Docker/Podman or bare metal)

## Quickstart (bare metal)

```bash
npm install
npm run build
```

Run it:

```bash
OPEN_TERMINAL_URL=http://localhost:8000 \
OPEN_TERMINAL_API_KEY=your-open-terminal-key \
MCP_AUTH_TOKEN=generate-a-long-random-secret \
npm start
```

Health check (no auth):

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

## Quickstart (Podman / Docker)

Build:

```bash
podman build -t open-terminal-mcp .
```

Run alongside Open Terminal. When the MCP server itself runs in a container, `localhost` means the container, so point `OPEN_TERMINAL_URL` at the host gateway. Find it with:

```bash
podman run --rm alpine ip route | awk '/default/ {print $3}'
```

Typical value is `10.0.2.2` (rootless podman) or `172.17.0.1` (Docker). Then:

```bash
podman run -d --name open-terminal-mcp --restart unless-stopped \
  -p 3000:3000 \
  -e OPEN_TERMINAL_URL=http://10.0.2.2:8000 \
  -e OPEN_TERMINAL_API_KEY=your-open-terminal-key \
  -e MCP_AUTH_TOKEN=generate-a-long-random-secret \
  localhost/open-terminal-mcp
```

Put both containers on the same Podman network instead and use the Open Terminal container name as the host.

## Connect an MCP client

Every client needs the server URL and the bearer token.

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "open-terminal": {
      "url": "http://localhost:3000/mcp",
      "headers": { "Authorization": "Bearer your-mcp-auth-token" }
    }
  }
}
```

**Cursor** (Settings → MCP): add a remote server with URL `http://localhost:3000/mcp` and header `Authorization: Bearer your-mcp-auth-token`.

## Configuration

All settings are environment variables. None are read from a file at runtime; use your process manager or `.env` for local dev (not committed).

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `OPEN_TERMINAL_URL` | yes | — | Base URL of the Open Terminal REST API. Trailing slash stripped. |
| `OPEN_TERMINAL_API_KEY` | yes | — | Forwarded as `Authorization: Bearer` to Open Terminal. |
| `MCP_AUTH_TOKEN` | yes | — | Shared secret clients must present. Min 16 chars. |
| `PORT` | no | `3000` | HTTP port to listen on. |
| `OPEN_TERMINAL_TIMEOUT_MS` | no | `30000` | Outbound fetch timeout to Open Terminal. |
| `MCP_CORS_ORIGIN` | no | `*` | Value of `Access-Control-Allow-Origin`. |
| `OPEN_TERMINAL_USER_ID` | no | — | `X-User-Id` for Open Terminal multi-user mode. |
| `OPEN_TERMINAL_SESSION_ID` | no | `mcp-<random>` | Stable `X-Session-Id` so Open Terminal remembers this server's cwd. |

## Development

```bash
npm run dev       # tsx watch, restarts on change
npm test          # node:test, mocked fetch + tool dispatch
npm run typecheck # tsc --noEmit
```

Live smoke test against a running Open Terminal (set `OPEN_TERMINAL_URL` and `OPEN_TERMINAL_API_KEY` in the environment first):

```bash
npx tsx scripts/smoke.ts
```

## Architecture

Stateless Streamable HTTP (MCP protocol `2025-03-26`). One Express app, three layers:

1. **`src/config.ts`** — validates env at boot, exits with a clear message on missing config.
2. **`src/open-terminal-client.ts`** — typed `fetch` wrapper around the Open Terminal REST API. One shared instance; sends `Authorization`, `X-Session-Id`, `X-User-Id` on every call.
3. **`src/tools/`** — 17 MCP tools, each wrapping one client method. Errors map to `isError` results; image reads return image content blocks.

Each POST `/mcp` request builds a fresh `McpServer`, connects a one-shot `StreamableHTTPServerTransport` (`sessionIdGenerator: undefined`), and lets it handle the request. No session state is held between requests, so the server scales behind any load balancer with no affinity.

## Security notes

- The server grants shell execution on the Open Terminal host. Treat the `MCP_AUTH_TOKEN` as a capability: anyone who holds it can run arbitrary commands on that host. Generate a long random secret and transport it only over TLS in production.
- Bearer comparison is constant-time. CORS is permissive by default (`*`); set `MCP_CORS_ORIGIN` to your origin in production.
- The Open Terminal API key is held in process memory and forwarded only to Open Terminal. It never appears in logs.

## License

MIT
