<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./.github/readme/banner-dark.svg" />
    <source media="(prefers-color-scheme: light)" srcset="./.github/readme/banner-light.svg" />
    <img src="./.github/readme/banner-light.svg" width="100%" alt="Ferry: Discord forum posts in, GitHub issues out" />
  </picture>
</p>

<h1 align="center">Ferry</h1>

<p align="center">A self-hosted Discord bot that turns forum posts into GitHub issues and keeps both sides in sync.</p>

<p align="center">
  <a href="#getting-started">Getting started</a> ·
  <a href="#commands">Commands</a> ·
  <a href="./CONTRIBUTING.md">Contributing</a>
</p>

Ferry creates a forum channel in your Discord server with Bug and Feature tags. When someone opens a post, Ferry files it as a GitHub issue with the matching label and replies in the thread with a link. When a maintainer closes the issue on GitHub, the thread gets a Closed tag and is locked.

Your community already reports problems in Discord, and your work happens in GitHub. Without Ferry someone has to copy every report across by hand. If you add an Anthropic API key, Claude also reads each new post next to your open issues and merges obvious duplicates into the existing issue instead of opening another one.

## What you get

- **One command to set up.** `/ferry setup repo:owner/name` creates a `#feedback` forum with the tags it needs, or adds them to a forum you already have.
- **Issues with context.** Every issue gets a `bug` or `enhancement` label, a `discord` label, the reporter's name, and a link back to the thread.
- **Duplicate merging (optional).** Claude compares a new post with up to 100 open issues. On a confident match Ferry comments on the existing issue and closes the thread. The reporter can press **Not a duplicate** to file it anyway.
- **Status sync without webhooks.** Ferry polls GitHub every 5 minutes, so it runs behind a home router or on a laptop with no public URL. Closed issues lock their thread, and reopened issues unlock it.
- **Discord's own permissions.** Admin commands need Manage Server and triage commands need Manage Threads. You can change either per role or channel in Server Settings > Integrations > Ferry.
- **No database server.** State lives in one SQLite file through Node's built-in `node:sqlite`.

## Getting started

You need Node.js 24 or newer and pnpm, or Docker.

### 1. Create the Discord bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications), click **New Application**, and name it Ferry.
2. Under **Bot**, click **Reset Token** and copy the token.
3. On the same page, turn on **Message Content Intent**. Ferry needs it to read the text of forum posts.
4. Invite the bot. Replace `YOUR_APP_ID` with the Application ID from **General Information**:

```text
https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot+applications.commands&permissions=292057844752
```

That permission number grants View Channels, Send Messages, Send Messages in Threads, Read Message History, Manage Channels (to create the forum and its tags), and Manage Threads (to tag, lock, and archive posts).

### 2. Create a GitHub token

Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new). Under **Repository access**, pick only the repos you want Ferry to file into. Under **Repository permissions**, set **Issues** to **Read and write**.

Ferry creates issues as the token's owner. That account needs write access to the repo, because GitHub silently drops labels on issues from users without it.

### 3. Run Ferry

```bash
git clone https://github.com/kaarude/ferry.git
cd ferry
pnpm install
cp .env.example .env   # then fill in DISCORD_TOKEN and GITHUB_TOKEN
pnpm start
```

Or with Docker, after filling in `.env`:

```bash
docker compose up -d
```

### 4. Connect your server

In Discord, run:

```text
/ferry setup repo:your-name/your-repo
```

Add `forum:#existing-forum` to reuse a forum you already have. Post something with the Bug tag to check that the issue shows up.

## Commands

| Command                                           | Default access                | What it does                                                                                 |
| ------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------- |
| `/ferry setup repo:<owner/name> [forum]`          | Manage Server                 | Creates or adopts the forum and links the repo. Run it again to switch repos.                |
| `/ferry status`                                   | Manage Server                 | Shows the linked repo, whether the token still works, report counts, and the last sync time. |
| `/duplicate of:<number>`                          | Manage Threads                | Run inside a post. Closes its issue as a duplicate of `#number` and locks the thread.        |
| **Send to GitHub** (right-click a message > Apps) | Manage Threads                | Copies a reply from the thread into the issue as a comment.                                  |
| **Not a duplicate** button                        | Post author or Manage Threads | Undoes an AI merge and files the post as its own issue.                                      |

## Duplicate detection

Set `ANTHROPIC_API_KEY` to turn it on. For each new post, Ferry sends the post and the titles plus the first 400 characters of up to 100 open issues to Claude, which returns structured JSON: an issue number or null, a confidence level, and a one-sentence reason.

Ferry merges only when Claude reports high confidence and the number matches an issue it was shown. Anything less, or any API error, falls back to filing a normal issue. A failed check never loses a report.

The default model is `claude-opus-5-5`, which costs roughly one or two cents per post. Set `AI_MODEL=claude-haiku-5-5` to bring that down to a fraction of a cent.

Turning this on sends the text of every new post to Anthropic's API. Tell your community before you enable it.

## Configuration

| Variable                | Required | Default           | Description                                                  |
| ----------------------- | -------- | ----------------- | ------------------------------------------------------------ |
| `DISCORD_TOKEN`         | Yes      |                   | Bot token from the Developer Portal.                         |
| `GITHUB_TOKEN`          | Yes      |                   | Fine-grained token with Issues read and write.               |
| `ANTHROPIC_API_KEY`     | No       |                   | Turns on duplicate detection.                                |
| `AI_MODEL`              | No       | `claude-opus-5-5` | Claude model for duplicate detection.                        |
| `DATABASE_PATH`         | No       | `./data/ferry.db` | SQLite file location.                                        |
| `POLL_INTERVAL_MINUTES` | No       | `5`               | How often Ferry checks GitHub for closed or reopened issues. |

One Ferry process can serve several Discord servers. Each server links its own repo, and `GITHUB_TOKEN` needs access to all of them.

## Development

```bash
pnpm dev         # restart on file changes
pnpm test        # Vitest
pnpm typecheck   # tsc
pnpm lint        # Biome
```

Node runs the TypeScript in `src/` directly, so there is no build step. [AGENTS.md](./AGENTS.md) explains how the pieces fit together.

## Contributing

Bug reports and pull requests are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) before you open a PR, and report security issues privately as described in [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE)
