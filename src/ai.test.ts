import { describe, expect, it } from "vitest";
import { pickDuplicate } from "./ai.ts";
import type { Issue } from "./github.ts";

const issue = (number: number) => ({ number }) as Issue;
const candidates = [issue(4), issue(9)];

describe("pickDuplicate", () => {
  it("merges only on a high-confidence match to a shown issue", () => {
    expect(
      pickDuplicate(
        { duplicate_of: 9, confidence: "high", reason: "same crash" },
        candidates,
      ),
    ).toEqual({ issueNumber: 9, reason: "same crash" });
  });

  it("ignores medium confidence", () => {
    expect(
      pickDuplicate(
        { duplicate_of: 9, confidence: "medium", reason: "" },
        candidates,
      ),
    ).toBeNull();
  });

  it("ignores issue numbers the model was never shown", () => {
    expect(
      pickDuplicate(
        { duplicate_of: 1, confidence: "high", reason: "" },
        candidates,
      ),
    ).toBeNull();
  });
});
