import type { Repo } from "./format.ts";

// A small GitHub REST client built on fetch. Ferry only needs a handful of
// endpoints, so this avoids pulling in Octokit.

export type Issue = {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: "open" | "closed";
  state_reason: "completed" | "not_planned" | "duplicate" | "reopened" | null;
  updated_at: string;
  pull_request?: unknown;
};

export class GitHubError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class GitHub {
  readonly #token: string;

  constructor(token: string) {
    this.#token = token;
  }

  async #request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.#token}`,
        "User-Agent": "ferry-discord-bot",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new GitHubError(
        response.status,
        `GitHub ${method} ${path} failed (${response.status}): ${detail.slice(0, 300)}`,
      );
    }
    return response.status === 204
      ? (undefined as T)
      : ((await response.json()) as T);
  }

  /** Checks that the token can see the repo and has issues enabled. */
  async checkRepo(
    repo: Repo,
  ): Promise<{ fullName: string; hasIssues: boolean }> {
    const data = await this.#request<{
      full_name: string;
      has_issues: boolean;
    }>("GET", `/repos/${repo.owner}/${repo.name}`);
    return { fullName: data.full_name, hasIssues: data.has_issues };
  }

  createIssue(
    repo: Repo,
    issue: { title: string; body: string; labels: string[] },
  ) {
    return this.#request<Issue>(
      "POST",
      `/repos/${repo.owner}/${repo.name}/issues`,
      issue,
    );
  }

  getIssue(repo: Repo, number: number) {
    return this.#request<Issue>(
      "GET",
      `/repos/${repo.owner}/${repo.name}/issues/${number}`,
    );
  }

  closeIssue(
    repo: Repo,
    number: number,
    reason: "completed" | "not_planned" | "duplicate",
  ) {
    return this.#request<Issue>(
      "PATCH",
      `/repos/${repo.owner}/${repo.name}/issues/${number}`,
      {
        state: "closed",
        state_reason: reason,
      },
    );
  }

  comment(repo: Repo, number: number, body: string) {
    return this.#request<{ id: number; html_url: string }>(
      "POST",
      `/repos/${repo.owner}/${repo.name}/issues/${number}/comments`,
      { body },
    );
  }

  deleteComment(repo: Repo, commentId: number) {
    return this.#request<void>(
      "DELETE",
      `/repos/${repo.owner}/${repo.name}/issues/comments/${commentId}`,
    );
  }

  /** Most recently updated open issues (pull requests filtered out). */
  async listOpenIssues(repo: Repo, limit = 100): Promise<Issue[]> {
    const issues = await this.#request<Issue[]>(
      "GET",
      `/repos/${repo.owner}/${repo.name}/issues?state=open&sort=updated&per_page=${limit}`,
    );
    return issues.filter((issue) => !issue.pull_request);
  }

  /** Every issue (open or closed) updated after `since`, following pagination. */
  async listIssuesUpdatedSince(repo: Repo, since: string): Promise<Issue[]> {
    const all: Issue[] = [];
    for (let page = 1; page <= 10; page++) {
      const batch = await this.#request<Issue[]>(
        "GET",
        `/repos/${repo.owner}/${repo.name}/issues?state=all&since=${encodeURIComponent(since)}&per_page=100&page=${page}`,
      );
      all.push(...batch.filter((issue) => !issue.pull_request));
      if (batch.length < 100) break;
    }
    return all;
  }
}
