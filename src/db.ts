import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";

// Ferry stores two things: each server's setup, and which Discord thread
// belongs to which GitHub issue. Both Node and Bun ship SQLite built in, so
// there is no database dependency to install.

type SqlValue = string | number | null;

/**
 * The part of the SQLite API that node:sqlite and bun:sqlite share. The
 * compiler checks the Node driver against it. The Bun driver is an unchecked
 * cast below, so run `pnpm test:bun` after adding anything here.
 */
type SqlDatabase = {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: SqlValue[]): unknown;
    all(...params: SqlValue[]): unknown[];
    run(...params: SqlValue[]): unknown;
  };
  close(): void;
};

const require = createRequire(import.meta.url);

/**
 * Picks the runtime's built-in driver. Loaded with require at runtime because
 * a static import of "node:sqlite" fails to resolve under Bun, and the other
 * way around for "bun:sqlite".
 */
function openDatabase(path: string): SqlDatabase {
  if (process.versions.bun) {
    const { Database } = require("bun:sqlite") as {
      Database: new (path: string) => SqlDatabase;
    };
    return new Database(path);
  }
  const { DatabaseSync } =
    require("node:sqlite") as typeof import("node:sqlite");
  return new DatabaseSync(path);
}

/** Forum tag IDs Ferry created during /ferry setup. */
export type ForumTags = {
  bug: string;
  feature: string;
  duplicate: string;
  closed: string;
};

export type GuildConfig = {
  guildId: string;
  repo: string; // "owner/name"
  forumId: string;
  tags: ForumTags;
  lastPolledAt: string | null;
};

/**
 * - open: the thread has its own GitHub issue, which is open.
 * - closed: its own issue was closed on GitHub.
 * - merged: the AI merged it into another thread's issue as a duplicate.
 */
export type ReportStatus = "open" | "closed" | "merged";

export type Report = {
  threadId: string;
  guildId: string;
  issueNumber: number;
  status: ReportStatus;
  /** For merged reports: the "also reported" comment, so undo can delete it. */
  mergedCommentId: number | null;
};

type GuildRow = {
  guild_id: string;
  repo: string;
  forum_id: string;
  tags: string;
  last_polled_at: string | null;
};

type ReportRow = {
  thread_id: string;
  guild_id: string;
  issue_number: number;
  status: ReportStatus;
  merged_comment_id: number | null;
};

const toGuild = (row: GuildRow): GuildConfig => ({
  guildId: row.guild_id,
  repo: row.repo,
  forumId: row.forum_id,
  tags: JSON.parse(row.tags) as ForumTags,
  lastPolledAt: row.last_polled_at,
});

const toReport = (row: ReportRow): Report => ({
  threadId: row.thread_id,
  guildId: row.guild_id,
  issueNumber: row.issue_number,
  status: row.status,
  mergedCommentId: row.merged_comment_id,
});

export type Store = ReturnType<typeof openStore>;

/** Opens (or creates) the database. Pass ":memory:" in tests. */
export function openStore(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = openDatabase(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS guilds (
      guild_id TEXT PRIMARY KEY,
      repo TEXT NOT NULL,
      forum_id TEXT NOT NULL,
      tags TEXT NOT NULL,
      last_polled_at TEXT
    );
    CREATE TABLE IF NOT EXISTS reports (
      thread_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      issue_number INTEGER NOT NULL,
      status TEXT NOT NULL,
      merged_comment_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS reports_by_issue ON reports (guild_id, issue_number);
  `);

  return {
    saveGuild(config: Omit<GuildConfig, "lastPolledAt">) {
      db.prepare(
        `INSERT INTO guilds (guild_id, repo, forum_id, tags) VALUES (?, ?, ?, ?)
         ON CONFLICT (guild_id) DO UPDATE SET
           repo = excluded.repo, forum_id = excluded.forum_id, tags = excluded.tags`,
      ).run(
        config.guildId,
        config.repo,
        config.forumId,
        JSON.stringify(config.tags),
      );
    },

    getGuild(guildId: string): GuildConfig | null {
      const row = db
        .prepare("SELECT * FROM guilds WHERE guild_id = ?")
        .get(guildId);
      return row ? toGuild(row as GuildRow) : null;
    },

    listGuilds(): GuildConfig[] {
      return (db.prepare("SELECT * FROM guilds").all() as GuildRow[]).map(
        toGuild,
      );
    },

    setLastPolled(guildId: string, at: string) {
      db.prepare("UPDATE guilds SET last_polled_at = ? WHERE guild_id = ?").run(
        at,
        guildId,
      );
    },

    saveReport(report: Report) {
      db.prepare(
        `INSERT INTO reports (thread_id, guild_id, issue_number, status, merged_comment_id)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (thread_id) DO UPDATE SET
           issue_number = excluded.issue_number,
           status = excluded.status,
           merged_comment_id = excluded.merged_comment_id`,
      ).run(
        report.threadId,
        report.guildId,
        report.issueNumber,
        report.status,
        report.mergedCommentId,
      );
    },

    getReport(threadId: string): Report | null {
      const row = db
        .prepare("SELECT * FROM reports WHERE thread_id = ?")
        .get(threadId);
      return row ? toReport(row as ReportRow) : null;
    },

    /** The thread that owns an issue (merged duplicates are excluded). */
    findOwnerThread(guildId: string, issueNumber: number): Report | null {
      const row = db
        .prepare(
          `SELECT * FROM reports
           WHERE guild_id = ? AND issue_number = ? AND status != 'merged'
           LIMIT 1`,
        )
        .get(guildId, issueNumber);
      return row ? toReport(row as ReportRow) : null;
    },

    countReports(guildId: string): Record<ReportStatus, number> {
      const rows = db
        .prepare(
          "SELECT status, COUNT(*) AS n FROM reports WHERE guild_id = ? GROUP BY status",
        )
        .all(guildId) as { status: ReportStatus; n: number }[];
      const counts: Record<ReportStatus, number> = {
        open: 0,
        closed: 0,
        merged: 0,
      };
      for (const row of rows) counts[row.status] = row.n;
      return counts;
    },

    close() {
      db.close();
    },
  };
}
