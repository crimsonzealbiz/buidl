import { NextResponse } from "next/server";
import { appUrl, githubOAuthConfig, sessionSecret } from "@/lib/config";
import { githubAuthorizeUrl } from "@/lib/auth/github-oauth";
import { OAUTH_STATE_COOKIE, signState } from "@/lib/auth/session";
import { randomToken } from "@/lib/ids";

export async function GET() {
  const oauth = githubOAuthConfig();
  const secret = sessionSecret();
  if (!oauth || !secret) {
    const missing = [!oauth && "GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET", !secret && "SESSION_SECRET"].filter(Boolean).join(", ");
    return NextResponse.redirect(`${appUrl()}/?error=${encodeURIComponent(`GitHub sign-in is not configured (${missing})`)}`);
  }
  const state = randomToken(16);
  const res = NextResponse.redirect(
    githubAuthorizeUrl({ clientId: oauth.clientId, redirectUri: `${appUrl()}/api/auth/github/callback`, state }),
  );
  res.cookies.set(OAUTH_STATE_COOKIE, signState(state, secret), {
    httpOnly: true,
    sameSite: "lax",
    secure: appUrl().startsWith("https://"),
    path: "/api/auth/github",
    maxAge: 600,
  });
  return res;
}
