# Contributing

Thanks for considering a contribution.

## Dev Setup

```bash
git clone https://github.com/BlankHtmlPage/open-terminal-mcp.git
cd open-terminal-mcp
npm ci
cp .env.example .env
# Set OPEN_TERMINAL_URL, OPEN_TERMINAL_API_KEY, MCP_AUTH_TOKEN in .env
npm run build
```

## Before Opening a Pull Request

Run the checks that CI runs:

```bash
npm run typecheck && npm test
```

Keep changes focused and follow the existing code style. Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages (`fix:`, `feat:`, `docs:`, `chore:`, `test:`, `ci:`).

## AI-Generated Contributions

AI assistance is allowed, but low-quality AI-generated code ("AI slop") is not. Do not submit pull requests that are bulk-generated, unreviewed, or that you do not fully understand.

By opening a PR you confirm that you have read, tested, and take responsibility for every line you submit — whether you wrote it by hand or with an AI tool. PRs that are obviously unreviewed AI output, add speculative abstractions, or ignore the project's existing conventions will be closed without review. If you used AI, say so in the PR description.

## Reviews and Scope
This is a solo-maintainer project. Reviews may be slow — expect up to a few days.

Please open an issue before large changes so we can align on direction. Keep pull requests small and self-contained.

## NPM Publishing

NPM publishing is not currently set up. `package.json` contains `"files": ["dist"]` as an accident guard, but there is no publish workflow yet. It may be added later if the package is published to npm.

## Reporting Issues

Use the issue templates in `.github/ISSUE_TEMPLATE/`. Do not paste tokens, `.env` contents, or real hostnames into issues.
