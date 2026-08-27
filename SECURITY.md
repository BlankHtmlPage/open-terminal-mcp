# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| 1.x | :white_check_mark: |

Only the latest `1.x` release is supported. Older versions, if any, are not.

## Reporting a Vulnerability

Preferred: use GitHub private vulnerability reporting for this repo (Security → Report a vulnerability). It keeps the report encrypted and lets us triage without public disclosure.

- Discord: `blankhtml.page`
- Email: `flurion@tuta.io`

Please include steps to reproduce, impact, and any relevant logs. Do not include tokens, `.env` contents, or real hostnames in the report.

We will acknowledge within 7 days and keep you updated on the fix and disclosure timeline. We are a solo maintainer, so we do not promise 24-hour response — 7 days is the commitment.

If the vulnerability is in the upstream [open-webui/open-terminal](https://github.com/open-webui/open-terminal) project itself, please report it there.

## Threat Model

This section states what this service is and where the trust boundary sits. Read it before deploying.

**The token is a capability equivalent to shell.** Anyone holding `MCP_AUTH_TOKEN` can run arbitrary commands on the Open Terminal host through `run_command` and read/write/delete any file the upstream host can access. Treat the token like a password to a shell account. Generate it with `openssl rand -hex 32`, rotate it if it leaks, and transport it only over TLS.

**Loopback is the intended deployment.** The server binds `127.0.0.1` by default. Keep it there. Only bind `0.0.0.0` if you front it with TLS and a reverse proxy that enforces authentication and throttling. Without a proxy, a `0.0.0.0` bind on a VPS with a permissive firewall puts a remote shell on the public internet.

**No path confinement in this layer — by design.** `read_file`, `write_file`, `edit_file`, `delete_path`, and `move_path` forward their `path` verbatim to Open Terminal. There are no `path.resolve` checks, no chroot, no symlink guards here. That is deliberate: `run_command` already grants full shell, so file-path checks would be theatre. If you need filesystem isolation, enforce it in the upstream Open Terminal host (its user, its container, its mount namespace).

**The upstream Open Terminal host is the real confinement boundary.** This bridge holds no shell itself. The security properties of the deployment are the security properties of the host you point `OPEN_TERMINAL_URL` at. Run Open Terminal as a dedicated user or inside a container with a minimal filesystem if you want containment.

**What is out of scope:**

- Vulnerabilities in the upstream Open Terminal project itself — report those upstream.
- Anything that requires a valid `MCP_AUTH_TOKEN` to demonstrate. A valid token is total access by design, so an attacker who already has the token is not a vulnerability in this project — the vulnerability is how they got the token.

## Disclosure

We will fix, tag a release, and publish an advisory once a fix is ready. If you reported privately, we will credit you unless you ask not to be.

## AI Usage Disclosure

Parts of this project — including code, documentation, and reviews — were created with AI assistance and reviewed by the maintainer before committing. AI was used as an editor and accelerator, not as an autonomous author. The maintainer takes responsibility for all changes, but you should assume AI-generated code was involved in the initial implementation and treat review accordingly. If you find a vulnerability that traces to AI-generated code, report it as you would any other vulnerability (see Reporting a Vulnerability above).
