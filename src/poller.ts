import type { Client, ThreadChannel } from "discord.js";
import { type App, NO_PINGS } from "./app.ts";
import type { GuildConfig, ReportStatus } from "./db.ts";
import { parseRepo } from "./format.ts";
import { closeThread, reopenThread, updateTags } from "./forum.ts";
import type { Issue } from "./github.ts";

// GitHub -> Discord sync. Instead of a webhook (which needs a public URL),
// Ferry asks GitHub every few minutes which issues changed and mirrors
// closes and reopens onto the matching forum threads.

export type SyncAction = "close" | "reopen" | null;

/** Decides what to do with a thread given its stored status and the live issue. */
export function syncAction(
  status: ReportStatus,
  issue: Pick<Issue, "state">,
): SyncAction {
  if (status === "open" && issue.state === "closed") return "close";
  if (status === "closed" && issue.state === "open") return "reopen";
  return null;
}

const CLOSE_REASON: Record<string, string> = {
  completed: "completed",
  not_planned: "not planned",
  duplicate: "a duplicate",
};

/** Starts the polling loop. Returns a function that stops it. */
export function startPoller(
  app: App,
  client: Client,
  intervalMinutes: number,
): () => void {
  let running = false;
  const tick = async () => {
    if (running) return; // a slow round must not overlap the next one
    running = true;
    try {
      for (const config of app.store.listGuilds()) {
        await syncGuild(app, client, config).catch((error: unknown) => {
          console.error(`Sync failed for guild ${config.guildId}:`, error);
        });
      }
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(tick, intervalMinutes * 60_000);
  return () => clearInterval(timer);
}

async function syncGuild(
  app: App,
  client: Client,
  config: GuildConfig,
): Promise<void> {
  const repo = parseRepo(config.repo);
  if (!repo) return;
  const startedAt = new Date().toISOString();
  // First run for this server: start from now instead of replaying history.
  if (!config.lastPolledAt) {
    app.store.setLastPolled(config.guildId, startedAt);
    return;
  }

  const issues = await app.github.listIssuesUpdatedSince(
    repo,
    config.lastPolledAt,
  );
  for (const issue of issues) {
    const report = app.store.findOwnerThread(config.guildId, issue.number);
    if (!report) continue;
    const action = syncAction(report.status, issue);
    if (!action) continue;

    const thread = await client.channels
      .fetch(report.threadId)
      .catch(() => null);
    if (!thread?.isThread()) continue; // thread was deleted

    if (action === "close") await applyClose(thread, config, issue);
    else await applyReopen(thread, config, issue);
    app.store.saveReport({
      ...report,
      status: action === "close" ? "closed" : "open",
    });
  }
  app.store.setLastPolled(config.guildId, startedAt);
}

async function applyClose(
  thread: ThreadChannel,
  config: GuildConfig,
  issue: Issue,
) {
  const reason = CLOSE_REASON[issue.state_reason ?? "completed"] ?? "completed";
  const tag =
    issue.state_reason === "duplicate"
      ? config.tags.duplicate
      : config.tags.closed;
  await reopenThread(thread); // edits fail on archived threads
  await thread.send({
    content: `[#${issue.number}](<${issue.html_url}>) was closed on GitHub as ${reason}. Open a new post if the problem comes back.`,
    ...NO_PINGS,
  });
  await updateTags(thread, [tag]);
  await closeThread(thread, true);
}

async function applyReopen(
  thread: ThreadChannel,
  config: GuildConfig,
  issue: Issue,
) {
  await reopenThread(thread);
  await updateTags(thread, [], [config.tags.closed, config.tags.duplicate]);
  await thread.send({
    content: `[#${issue.number}](<${issue.html_url}>) was reopened on GitHub.`,
    ...NO_PINGS,
  });
}
