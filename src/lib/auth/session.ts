import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { Db } from "@/db";
import { sessions, users } from "@/db/schema";
import { newId, randomToken } from "../ids";
import type { GithubUser } from "../github/client";
import { decryptSecret, encryptSecret } from "../crypto";

export const SESSION_COOKIE = "buidl_session";
export const OAUTH_STATE_COOKIE = "buidl_oauth_state";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

export type User = typeof users.$inferSelect;
export type SessionContext = { user: User; githubAccessToken: string | null };

function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

/** Creates or refreshes the user record for a GitHub identity. */
export async function upsertGithubUser(db: Db, gh: GithubUser): Promise<User> {
  const existing = await db.query.users.findFirst({ where: eq(users.githubId, gh.id) });
  if (existing) {
    const [updated] = await db
      .update(users)
      .set({ githubLogin: gh.login, name: gh.name, avatarUrl: gh.avatar_url })
      .where(eq(users.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(users)
    .values({ id: newId(), githubId: gh.id, githubLogin: gh.login, name: gh.name, avatarUrl: gh.avatar_url })
    .returning();
  return created;
}

/** Starts a session and returns the raw token for the cookie. */
export async function createSession(
  db: Db,
  userId: string,
  githubAccessToken: string | null,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    id: newId(),
    tokenHash: sha256(token),
    userId,
    githubAccessToken: githubAccessToken ? encryptSecret(githubAccessToken) : null,
    expiresAt,
  });
  return { token, expiresAt };
}

export async function resolveSession(db: Db, token: string | undefined, now = new Date()): Promise<SessionContext | null> {
  if (!token) return null;
  const row = await db
    .select({ user: users, githubAccessToken: sessions.githubAccessToken })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, now)))
    .limit(1);
  if (!row[0]) return null;
  const stored = row[0].githubAccessToken;
  return { user: row[0].user, githubAccessToken: stored ? decryptSecret(stored) : null };
}

export async function destroySession(db: Db, token: string | undefined) {
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

/** OAuth `state` is a random value bound to the browser by an HMAC-signed cookie. */
export function signState(state: string, secret: string): string {
  return `${state}.${createHmac("sha256", secret).update(state).digest("base64url")}`;
}

export function verifySignedState(cookieValue: string | undefined, returnedState: string | null, secret: string) {
  if (!cookieValue || !returnedState) return false;
  const expected = Buffer.from(signState(returnedState, secret));
  const actual = Buffer.from(cookieValue);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
