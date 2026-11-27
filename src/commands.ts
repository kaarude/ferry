import {
  ApplicationCommandType,
  ChannelType,
  ContextMenuCommandBuilder,
  type ForumChannel,
  type GuildTextBasedChannel,
  type Interaction,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { type App, NO_PINGS } from "./app.ts";
import {
  duplicateComment,
  forwardedComment,
  parseRepo,
  repoSlug,
} from "./format.ts";
import {
  closeThread,
  prepareForum,
  reopenThread,
  updateTags,
} from "./forum.ts";
import { GitHubError } from "./github.ts";
import { NOT_DUPLICATE_BUTTON, undoDuplicate } from "./intake.ts";

// Slash commands, the message context menu, and button clicks.
//
// Permissions use Discord's built-in system: each command declares a default
// permission (Manage Server or Manage Threads). Server admins can then grant or
// revoke any command per role or channel in Server Settings > Integrations > Ferry.

const SEND_TO_GITHUB = "Send to GitHub";

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("ferry")
    .setDescription("Configure Ferry")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName("setup")
        .setDescription(
          "Create (or adopt) the feedback forum and link a GitHub repo",
        )
        .addStringOption((opt) =>
          opt
            .setName("repo")
            .setDescription("GitHub repo as owner/name")
            .setRequired(true),
        )
        .addChannelOption((opt) =>
          opt
            .setName("forum")
            .setDescription(
              "Use an existing forum instead of creating #feedback",
            )
            .addChannelTypes(ChannelType.GuildForum),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Show the current setup and check GitHub access"),
    ),

  new SlashCommandBuilder()
    .setName("duplicate")
    .setDescription("Mark this report as a duplicate of a GitHub issue")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageThreads)
    .addIntegerOption((opt) =>
      opt
        .setName("of")
        .setDescription("Issue number of the original report")
        .setRequired(true)
        .setMinValue(1),
    ),

  new ContextMenuCommandBuilder()
    .setName(SEND_TO_GITHUB)
    .setType(ApplicationCommandType.Message)
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageThreads),
].map((command) => command.toJSON());

// Stops double clicks on "Not a duplicate" from filing two issues.
const inFlight = new Set<string>();

/** Routes every interaction to its handler and turns errors into a private reply. */
export async function handleInteraction(
  app: App,
  interaction: Interaction,
): Promise<void> {
  if (!interaction.inCachedGuild()) return;
  try {
    if (interaction.isChatInputCommand()) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      let reply: string;
      if (interaction.commandName === "ferry") {
        const sub = interaction.options.getSubcommand();
        reply =
          sub === "setup"
            ? await setup(
                app,
                interaction.guild,
                interaction.options.getString("repo", true),
                interaction.options.getChannel("forum", false, [
                  ChannelType.GuildForum,
                ]),
              )
            : await status(app, interaction.guildId);
      } else if (interaction.commandName === "duplicate") {
        reply = await markDuplicate(
          app,
          interaction.channel,
          interaction.options.getInteger("of", true),
        );
      } else {
        return;
      }
      await interaction.editReply({ content: reply, ...NO_PINGS });
      return;
    }

    if (
      interaction.isMessageContextMenuCommand() &&
      interaction.commandName === SEND_TO_GITHUB
    ) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const message = interaction.targetMessage;
      const report = app.store.getReport(message.channelId);
      const config = app.store.getGuild(interaction.guildId);
      const repo = config && parseRepo(config.repo);
      if (!report || !repo) {
        await interaction.editReply(
          "That message isn't in a thread Ferry tracks.",
        );
        return;
      }
      const comment = await app.github.comment(
        repo,
        report.issueNumber,
        forwardedComment(message.author.username, message.content, message.url),
      );
      await interaction.editReply(
        `Added to [#${report.issueNumber}](<${comment.html_url}>).`,
      );
      return;
    }

    if (
      interaction.isButton() &&
      interaction.customId === NOT_DUPLICATE_BUTTON
    ) {
      const thread = interaction.channel;
      if (!thread?.isThread()) return;
      const allowed =
        interaction.user.id === thread.ownerId ||
        interaction.memberPermissions.has(PermissionFlagsBits.ManageThreads);
      if (!allowed) {
        await interaction.reply({
          content:
            "Only the person who posted this or a moderator can do that.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (inFlight.has(thread.id)) return;
      inFlight.add(thread.id);
      try {
        await interaction.deferUpdate();
        // undoDuplicate unarchives the thread, which Discord requires before
        // the button message can be edited.
        const result = await undoDuplicate(app, thread);
        await interaction.editReply({ components: [] });
        await interaction.followUp({
          content: result,
          flags: MessageFlags.Ephemeral,
        });
      } finally {
        inFlight.delete(thread.id);
      }
    }
  } catch (error) {
    console.error("Interaction failed:", error);
    const content = `Something went wrong: ${describeError(error)}`;
    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) {
        await interaction
          .followUp({ content, flags: MessageFlags.Ephemeral })
          .catch(() => {});
      } else {
        await interaction
          .reply({ content, flags: MessageFlags.Ephemeral })
          .catch(() => {});
      }
    }
  }
}

async function setup(
  app: App,
  guild: Parameters<typeof prepareForum>[0],
  repoInput: string,
  existingForum: ForumChannel | null,
): Promise<string> {
  const repo = parseRepo(repoInput);
  if (!repo)
    return "Give the repo as `owner/name`, for example `kaarude/ferry`.";

  let check: Awaited<ReturnType<typeof app.github.checkRepo>>;
  try {
    check = await app.github.checkRepo(repo);
  } catch (error) {
    if (!(error instanceof GitHubError)) throw error;
    return error.status === 404
      ? `I can't see \`${repoSlug(repo)}\`. Check the name and that GITHUB_TOKEN has access to it.`
      : `GitHub said no: ${error.message}`;
  }
  if (!check.hasIssues)
    return `Issues are turned off on \`${check.fullName}\`.`;

  const { forum, tags } = await prepareForum(guild, existingForum);
  app.store.saveGuild({
    guildId: guild.id,
    repo: check.fullName,
    forumId: forum.id,
    tags,
  });
  return [
    `Done. New posts in ${forum} become issues on \`${check.fullName}\`.`,
    app.finder
      ? "AI duplicate check is on."
      : "AI duplicate check is off (no ANTHROPIC_API_KEY).",
    "Adjust who can use Ferry's commands in Server Settings > Integrations > Ferry.",
  ].join("\n");
}

async function status(app: App, guildId: string): Promise<string> {
  const config = app.store.getGuild(guildId);
  if (!config) return "Ferry isn't set up here yet. Run `/ferry setup`.";
  const repo = parseRepo(config.repo);
  const access = repo
    ? await app.github.checkRepo(repo).then(
        () => "ok",
        (error: unknown) => `failing (${describeError(error)})`,
      )
    : "invalid repo";
  const counts = app.store.countReports(guildId);
  return [
    `**Forum:** <#${config.forumId}>`,
    `**Repo:** \`${config.repo}\` (GitHub access: ${access})`,
    `**AI duplicate check:** ${app.finder ? "on" : "off"}`,
    `**Reports:** ${counts.open} open, ${counts.closed} closed, ${counts.merged} merged as duplicates`,
    `**Last GitHub sync:** ${config.lastPolledAt ?? "not yet"}`,
  ].join("\n");
}

/** /duplicate: closes this thread's issue as a duplicate of another one. */
async function markDuplicate(
  app: App,
  channel: GuildTextBasedChannel | null,
  originalNumber: number,
): Promise<string> {
  const thread = channel?.isThread() ? channel : null;
  const config = thread ? app.store.getGuild(thread.guildId) : null;
  if (!thread || !config || thread.parentId !== config.forumId) {
    return "Use this inside a post in the Ferry forum.";
  }
  const repo = parseRepo(config.repo);
  if (!repo) return "The linked repo is invalid. Run `/ferry setup` again.";

  const original = await app.github
    .getIssue(repo, originalNumber)
    .catch(() => null);
  if (!original || original.pull_request)
    return `Issue #${originalNumber} doesn't exist.`;

  const report = app.store.getReport(thread.id);
  if (report?.issueNumber === originalNumber)
    return "That's this thread's own issue.";

  if (report && report.status !== "merged") {
    // The thread already has its own issue: close it and point to the original.
    await app.github.comment(
      repo,
      report.issueNumber,
      `Duplicate of #${originalNumber}`,
    );
    await app.github.closeIssue(repo, report.issueNumber, "duplicate");
  } else if (!report) {
    // Not filed yet (for example, a post from before Ferry was set up).
    const starter = await thread.fetchStarterMessage().catch(() => null);
    if (starter) {
      await app.github.comment(
        repo,
        originalNumber,
        duplicateComment(
          {
            content: starter.content,
            authorName: starter.author.username,
            threadUrl: thread.url,
            attachmentCount: starter.attachments.size,
          },
          thread.name,
        ),
      );
    }
  }

  app.store.saveReport({
    threadId: thread.id,
    guildId: thread.guildId,
    issueNumber: originalNumber,
    status: "merged",
    mergedCommentId: null,
  });
  await reopenThread(thread); // archived threads reject new messages
  await thread.send({
    content: `Marked as a duplicate of [#${originalNumber}](<${original.html_url}>).`,
    ...NO_PINGS,
  });
  await updateTags(thread, [config.tags.duplicate]);
  await closeThread(thread, true);
  return `Closed as a duplicate of #${originalNumber}.`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : String(error);
}
