import { AppError } from "../errors";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type GithubUser = { id: number; login: string; name: string | null; avatar_url: string | null };
export type GithubRepo = {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  default_branch: string;
  created_at: string;
  private: boolean;
};
export type GithubCommit = {
  sha: string;
  author: { id: number; login: string } | null;
  commit: { author: { date: string } | null; committer: { date: string } | null; message: string };
};
export type GithubCompare = { status: "ahead" | "behind" | "identical" | "diverged" };
export type GithubPull = {
  number: number;
  user: { id: number; login: string } | null;
  merged_at: string | null;
  created_at: string;
  base: { repo: { id: number } };
};


/**
 * Minimal GitHub REST client. Uses the signed-in user's OAuth token when
 * available. `fetch` is injectable so tests can supply recorded responses.
 */
export class GithubClient {
  constructor(
    private readonly token: string | null,
    private readonly fetchImpl: FetchLike = fetch,
    /** Override for GitHub Enterprise (or a local stub in end-to-end tests). */
    private readonly baseUrl = (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/$/, ""),
  ) {}

  private async get<T>(path: string, allow404 = false): Promise<T | null> {
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "buidl-identity",
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, { headers });
    } catch (e) {
      throw new AppError("upstream_failed", `GitHub API unreachable: ${(e as Error).message}`);
    }
    if (res.status === 404 && allow404) return null;
    // An empty repository answers commit queries with 409.
    if (res.status === 409 && allow404) return null;
    if (!res.ok) {
      throw new AppError("upstream_failed", `GitHub API ${path} returned ${res.status}`);
    }
    return (await res.json()) as T;
  }

  getAuthenticatedUser() {
    return this.get<GithubUser>("/user") as Promise<GithubUser>;
  }

  getRepo(owner: string, repo: string) {
    return this.get<GithubRepo>(`/repos/${enc(owner)}/${enc(repo)}`, true);
  }

  /** Head commit of a branch, or null when the repository has no commits. */
  getBranchHead(owner: string, repo: string, branch: string) {
    return this.get<GithubCommit>(`/repos/${enc(owner)}/${enc(repo)}/commits/${enc(branch)}`, true);
  }

  /** Recent commits on a branch by an author (newest first). */
  async listCommits(owner: string, repo: string, branch: string, authorLogin: string, perPage = 30) {
    const q = new URLSearchParams({ sha: branch, author: authorLogin, per_page: String(perPage) });
    return (await this.get<GithubCommit[]>(`/repos/${enc(owner)}/${enc(repo)}/commits?${q}`, true)) ?? [];
  }

  getCommit(owner: string, repo: string, sha: string) {
    return this.get<GithubCommit>(`/repos/${enc(owner)}/${enc(repo)}/commits/${enc(sha)}`, true);
  }

  /** How `head` relates to `base` ("ahead" means head contains base plus more). */
  compare(owner: string, repo: string, base: string, head: string) {
    return this.get<GithubCompare>(
      `/repos/${enc(owner)}/${enc(repo)}/compare/${enc(base)}...${enc(head)}`,
      true,
    );
  }

  getPull(owner: string, repo: string, number: number) {
    return this.get<GithubPull>(`/repos/${enc(owner)}/${enc(repo)}/pulls/${number}`, true);
  }
}

function enc(s: string) {
  return encodeURIComponent(s);
}

/** Parses "owner/repo" or a github.com URL. */
export function parseRepoRef(input: string): { owner: string; name: string } | null {
  const trimmed = input.trim().replace(/\.git$/, "").replace(/\/$/, "");
  const m =
    trimmed.match(/^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)$/i) ??
    trimmed.match(/^([\w.-]+)\/([\w.-]+)$/);
  return m ? { owner: m[1], name: m[2] } : null;
}

/** Parses a github.com commit or pull request URL. */
export function parseGithubEvidenceUrl(
  url: string,
):
  | { type: "commit"; owner: string; name: string; sha: string }
  | { type: "pull"; owner: string; name: string; number: number }
  | null {
  const commit = url.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/commit\/([0-9a-f]{7,40})\/?$/i);
  if (commit) return { type: "commit", owner: commit[1], name: commit[2], sha: commit[3].toLowerCase() };
  const pull = url.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\/?$/i);
  if (pull) return { type: "pull", owner: pull[1], name: pull[2], number: Number(pull[3]) };
  return null;
}
