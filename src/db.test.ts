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
});
