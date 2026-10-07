import { GithubClient, type FetchLike } from "@/lib/github/client";

/**
 * TEST DOUBLE for the GitHub REST API: an in-memory repository with a linear
 * history. It answers only the endpoints GithubClient calls. It is never
 * used by the app; live GitHub is required outside tests.
 */
export type StubCommit = { sha: string; authorId: number | null; date: string };
export type StubRepo = {
  id: number;
  owner: string;
  name: string;
  createdAt: string;
  commits: StubCommit[]; // oldest first
  pulls: { number: number; authorId: number }[];
  private?: boolean;
};

export class GithubStub {
  repos = new Map<string, StubRepo>();
  calls: string[] = [];

  addRepo(r: Omit<StubRepo, "commits" | "pulls"> & Partial<StubRepo>) {
    const repo: StubRepo = { commits: [], pulls: [], ...r };
    this.repos.set(`${r.owner}/${r.name}`.toLowerCase(), repo);
    return repo;
  }

  commit(repo: StubRepo, authorId: number | null, date = new Date().toISOString()) {
    const sha = (repo.commits.length + 1).toString(16).padStart(40, "a");
    repo.commits.push({ sha, authorId, date });
    return sha;
  }

  client(): GithubClient {
    return new GithubClient("test-token", this.fetch);
  }

  private json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }

  fetch: FetchLike = async (url) => {
    const path = new URL(url).pathname;
    this.calls.push(path);
    const m = path.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
    if (!m) return this.json({ message: "Not Found" }, 404);
    const repo = this.repos.get(`${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}`.toLowerCase());
    if (!repo) return this.json({ message: "Not Found" }, 404);
    const rest = m[3] ?? "";
    const idx = (ref: string) =>
      ref === "main" ? repo.commits.length - 1 : repo.commits.findIndex((c) => c.sha.startsWith(ref));
    const commitBody = (c: StubCommit) => ({
      sha: c.sha,
      author: c.authorId === null ? null : { id: c.authorId, login: `user${c.authorId}` },
      commit: { author: { date: c.date }, committer: { date: c.date }, message: "change" },
    });
    if (rest === "") {
      return this.json({
        id: repo.id,
        name: repo.name,
        full_name: `${repo.owner}/${repo.name}`,
        owner: { login: repo.owner },
        default_branch: "main",
        created_at: repo.createdAt,
        private: !!repo.private,
      });
    }
    let cm = rest.match(/^\/commits\/(.+)$/);
    if (cm) {
      if (repo.commits.length === 0) return this.json({ message: "Git Repository is empty." }, 409);
      const i = idx(decodeURIComponent(cm[1]));
      return i < 0 ? this.json({ message: "No commit found" }, 404) : this.json(commitBody(repo.commits[i]));
    }
    cm = rest.match(/^\/compare\/(.+)\.\.\.(.+)$/);
    if (cm) {
      const b = idx(decodeURIComponent(cm[1]));
      const h = idx(decodeURIComponent(cm[2]));
      if (b < 0 || h < 0) return this.json({ message: "Not Found" }, 404);
      return this.json({ status: h > b ? "ahead" : h < b ? "behind" : "identical" });
    }
    cm = rest.match(/^\/pulls\/(\d+)$/);
    if (cm) {
      const pr = repo.pulls.find((p) => p.number === Number(cm![1]));
      return pr
        ? this.json({
            number: pr.number,
            user: { id: pr.authorId, login: `user${pr.authorId}` },
            merged_at: null,
            created_at: new Date().toISOString(),
            base: { repo: { id: repo.id } },
          })
        : this.json({ message: "Not Found" }, 404);
    }
    return this.json({ message: "Not Found" }, 404);
  };
}
