import {
  ChannelFlags,
  ChannelType,
  type ForumChannel,
  type Guild,
  type GuildForumTagData,
  type ThreadChannel,
} from "discord.js";
import type { ForumTags } from "./db.ts";

// Everything about the forum channel itself: creating it, its tags, and
// changing a thread's tags and open/closed state.

/**
 * Tags Ferry manages. Users must pick Bug or Feature when posting. Only
 * moderators (and Ferry) can set Duplicate and Closed.
 */
const TAGS: Record<keyof ForumTags, GuildForumTagData> = {
  bug: { name: "Bug", emoji: { id: null, name: "🐛" }, moderated: false },
  feature: {
    name: "Feature",
    emoji: { id: null, name: "✨" },
    moderated: false,
  },
  duplicate: {
    name: "Duplicate",
    emoji: { id: null, name: "🔁" },
    moderated: true,
  },
  closed: { name: "Closed", emoji: { id: null, name: "✅" }, moderated: true },
};

const GUIDELINES =
  "Pick the Bug or Feature tag. Bugs: steps to reproduce, what you expected, what happened. " +
  "Features: the problem you want solved. Every post becomes a GitHub issue.";

/**
 * Creates a new forum, or adds Ferry's tags to an existing one, and returns
 * the forum plus the IDs Discord assigned to each tag.
 */
export async function prepareForum(
  guild: Guild,
  existing: ForumChannel | null,
): Promise<{ forum: ForumChannel; tags: ForumTags }> {
  let forum: ForumChannel;
  if (existing) {
    const missing = Object.values(TAGS).filter(
      (tag) => !existing.availableTags.some((t) => sameName(t.name, tag.name)),
    );
    forum = await existing.edit({
      availableTags: [...existing.availableTags, ...missing],
      flags: [ChannelFlags.RequireTag],
    });
  } else {
    const created = await guild.channels.create({
      name: "feedback",
      type: ChannelType.GuildForum,
      topic: GUIDELINES,
      availableTags: Object.values(TAGS),
    });
    // "Require a tag" can only be set after the forum exists.
    forum = await created.edit({ flags: [ChannelFlags.RequireTag] });
  }

  const idFor = (key: keyof ForumTags) => {
    const tag = forum.availableTags.find((t) =>
      sameName(t.name, TAGS[key].name),
    );
    if (!tag)
      throw new Error(`Tag "${TAGS[key].name}" is missing on #${forum.name}`);
    return tag.id;
  };

  return {
    forum,
    tags: {
      bug: idFor("bug"),
      feature: idFor("feature"),
      duplicate: idFor("duplicate"),
      closed: idFor("closed"),
    },
  };
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Adds and removes tags on a thread. Forum threads allow at most 5 tags. */
export async function updateTags(
  thread: ThreadChannel,
  add: string[],
  remove: string[] = [],
): Promise<void> {
  const next = new Set(thread.appliedTags);
  for (const id of remove) next.delete(id);
  for (const id of add) next.add(id);
  await thread.setAppliedTags([...next].slice(0, 5));
}

/** Discord rejects edits on archived threads, so unarchive before changing them. */
export async function reopenThread(thread: ThreadChannel): Promise<void> {
  if (thread.archived) await thread.setArchived(false);
  if (thread.locked) await thread.setLocked(false);
}

export async function closeThread(
  thread: ThreadChannel,
  lock: boolean,
): Promise<void> {
  if (lock) await thread.setLocked(true);
  await thread.setArchived(true);
}
