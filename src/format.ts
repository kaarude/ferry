// Pure text helpers: everything that turns Discord content into GitHub markdown.
// Kept free of Discord and network code so it is easy to test.

export type Repo = { owner: string; name: string };

/** The kind of report, picked by the forum tag the user chose. */
export type ReportKind = "bug" | "feature";

/** GitHub label applied for each report kind. */
export const KIND_LABEL: Record<ReportKind, string> = {
  bug: "bug",
  feature: "enhancement",
};

/** Extra label on every issue Ferry files, so maintainers can filter them. */
export const SOURCE_LABEL = "discord";

const GITHUB_BODY_LIMIT = 60_000; // GitHub allows 65,536; leave room for the footer.

/** Parses "owner/name" or a github.com URL. Returns null for anything else. */
export function parseRepo(input: string): Repo | null {
  const cleaned = input
    .trim()
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  const match = /^([\w.-]+)\/([\w.-]+)$/.exec(cleaned);
  if (!match?.[1] || !match[2]) return null;
  return { owner: match[1], name: match[2] };
}

export const repoSlug = (repo: Repo) => `${repo.owner}/${repo.name}`;

/**
 * Breaks GitHub @mentions in user-supplied text. Without this, anyone could
 * post "@some-maintainer" or "@org/team" on Discord and Ferry's token would
 * send those people a GitHub notification on their behalf.
 */
export function neutralizeMentions(text: string): string {
  return text.replace(/@(?=[\w-])/g, "@​");
}

function truncate(text: string, limit: number): string {
  return text.length <= limit
    ? text
    : `${text.slice(0, limit)}\n\n_(truncated, see the Discord thread for the full text)_`;
}

/** Quotes every line so text renders as a markdown blockquote. */
function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

export type ReportInput = {
  content: string;
  authorName: string;
  threadUrl: string;
  attachmentCount: number;
};

/** Body of a new GitHub issue created from a forum post. */
export function issueBody(report: ReportInput): string {
  const content = report.content.trim() || "_No description provided._";
  const attachments =
    report.attachmentCount > 0
      ? `\n\n_${report.attachmentCount} attachment(s) on Discord, open the thread to see them._`
      : "";
  return [
    truncate(neutralizeMentions(content), GITHUB_BODY_LIMIT) + attachments,
    "---",
    `Reported by **${neutralizeMentions(report.authorName)}** on [Discord](${report.threadUrl}). Filed by Ferry.`,
  ].join("\n\n");
}

/** Comment left on the original issue when a new post is merged as a duplicate. */
export function duplicateComment(report: ReportInput, title: string): string {
  return [
    `**${neutralizeMentions(report.authorName)}** reported the same thing on [Discord](${report.threadUrl}):`,
    `<details><summary>${neutralizeMentions(escapeHtml(title))}</summary>\n\n${truncate(
      neutralizeMentions(report.content.trim()),
      GITHUB_BODY_LIMIT,
    )}\n\n</details>`,
  ].join("\n\n");
}

/** Comment created by the "Send to GitHub" message action. */
export function forwardedComment(
  authorName: string,
  content: string,
  messageUrl: string,
): string {
  return [
    `**${neutralizeMentions(authorName)}** wrote on [Discord](${messageUrl}):`,
    quote(truncate(neutralizeMentions(content.trim()), GITHUB_BODY_LIMIT)),
  ].join("\n\n");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
