import { AppError } from "../errors";
import type { FetchLike } from "../github/client";

/** Minimal scope: identity only. Repository reads use public endpoints. */
export const GITHUB_SCOPE = "read:user";

/** Override for GitHub Enterprise (or a local stub in end-to-end tests). */
function webUrl() {
  return (process.env.GITHUB_WEB_URL ?? "https://github.com").replace(/\/$/, "");
}

export function githubAuthorizeUrl(opts: { clientId: string; redirectUri: string; state: string }): string {
  const u = new URL(`${webUrl()}/login/oauth/authorize`);
  u.searchParams.set("client_id", opts.clientId);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("scope", GITHUB_SCOPE);
  u.searchParams.set("state", opts.state);
  u.searchParams.set("allow_signup", "true");
  return u.toString();
}

/** Exchanges an OAuth code for an access token with GitHub. */
export async function exchangeGithubCode(
  opts: { clientId: string; clientSecret: string; code: string; redirectUri: string },
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  let res: Response;
  try {
    res = await fetchImpl(`${webUrl()}/login/oauth/access_token`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
        code: opts.code,
        redirect_uri: opts.redirectUri,
      }),
    });
  } catch (e) {
    throw new AppError("upstream_failed", `GitHub OAuth unreachable: ${(e as Error).message}`);
  }
  if (!res.ok) throw new AppError("upstream_failed", `GitHub OAuth token exchange returned ${res.status}`);
  const body = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!body.access_token) {
    throw new AppError("unauthenticated", `GitHub OAuth failed: ${body.error_description ?? body.error ?? "no token"}`);
  }
  return body.access_token;
}
