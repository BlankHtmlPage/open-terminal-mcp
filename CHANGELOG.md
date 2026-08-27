# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-08-27

Initial public release.

### Added

- 17 MCP tools over Streamable HTTP (`POST /mcp` stateless, `GET /health` unauthenticated) — commands (`run_command`, `get_command_status`, `send_command_input`, `kill_command`, `list_commands`), files (`read_file`, `write_file`, `edit_file`, `list_files`, `make_directory`, `delete_path`, `move_path`), search (`search_content`, `find_by_name`), session (`get_working_directory`, `set_working_directory`), and upload (`upload_file`).
- Bearer auth with constant-time comparison (`MCP_AUTH_TOKEN`), required on every `POST /mcp` request.
- Loopback-by-default bind (`MCP_BIND_HOST` defaults to `127.0.0.1`) with a startup warning when bound beyond localhost.
- 32-character minimum for `MCP_AUTH_TOKEN` (fail-closed at boot).
- Docker image (`Dockerfile`) running as non-root (`USER node`), no secrets baked into layers, healthcheck hits `/health` without a token.
- Typed Open Terminal client (`src/open-terminal-client.ts`) with timeout and session pinning.
- Configuration via environment variables validated at boot (`src/config.ts`).
