# changelog

all notable changes to this project will be documented in this file.

the format is based on [keep a changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [unreleased]

## [1.0.0] - 2026-08-27

initial public release.

### added

- 17 mcp tools over streamable http (`POST /mcp` stateless, `GET /health` unauthenticated) — commands (`run_command`, `get_command_status`, `send_command_input`, `kill_command`, `list_commands`), files (`read_file`, `write_file`, `edit_file`, `list_files`, `make_directory`, `delete_path`, `move_path`), search (`search_content`, `find_by_name`), session (`get_working_directory`, `set_working_directory`), and upload (`upload_file`).
- bearer auth with constant-time comparison (`MCP_AUTH_TOKEN`), required on every `POST /mcp` request.
- loopback-by-default bind (`MCP_BIND_HOST` defaults to `127.0.0.1`) with a startup warning when bound beyond localhost.
- 32-character minimum for `MCP_AUTH_TOKEN` (fail-closed at boot).
- docker image (`Dockerfile`) running as non-root (`USER node`), no secrets baked into layers, healthcheck hits `/health` without a token.
- typed open terminal client (`src/open-terminal-client.ts`) with timeout and session pinning.
- configuration via environment variables validated at boot (`src/config.ts`).
