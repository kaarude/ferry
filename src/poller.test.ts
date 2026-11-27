import { describe, expect, it } from "vitest";
import { syncAction } from "./poller.ts";

describe("syncAction", () => {
  it("mirrors closes and reopens, and leaves everything else alone", () => {
    expect(syncAction("open", { state: "closed" })).toBe("close");
    expect(syncAction("closed", { state: "open" })).toBe("reopen");
    expect(syncAction("open", { state: "open" })).toBeNull();
    expect(syncAction("merged", { state: "closed" })).toBeNull();
  });
});
