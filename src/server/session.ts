import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { resolveSession, SESSION_COOKIE, type SessionContext } from "@/lib/auth/session";
import { GithubClient } from "@/lib/github/client";
import type { Ctx } from "@/lib/domain/context";

export async function getSession(): Promise<SessionContext | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return resolveSession(await getDb(), token);
}

export async function requireSession(): Promise<SessionContext> {
  const s = await getSession();
  if (!s) redirect("/?error=" + encodeURIComponent("Sign in with GitHub to continue"));
  return s;
}

export async function makeCtx(session: SessionContext | null): Promise<Ctx> {
  return {
    db: await getDb(),
    github: new GithubClient(session?.githubAccessToken ?? process.env.GITHUB_TOKEN ?? null),
    now: () => new Date(),
  };
}
