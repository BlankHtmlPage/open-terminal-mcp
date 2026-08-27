# open-terminal-mcp

Remote MCP server that exposes [Open Terminal](https://github.com/open-webui/open-terminal) as 17 MCP tools over Streamable HTTP.

[![ci](https://github.com/BlankHtmlPage/open-terminal-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/BlankHtmlPage/open-terminal-mcp/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)
[![status](https://img.shields.io/badge/status-alpha-orange.svg)](https://github.com/BlankHtmlPage/open-terminal-mcp)

> [!WARNING]
> This bridge grants arbitrary command execution on the Open Terminal host. Anyone holding `MCP_AUTH_TOKEN` has the equivalent of a shell account. It binds `127.0.0.1` by default — keep it there unless you front it with TLS and a reverse proxy. There is no path confinement in this layer by design, because `run_command` already grants full shell.

## What it is

Open Terminal is a self-hosted remote shell with a REST API. This server is the MCP bridge that lets any MCP client drive it over Streamable HTTP. It holds no shell itself — it delegates every command and file operation to the upstream Open Terminal instance.

You run one stateless process, put it behind any load balancer, and connect clients with a bearer token.

## Tools

All 17 tools are thin wrappers around `src/tools/` registrations. Errors map to `isError` results.

### Commands

| Tool | What it does |
| --- | --- |
| `run_command` | Run a shell command on the Open Terminal host in the background. Returns a command id plus any output captured during the optional wait window. Poll with `get_command_status`. Supports chaining (`&&`, `||`, `;`), pipes, and redirections. |
| `get_command_status` | Get status and new output for a background command. Pass `next_offset` from a previous response to fetch only incremental output. Returns the process status (`running`/`done`/`killed`) and exit code. |
| `send_command_input` | Write text to a running command's stdin. Include newline characters as needed. Use this to answer prompts, page through pagers, or drive interactive CLIs. Ctrl-C can be sent as `\x03`. |
| `kill_command` | Terminate a running command. Sends `SIGTERM` by default for graceful shutdown. Set `force` to true to send `SIGKILL`. |
| `list_commands` | List all tracked background commands on the Open Terminal host, including running, done, and killed. |

### Files

| Tool | What it does |
| --- | --- |
| `read_file` | Read a file and return its contents. Text files return their content (optionally a line range). Image files (`PNG`, `JPEG`, `WebP`) are returned as image content blocks you can view directly. |
| `write_file` | Write text content to a file. Creates parent directories automatically. Overwrites if the file already exists. |
| `edit_file` | Find and replace exact strings in a file. Supports multiple replacements in one call with optional line-range narrowing. Errors if a target is not found or is ambiguous, unless `allow_multiple` is set. |
| `list_files` | List files and directories at a path. Returns a structured listing with names, types, sizes, and modification times. |
| `make_directory` | Create a directory. Parent directories are created automatically. |
| `delete_path` | Delete a file or directory. Directories are removed recursively. |
| `move_path` | Move or rename a file or directory. Errors if the source does not exist or the destination already exists. |

### Search

| Tool | What it does |
| --- | --- |
| `search_content` | Search for a text or regex pattern across files in a directory. Returns matches with file paths, line numbers, and matching lines. Skips binary files. |
| `find_by_name` | Search for files and subdirectories by name using glob patterns within a directory. Returns relative path, type, size, and modification time. |

### Session

| Tool | What it does |
| --- | --- |
| `get_working_directory` | Get the current working directory tracked for this MCP server session, plus the home directory and (if configured) the visual file-browser root. |
| `set_working_directory` | Change the working directory used by subsequent commands and file operations in this session. The directory must exist. |

### Upload

| Tool | What it does |
| --- | --- |
| `upload_file` | Upload bytes to a path on the Open Terminal host. Content is base64-encoded. The filename is derived from the provided filename and placed under the given directory. |

## Quickstart

```bash
git clone https://github.com/BlankHtmlPage/open-terminal-mcp.git
cd open-terminal-mcp
npm ci
cp .env.example .env
# Edit .env — set OPEN_TERMINAL_URL, OPEN_TERMINAL_API_KEY, MCP_AUTH_TOKEN
npm run build
npm start
```

Health check (no auth):

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

## Configuration

All settings are environment variables. None are read from a file at runtime — use your process manager or `.env` for local dev (not committed). Derived from `src/config.ts`.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `OPEN_TERMINAL_URL` | Yes | — | Base URL of the Open Terminal REST API. Trailing slash stripped. |
| `OPEN_TERMINAL_API_KEY` | Yes | — | Forwarded as `Authorization: Bearer` to Open Terminal. Held in process memory only, never logged. |
| `MCP_AUTH_TOKEN` | Yes | — | Shared secret clients must present. Min 32 chars. Anyone holding it has shell access — generate with `openssl rand -hex 32`. |
| `PORT` | No | `3000` | HTTP port to listen on. |
| `MCP_BIND_HOST` | No | `127.0.0.1` | Interface to bind. Default loopback. Changing it to `0.0.0.0` exposes a shell bridge beyond localhost — only do this behind TLS and a reverse proxy. |
| `OPEN_TERMINAL_TIMEOUT_MS` | No | `30000` | Outbound fetch timeout to Open Terminal, in milliseconds. |
| `MCP_CORS_ORIGIN` | No | `*` | Value of `Access-Control-Allow-Origin`. Set to your origin in production. |
| `OPEN_TERMINAL_USER_ID` | No | — | `X-User-Id` for Open Terminal multi-user mode. |
| `OPEN_TERMINAL_SESSION_ID` | No | `mcp-<random>` | Stable `X-Session-Id` so Open Terminal remembers this server's cwd. |

## Client configuration

Every client needs the server URL and the bearer token. Use a placeholder like `YOUR_TOKEN_HERE` — never paste a real token into a config file you commit.

Generic `mcp.json` (Streamable HTTP, bearer auth):

```json
{
  "mcpServers": {
    "open-terminal": {
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN_HERE"
      }
    }
  }
}
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "open-terminal": {
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN_HERE"
      }
    }
  }
}
```

For Cursor: Settings → MCP → add a remote server with URL `http://localhost:3000/mcp` and header `Authorization: Bearer YOUR_TOKEN_HERE`.

## Docker

Build:

```bash
podman build -t open-terminal-mcp .
# or: docker build -t open-terminal-mcp .
```

Run alongside Open Terminal. When the MCP server itself runs in a container, `localhost` means the container, so point `OPEN_TERMINAL_URL` at the host gateway. Find it with:

```bash
podman run --rm alpine ip route | awk '/default/ {print $3}'
```

Typical value is `10.0.2.2` (rootless Podman) or `172.17.0.1` (Docker). Then:

```bash
podman run -d --name open-terminal-mcp --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -e OPEN_TERMINAL_URL=http://10.0.2.2:8000 \
  -e OPEN_TERMINAL_API_KEY=YOUR_OPEN_TERMINAL_KEY \
  -e MCP_AUTH_TOKEN=YOUR_TOKEN_HERE \
  localhost/open-terminal-mcp
```

Put both containers on the same Podman network instead and use the Open Terminal container name as the host. The image runs as non-root (`USER node`), contains no secrets, and the healthcheck hits `/health` without a token.

## Architecture

Stateless Streamable HTTP (MCP protocol `2025-03-26`). One Express app, three layers:

- `src/config.ts` — Validates env at boot, exits with a clear message on missing config.
- `src/open-terminal-client.ts` — Typed `fetch` wrapper around the Open Terminal REST API. One shared instance; sends `Authorization`, `X-Session-Id`, `X-User-Id` on every call.
- `src/tools/` — 17 MCP tools, each wrapping one client method. Errors map to `isError` results; image reads return image content blocks.

Each `POST /mcp` request builds a fresh `McpServer`, connects a one-shot `StreamableHTTPServerTransport` (`sessionIdGenerator: undefined`), and lets it handle the request. No session state is held between requests, so the server scales behind any load balancer with no affinity.

Auth is the whole security model for this layer. The bearer token check is constant-time, but there is no rate limiting in-process by design — the server binds loopback by default, and any public exposure must be behind a reverse proxy that provides TLS and throttling. Path handling is not confined here either: `read_file`, `write_file`, and `delete_path` forward their `path` verbatim to Open Terminal, because `run_command` already grants full shell. The real confinement boundary is the upstream Open Terminal host — its filesystem, its user, its container.

## Development

```bash
npm run dev       # tsx watch, restarts on change
npm run build     # tsc — compiles to dist/
npm run typecheck # tsc --noEmit
npm test          # node:test, mocked fetch + tool dispatch + HTTP auth boundary
```

Live smoke test against a running Open Terminal (set `OPEN_TERMINAL_URL` and `OPEN_TERMINAL_API_KEY` in the environment first):

```bash
npx tsx scripts/smoke.ts
```

## Funding

If this project is useful, you can support it at <https://bhp.qzz.io/donate/>.

## Links

- [Security Policy](SECURITY.md) — How to report vulnerabilities and the threat model
- [Contributing Guide](CONTRIBUTING.md) — Dev setup and pull request expectations
- [Code of Conduct](CODE_OF_CONDUCT.md) — Contributor Covenant 2.1
- [Changelog](CHANGELOG.md) — Version history
- [License](LICENSE) — MIT
