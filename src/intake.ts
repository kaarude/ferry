import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Message,
  type ThreadChannel,
} from "discord.js";
import { type App, NO_PINGS } from "./app.ts";
import type { GuildConfig } from "./db.ts";
import {
  duplicateComment,
  issueBody,
  KIND_LABEL,
  parseRepo,
  type ReportInput,
  type ReportKind,
  SOURCE_LABEL,
} from "./format.ts";
import { closeThread, updateTags } from "./forum.ts";

// What happens when someone opens a new post in the Ferry forum:
// optional duplicate check, then either merge into an existing issue or file a new one.

export const NOT_DUPLICATE_BUTTON = "ferry:not-duplicate";

/** Called for every new thread in the server. Ignores threads outside the Ferry forum. */
export async function handleNewThread(
  app: App,
  thread: ThreadChannel,
): Promise<void> {
  const config = app.store.getGuild(thread.guildId);
  if (!config || thread.parentId !== config.forumId) return;
  if (app.store.getReport(thread.id)) return; // already handled

  const starter = await fetchStarter(thread);
  if (!starter) {
    console.warn(`Thread ${thread.id}: starter message not found, skipping.`);
    return;
  }
  const repo = parseRepo(config.repo);
  if (!repo) return;
  const report = toReportInput(thread, starter);

  if (app.finder) {
    await thread.sendTyping().catch(() => {});
    // If GitHub can't list issues right now, skip the check and file normally.
    const candidates = await app.github.listOpenIssues(repo).catch(() => []);
    const duplicate = await app.finder.find(
      { title: thread.name, content: starter.content },
      candidates,
    );
    if (duplicate) {
      await mergeAsDuplicate(app, thread, config, report, duplicate);
      return;
    }
  }

  await fileIssue(app, thread, config, starter);
}

/** Creates a GitHub issue for the thread and links it in Discord. */
export async function fileIssue(
  app: App,
  thread: ThreadChannel,
  config: GuildConfig,
  starter: Message,
): Promise<void> {
  const repo = parseRepo(config.repo);
  if (!repo) return;
  const kind = kindOf(thread, config);
  const issue = await app.github.createIssue(repo, {
    title: thread.name,
    body: issueBody(toReportInput(thread, starter)),
    labels: kind ? [KIND_LABEL[kind], SOURCE_LABEL] : [SOURCE_LABEL],
  });
  app.store.saveReport({
    threadId: thread.id,
    guildId: thread.guildId,
    issueNumber: issue.number,
    status: "open",
    mergedCommentId: null,
  });
  await thread.send({
    content: `Tracked on GitHub as [#${issue.number}](<${issue.html_url}>). This thread updates when the issue closes.`,
    ...NO_PINGS,
  });
}

async function mergeAsDuplicate(
  app: App,
  thread: ThreadChannel,
  config: GuildConfig,
  report: ReportInput,
  duplicate: { issueNumber: number; reason: string },
): Promise<void> {
  const repo = parseRepo(config.repo);
  if (!repo) return;
  const comment = await app.github.comment(
    repo,
    duplicate.issueNumber,
    duplicateComment(report, thread.name),
  );
  app.store.saveReport({
    threadId: thread.id,
    guildId: thread.guildId,
    issueNumber: duplicate.issueNumber,
    status: "merged",
    mergedCommentId: comment.id,
  });

  const original = app.store.findOwnerThread(
    thread.guildId,
    duplicate.issueNumber,
  );
  const issueUrl = `https://github.com/${config.repo}/issues/${duplicate.issueNumber}`;
  const lines = [
    `This looks like a duplicate of [#${duplicate.issueNumber}](<${issueUrl}>), so I added your report there instead of opening a new issue.`,
    `> ${duplicate.reason}`,
    original ? `Follow the discussion in <#${original.threadId}>.` : null,
    "If this is a different problem, press **Not a duplicate** and I'll file it separately.",
  ];
  const button = new ButtonBuilder()
    .setCustomId(NOT_DUPLICATE_BUTTON)
    .setLabel("Not a duplicate")
    .setStyle(ButtonStyle.Secondary);

  await thread.send({
    content: lines.filter(Boolean).join("\n"),
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)],
    ...NO_PINGS,
  });
  await updateTags(thread, [config.tags.duplicate]);
  // Archive without locking, so the reporter can still press the button or reply.
  await closeThread(thread, false);
}

/**
 * Undo for an AI merge: removes the "also reported" comment and files the
 * report as its own issue. Allowed for the thread author and moderators.
 */
export async function undoDuplicate(
  app: App,
  thread: ThreadChannel,
): Promise<string> {
  const config = app.store.getGuild(thread.guildId);
  const report = app.store.getReport(thread.id);
  const repo = config && parseRepo(config.repo);
  if (!config || !repo || report?.status !== "merged") {
    return "This thread isn't marked as a duplicate anymore.";
  }
  const starter = await fetchStarter(thread);
  if (!starter) return "I couldn't find the original post in this thread.";

  if (report.mergedCommentId !== null) {
    await app.github
      .deleteComment(repo, report.mergedCommentId)
      .catch((error: unknown) => {
        console.warn("Could not delete duplicate comment:", error);
      });
  }
  if (thread.archived) await thread.setArchived(false);
  await updateTags(thread, [], [config.tags.duplicate]);
  await fileIssue(app, thread, config, starter);
  return "Got it, filed as a separate issue.";
}

function kindOf(thread: ThreadChannel, config: GuildConfig): ReportKind | null {
  if (thread.appliedTags.includes(config.tags.bug)) return "bug";
  if (thread.appliedTags.includes(config.tags.feature)) return "feature";
  return null;
}

function toReportInput(thread: ThreadChannel, starter: Message): ReportInput {
  return {
    content: starter.content,
    authorName: starter.author.username,
    threadUrl: thread.url,
    attachmentCount: starter.attachments.size,
  };
}

/**
 * A forum post's first message can arrive a moment after the thread itself,
 * so retry a few times before giving up.
 */
async function fetchStarter(thread: ThreadChannel): Promise<Message | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await thread.fetchStarterMessage();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
    }
  }
  return null;
}
