import { describe, expect, it } from "vitest";
import {
  forwardedComment,
  issueBody,
  neutralizeMentions,
  parseRepo,
} from "./format.ts";

describe("parseRepo", () => {
  it("accepts owner/name and GitHub URLs", () => {
    expect(parseRepo("kaarude/ferry")).toEqual({
      owner: "kaarude",
      name: "ferry",
    });
    expect(parseRepo("https://github.com/kaarude/ferry.git")).toEqual({
      owner: "kaarude",
      name: "ferry",
    });
  });

  it("rejects anything that could escape the API path", () => {
    expect(parseRepo("kaarude")).toBeNull();
    expect(parseRepo("kaarude/ferry/issues")).toBeNull();
    expect(parseRepo("../../user")).toBeNull();
  });
});

describe("neutralizeMentions", () => {
  it("breaks user and team mentions but keeps emails readable", () => {
    const out = neutralizeMentions("cc @octocat and @org/team, mail me@x.dev");
    expect(out).not.toMatch(/@[\w-]/);
    expect(out.replaceAll("​", "")).toBe(
      "cc @octocat and @org/team, mail me@x.dev",
    );
  });
});

describe("issueBody", () => {
  it("credits the reporter, links the thread, and notes attachments", () => {
    const body = issueBody({
      content: "Crash on save @maintainer",
      authorName: "carl",
      threadUrl: "https://discord.com/channels/1/2",
      attachmentCount: 2,
    });
    expect(body).toContain("Crash on save @​maintainer");
    expect(body).toContain("[Discord](https://discord.com/channels/1/2)");
    expect(body).toContain("2 attachment(s)");
  });

  it("truncates huge posts below GitHub's body limit", () => {
    const body = issueBody({
      content: "x".repeat(100_000),
      authorName: "carl",
      threadUrl: "https://discord.com/channels/1/2",
      attachmentCount: 0,
    });
    expect(body.length).toBeLessThan(65_536);
    expect(body).toContain("truncated");
  });
});

describe("forwardedComment", () => {
  it("quotes every line of a multi-line message", () => {
    const comment = forwardedComment(
      "carl",
      "line one\nline two",
      "https://discord.com/x",
    );
    expect(comment).toContain("> line one\n> line two");
  });
});
