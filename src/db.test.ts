import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openStore } from "./db.ts";

const tags = { bug: "1", feature: "2", duplicate: "3", closed: "4" };

describe("store", () => {
  it("finds the thread that owns an issue, skipping merged duplicates", () => {
    const store = openStore(":memory:");
    store.saveGuild({ guildId: "g", repo: "o/r", forumId: "f", tags });
    store.saveReport({
      threadId: "dupe",
      guildId: "g",
      issueNumber: 7,
      status: "merged",
      mergedCommentId: 55,
    });
    store.saveReport({
      threadId: "owner",
      guildId: "g",
      issueNumber: 7,
      status: "open",
      mergedCommentId: null,
    });

    expect(store.findOwnerThread("g", 7)?.threadId).toBe("owner");
    expect(store.getReport("dupe")?.mergedCommentId).toBe(55);
    expect(store.countReports("g")).toEqual({ open: 1, closed: 0, merged: 1 });
    expect(store.getGuild("g")?.tags).toEqual(tags);
    store.close();
  });

  it("keeps data in a file across reopen and returns null for missing rows", () => {
    // Runs on both drivers via `pnpm test` and `pnpm test:bun`. Covers the
    // file path (directory creation, WAL) that :memory: skips.
    const dir = mkdtempSync(join(tmpdir(), "ferry-db-"));
    const path = join(dir, "nested", "ferry.db");
    try {
      const first = openStore(path);
      first.saveGuild({ guildId: "g", repo: "o/r", forumId: "f", tags });
      first.close();

      const second = openStore(path);
      expect(second.getGuild("g")?.repo).toBe("o/r");
      expect(second.getGuild("missing")).toBeNull();
      expect(second.getReport("missing")).toBeNull();
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
