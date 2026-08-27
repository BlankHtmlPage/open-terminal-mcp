# security policy

## supported versions

| version | supported |
| --- | --- |
| 1.x | :white_check_mark: |

only the latest `1.x` release is supported. older versions, if any, are not.

## reporting a vulnerability

preferred: use github private vulnerability reporting for this repo (security → report a vulnerability). it keeps the report encrypted and lets us triage without public disclosure.

alternatives:

- discord: `blankhtml.page`
- email: `flurion@tuta.io` (fallback — already public in commit history)

please include steps to reproduce, impact, and any relevant logs. do not include tokens, `.env` contents, or real hostnames in the report.

we will acknowledge within 7 days and keep you updated on the fix and disclosure timeline. we are a solo maintainer, so we do not promise 24-hour response — 7 days is the commitment.

if the vulnerability is in the upstream [open-webui/open-terminal](https://github.com/open-webui/open-terminal) project itself, please report it there.

## threat model

this section states what this service is and where the trust boundary sits. read it before deploying.

**the token is a capability equivalent to shell.** anyone holding `MCP_AUTH_TOKEN` can run arbitrary commands on the open terminal host through `run_command` and read/write/delete any file the upstream host can access. treat the token like a password to a shell account. generate it with `openssl rand -hex 32`, rotate it if it leaks, and transport it only over tls.

**loopback is the intended deployment.** the server binds `127.0.0.1` by default. keep it there. only bind `0.0.0.0` if you front it with tls and a reverse proxy that enforces authentication and throttling. without a proxy, a `0.0.0.0` bind on a vps with a permissive firewall puts a remote shell on the public internet.

**no path confinement in this layer — by design.** `read_file`, `write_file`, `edit_file`, `delete_path`, and `move_path` forward their `path` verbatim to open terminal. there are no `path.resolve` checks, no chroot, no symlink guards here. that is deliberate: `run_command` already grants full shell, so file-path checks would be theatre. if you need filesystem isolation, enforce it in the upstream open terminal host (its user, its container, its mount namespace).

**the upstream open terminal host is the real confinement boundary.** this bridge holds no shell itself. the security properties of the deployment are the security properties of the host you point `OPEN_TERMINAL_URL` at. run open terminal as a dedicated user or inside a container with a minimal filesystem if you want containment.

**what is out of scope:**

- vulnerabilities in the upstream open terminal project itself — report those upstream.
- anything that requires a valid `MCP_AUTH_TOKEN` to demonstrate. a valid token is total access by design, so an attacker who already has the token is not a vulnerability in this project — the vulnerability is how they got the token.

## disclosure

we will fix, tag a release, and publish an advisory once a fix is ready. if you reported privately, we will credit you unless you ask not to be.
