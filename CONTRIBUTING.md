# Contributing to Ferry

Thanks for wanting to help improve Ferry.

## Before opening an issue or PR

Search existing issues and pull requests first to avoid duplicates.

- Report bugs with the Bug report issue form. Include exact steps to reproduce, expected behavior, and actual behavior.
- Suggest features with the Feature request issue form. Start from the problem you want to solve.
- For large changes, open an issue first so we can agree on scope before writing code.

## Local setup

Prerequisites: Node.js 24 or newer, pnpm, a Discord bot token, and a GitHub token for a test repo. The README's [Getting started](./README.md#getting-started) section walks through creating both tokens.

```bash
pnpm install
cp .env.example .env
```

Run the bot locally against a test server and a test repo:

```bash
pnpm dev
```

Run checks before opening a pull request:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

CI runs the same three checks on every pull request. Fix any failure before asking for review.

## Pull request guidelines

- Keep each pull request focused on one problem or feature. Put unrelated cleanup in its own PR.
- Match the existing code style and conventions in the codebase. [AGENTS.md](./AGENTS.md) lists the gotchas.
- Add or update focused tests when changing behavior. Pure logic lives in small functions (`syncAction`, `pickDuplicate`, `format.ts`) so it can be tested without Discord.
- Fill out the pull request template and show how you verified the change: exact commands run, observed output, and screenshots of the Discord side when relevant.
