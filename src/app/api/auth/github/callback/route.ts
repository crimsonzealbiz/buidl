import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { appUrl, githubOAuthConfig, sessionSecret } from "@/lib/config";
import { exchangeGithubCode } from "@/lib/auth/github-oauth";
import { createSession, OAUTH_STATE_COOKIE, SESSION_COOKIE, upsertGithubUser, verifySignedState } from "@/lib/auth/session";
import { GithubClient } from "@/lib/github/client";
import { AppError } from "@/lib/errors";

function fail(message: string) {
  const res = NextResponse.redirect(`${appUrl()}/?error=${encodeURIComponent(message)}`);
  res.cookies.delete({ name: OAUTH_STATE_COOKIE, path: "/api/auth/github" });
  return res;
}

export async function GET(req: NextRequest) {
  const oauth = githubOAuthConfig();
  const secret = sessionSecret();
  if (!oauth || !secret) return fail("GitHub sign-in is not configured");
  const params = req.nextUrl.searchParams;
  if (params.get("error")) return fail(`GitHub sign-in was cancelled: ${params.get("error")}`);
  const code = params.get("code");
  if (!code || !verifySignedState(req.cookies.get(OAUTH_STATE_COOKIE)?.value, params.get("state"), secret)) {
    return fail("Sign-in state did not match; please try again");
  }
  try {
    const token = await exchangeGithubCode({
      clientId: oauth.clientId,
      clientSecret: oauth.clientSecret,
      code,
      redirectUri: `${appUrl()}/api/auth/github/callback`,
    });
    const ghUser = await new GithubClient(token).getAuthenticatedUser();
    const db = await getDb();
    const user = await upsertGithubUser(db, ghUser);
    const session = await createSession(db, user.id, token);
    const res = NextResponse.redirect(`${appUrl()}/dashboard`);
    res.cookies.delete({ name: OAUTH_STATE_COOKIE, path: "/api/auth/github" });
    res.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: appUrl().startsWith("https://"),
      path: "/",
      expires: session.expiresAt,
    });
    return res;
  } catch (e) {
    return fail(e instanceof AppError ? e.message : "GitHub sign-in failed");
  }
}
