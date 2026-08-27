# contributing

thanks for considering a contribution.

## dev setup

```bash
git clone https://github.com/BlankHtmlPage/open-terminal-mcp.git
cd open-terminal-mcp
npm ci
cp .env.example .env
# set OPEN_TERMINAL_URL, OPEN_TERMINAL_API_KEY, MCP_AUTH_TOKEN in .env
npm run build
```

## before opening a pull request

run the checks that ci runs:

```bash
npm run typecheck && npm test
```

keep changes focused and follow the existing code style. use [conventional commits](https://www.conventionalcommits.org/) for commit messages (`fix:`, `feat:`, `docs:`, `chore:`, `test:`, `ci:`).

## reviews and scope

this is a solo-maintainer project. reviews may be slow — expect up to a few days.

please open an issue before large changes so we can align on direction. keep pull requests small and self-contained.

## npm publishing

npm publishing is not currently set up. `package.json` contains `"files": ["dist"]` as an accident guard, but there is no publish workflow yet. it may be added later if the package is published to npm.

## reporting issues

use the issue templates in `.github/ISSUE_TEMPLATE/`. do not paste tokens, `.env` contents, or real hostnames into issues.
