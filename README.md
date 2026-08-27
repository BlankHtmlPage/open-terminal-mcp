# open-terminal-mcp

remote mcp server that exposes [open terminal](https://github.com/open-webui/open-terminal) as 17 mcp tools over streamable http.

[![ci](https://github.com/BlankHtmlPage/open-terminal-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/BlankHtmlPage/open-terminal-mcp/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)
[![status](https://img.shields.io/badge/status-alpha-orange.svg)](https://github.com/BlankHtmlPage/open-terminal-mcp)

> [!WARNING]
> this bridge grants arbitrary command execution on the open terminal host. anyone holding `MCP_AUTH_TOKEN` has the equivalent of a shell account. it binds `127.0.0.1` by default — keep it there unless you front it with tls and a reverse proxy. there is no path confinement in this layer by design, because `run_command` already grants full shell.

## what it is

open terminal is a self-hosted remote shell with a rest api. this server is the mcp bridge that lets any mcp client drive it over streamable http. it holds no shell itself — it delegates every command and file operation to the upstream open terminal instance.

you run one stateless process, put it behind any load balancer, and connect clients with a bearer token.

## tools

all 17 tools are thin wrappers around `src/tools/` registrations. errors map to `isError` results.

### commands

| tool | what it does |
| --- | --- |
| `run_command` | run a shell command on the open terminal host in the background. returns a command id plus any output captured during the optional wait window. poll with `get_command_status`. supports chaining (`&&`, `||`, `;`), pipes, and redirections. |
| `get_command_status` | get status and new output for a background command. pass `next_offset` from a previous response to fetch only incremental output. returns the process status (`running`/`done`/`killed`) and exit code. |
| `send_command_input` | write text to a running command's stdin. include newline characters as needed. use this to answer prompts, page through pagers, or drive interactive clis. ctrl-c can be sent as `\x03`. |
| `kill_command` | terminate a running command. sends `SIGTERM` by default for graceful shutdown. set `force` to true to send `SIGKILL`. |
| `list_commands` | list all tracked background commands on the open terminal host, including running, done, and killed. |

### files

| tool | what it does |
| --- | --- |
| `read_file` | read a file and return its contents. text files return their content (optionally a line range). image files (`PNG`, `JPEG`, `WebP`) are returned as image content blocks you can view directly. |
| `write_file` | write text content to a file. creates parent directories automatically. overwrites if the file already exists. |
| `edit_file` | find and replace exact strings in a file. supports multiple replacements in one call with optional line-range narrowing. errors if a target is not found or is ambiguous, unless `allow_multiple` is set. |
| `list_files` | list files and directories at a path. returns a structured listing with names, types, sizes, and modification times. |
| `make_directory` | create a directory. parent directories are created automatically. |
| `delete_path` | delete a file or directory. directories are removed recursively. |
| `move_path` | move or rename a file or directory. errors if the source does not exist or the destination already exists. |

### search

| tool | what it does |
| --- | --- |
| `search_content` | search for a text or regex pattern across files in a directory. returns matches with file paths, line numbers, and matching lines. skips binary files. |
| `find_by_name` | search for files and subdirectories by name using glob patterns within a directory. returns relative path, type, size, and modification time. |

### session

| tool | what it does |
| --- | --- |
| `get_working_directory` | get the current working directory tracked for this mcp server session, plus the home directory and (if configured) the visual file-browser root. |
| `set_working_directory` | change the working directory used by subsequent commands and file operations in this session. the directory must exist. |

### upload

| tool | what it does |
| --- | --- |
| `upload_file` | upload bytes to a path on the open terminal host. content is base64-encoded. the filename is derived from the provided filename and placed under the given directory. |

## quickstart

```bash
git clone https://github.com/BlankHtmlPage/open-terminal-mcp.git
cd open-terminal-mcp
npm ci
cp .env.example .env
# edit .env — set OPEN_TERMINAL_URL, OPEN_TERMINAL_API_KEY, MCP_AUTH_TOKEN
npm run build
npm start
```

health check (no auth):

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

## configuration

all settings are environment variables. none are read from a file at runtime — use your process manager or `.env` for local dev (not committed). derived from `src/config.ts`.

| variable | required | default | description |
| --- | --- | --- | --- |
| `OPEN_TERMINAL_URL` | yes | — | base url of the open terminal rest api. trailing slash stripped. |
| `OPEN_TERMINAL_API_KEY` | yes | — | forwarded as `Authorization: Bearer` to open terminal. held in process memory only, never logged. |
| `MCP_AUTH_TOKEN` | yes | — | shared secret clients must present. min 32 chars. anyone holding it has shell access — generate with `openssl rand -hex 32`. |
| `PORT` | no | `3000` | http port to listen on. |
| `MCP_BIND_HOST` | no | `127.0.0.1` | interface to bind. default loopback. changing it to `0.0.0.0` exposes a shell bridge beyond localhost — only do this behind tls and a reverse proxy. |
| `OPEN_TERMINAL_TIMEOUT_MS` | no | `30000` | outbound fetch timeout to open terminal, in milliseconds. |
| `MCP_CORS_ORIGIN` | no | `*` | value of `Access-Control-Allow-Origin`. set to your origin in production. |
| `OPEN_TERMINAL_USER_ID` | no | — | `X-User-Id` for open terminal multi-user mode. |
| `OPEN_TERMINAL_SESSION_ID` | no | `mcp-<random>` | stable `X-Session-Id` so open terminal remembers this server's cwd. |

## client configuration

every client needs the server url and the bearer token. use a placeholder like `YOUR_TOKEN_HERE` — never paste a real token into a config file you commit.

generic `mcp.json` (streamable http, bearer auth):

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

claude desktop (`claude_desktop_config.json`):

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

for cursor: settings → mcp → add a remote server with url `http://localhost:3000/mcp` and header `Authorization: Bearer YOUR_TOKEN_HERE`.

## docker

build:

```bash
podman build -t open-terminal-mcp .
# or: docker build -t open-terminal-mcp .
```

run alongside open terminal. when the mcp server itself runs in a container, `localhost` means the container, so point `OPEN_TERMINAL_URL` at the host gateway. find it with:

```bash
podman run --rm alpine ip route | awk '/default/ {print $3}'
```

typical value is `10.0.2.2` (rootless podman) or `172.17.0.1` (docker). then:

```bash
podman run -d --name open-terminal-mcp --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -e OPEN_TERMINAL_URL=http://10.0.2.2:8000 \
  -e OPEN_TERMINAL_API_KEY=YOUR_OPEN_TERMINAL_KEY \
  -e MCP_AUTH_TOKEN=YOUR_TOKEN_HERE \
  localhost/open-terminal-mcp
```

put both containers on the same podman network instead and use the open terminal container name as the host. the image runs as non-root (`USER node`), contains no secrets, and the healthcheck hits `/health` without a token.

## architecture

stateless streamable http (mcp protocol `2025-03-26`). one express app, three layers:

- `src/config.ts` — validates env at boot, exits with a clear message on missing config.
- `src/open-terminal-client.ts` — typed `fetch` wrapper around the open terminal rest api. one shared instance; sends `Authorization`, `X-Session-Id`, `X-User-Id` on every call.
- `src/tools/` — 17 mcp tools, each wrapping one client method. errors map to `isError` results; image reads return image content blocks.

each `POST /mcp` request builds a fresh `McpServer`, connects a one-shot `StreamableHTTPServerTransport` (`sessionIdGenerator: undefined`), and lets it handle the request. no session state is held between requests, so the server scales behind any load balancer with no affinity.

auth is the whole security model for this layer. the bearer token check is constant-time, but there is no rate limiting in-process by design — the server binds loopback by default, and any public exposure must be behind a reverse proxy that provides tls and throttling. path handling is not confined here either: `read_file`, `write_file`, and `delete_path` forward their `path` verbatim to open terminal, because `run_command` already grants full shell. the real confinement boundary is the upstream open terminal host — its filesystem, its user, its container.

## development

```bash
npm run dev       # tsx watch, restarts on change
npm run build     # tsc — compiles to dist/
npm run typecheck # tsc --noEmit
npm test          # node:test, mocked fetch + tool dispatch + http auth boundary
```

live smoke test against a running open terminal (set `OPEN_TERMINAL_URL` and `OPEN_TERMINAL_API_KEY` in the environment first):

```bash
npx tsx scripts/smoke.ts
```

## links

- [security policy](SECURITY.md) — how to report vulnerabilities and the threat model
- [contributing guide](CONTRIBUTING.md) — dev setup and pull request expectations
- [code of conduct](CODE_OF_CONDUCT.md) — contributor covenant 2.1
- [changelog](CHANGELOG.md) — version history
- [license](LICENSE) — mit

