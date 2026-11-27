# Ferry

Self-hosted Discord bot. It creates a forum channel, files each new forum post as a GitHub issue, optionally merges duplicates with Claude, and polls GitHub to mirror closes and reopens back onto the threads.

## Stack

- Language and runtime: TypeScript run directly by Node.js 24+ or Bun 1.3+ (no build step), pnpm.
- Framework and key libraries: discord.js 14, `@anthropic-ai/sdk` (structured outputs via `betaZodOutputFormat`), zod for env and AI output validation, the runtime's built-in SQLite (`node:sqlite` or `bun:sqlite`) for storage. GitHub is called through `fetch`, with no Octokit.

## Commands

```bash
pnpm install      # Install dependencies
pnpm dev          # Run with --watch (reads .env)
pnpm start        # Run once (reads .env)
pnpm typecheck    # tsc --noEmit
pnpm lint         # Biome check
pnpm format       # Biome check --write
pnpm test         # Vitest on Node
pnpm test:bun     # Vitest on Bun
bun run dev:bun   # Run with --watch on Bun (Bun loads .env itself)
bun run start:bun # Run once on Bun
```

## Where things live

- `src/index.ts`: entry point. Wires env, store, GitHub client, optional AI, Discord events, and the poller.
- `src/intake.ts`: new forum post flow (duplicate check, merge or file issue) and the "Not a duplicate" undo.
- `src/commands.ts`: slash commands, the "Send to GitHub" message action, and button routing. Default permissions are declared here.
- `src/poller.ts`: GitHub to Discord status sync. `syncAction` is the pure decision function.
- `src/forum.ts`: forum creation, tag definitions, and thread tag and archive helpers.
- `src/ai.ts`: Claude duplicate check. `pickDuplicate` guards which verdicts Ferry acts on.
- `src/github.ts`: minimal REST client.
- `src/db.ts`: SQLite schema and queries (`guilds`, `reports`).
- `src/format.ts`: pure text helpers (issue bodies, mention neutralizing, repo parsing).
- `src/*.test.ts`: Vitest tests next to the code they cover.

## Conventions and gotchas

- Imports use explicit `.ts` extensions, and `tsconfig.json` sets `erasableSyntaxOnly`. No enums, namespaces, or constructor parameter properties, because Node strips types without transforming code.
- Ferry must run on both Node and Bun. Only `src/db.ts` touches SQLite: it loads `node:sqlite` or `bun:sqlite` at runtime through `require`, because a static import of either one fails on the other runtime. Avoid other runtime-specific APIs (`Bun.*`, `node:sqlite` elsewhere) and run `pnpm test:bun` when you touch storage.
- Run all user text that goes to GitHub through `neutralizeMentions`, so Discord users cannot trigger GitHub @mention notifications.
- Every Discord message Ferry sends spreads `NO_PINGS`, so issue titles cannot ping @everyone or roles.
- Discord rejects tag edits on archived threads. Call `reopenThread` before `updateTags`, then `closeThread`.
- Report status is `open`, `closed`, or `merged`. Merged rows point at another thread's issue and are skipped by the poller (`findOwnerThread`).
- The AI check must never block filing. `DuplicateFinder.find` returns null on any error or refusal.
- Git worktrees live in `.worktrees/`. Biome (`!!.worktrees` in `biome.json`) and Vitest (`--dir src`) skip that folder, so checks in the main checkout only cover the main checkout. Keep it that way when touching either config.
- CI (`.github/workflows/ci.yml`) runs `pnpm typecheck`, `pnpm lint`, and `pnpm test` on Node 24 for every PR.
- Never use em dashes in code, comments, or docs.
