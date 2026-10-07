import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  CONTRIBUTION_CATEGORIES,
  EVIDENCE_KINDS,
  confirmations,
  contributions,
  evidence,
  submissions,
  teams,
  users,
} from "@/db/schema";
import type { Db } from "@/db";
import { AppError, assert } from "../errors";
import { newId } from "../ids";
import type { User } from "../auth/session";
import { parseGithubEvidenceUrl } from "../github/client";
import type { Ctx } from "./context";
import { getEvent } from "./events";
import { getTeam, isTeamMember, teamRepository, type Repository } from "./teams";

export type Submission = typeof submissions.$inferSelect;
export type Contribution = typeof contributions.$inferSelect;
export type Evidence = typeof evidence.$inferSelect;

const httpsUrl = z
  .string()
  .trim()
  .url()
  .refine((u) => u.startsWith("https://"), "Must be an https:// URL");

export const submissionInput = z.object({
  productName: z.string().trim().min(2).max(120),
  summary: z.string().trim().min(20, "Describe the product in at least 20 characters").max(4000),
  demoUrl: httpsUrl.optional().or(z.literal("").transform(() => undefined)),
});

/**
 * Creates or updates the team's product submission until the deadline. The
 * final commit is re-captured from GitHub each time it is saved.
 */
export async function saveSubmission(ctx: Ctx, actor: User, teamId: string, raw: z.input<typeof submissionInput>) {
  const input = submissionInput.parse(raw);
  const team = await getTeam(ctx.db, teamId);
  assert(await isTeamMember(ctx.db, teamId, actor.id), "forbidden", "Only team members can submit");
  const event = await getEvent(ctx.db, team.eventId);
  assert(ctx.now() < event.submissionDeadline, "precondition_failed", "The submission deadline has passed");
  const repo = await teamRepository(ctx.db, teamId);
  assert(repo, "precondition_failed", "Register the team repository before submitting");
  const head = await ctx.github.getBranchHead(repo.owner, repo.name, repo.defaultBranch);
  const values = {
    productName: input.productName,
    summary: input.summary,
    demoUrl: input.demoUrl ?? null,
    finalSha: head?.sha ?? null,
    submittedBy: actor.id,
    submittedAt: ctx.now(),
  };
  const [row] = await ctx.db
    .insert(submissions)
    .values({ id: newId(), teamId, eventId: team.eventId, ...values })
    .onConflictDoUpdate({ target: submissions.teamId, set: values })
    .returning();
  return row;
}

export async function getSubmission(db: Db, id: string) {
  const s = await db.query.submissions.findFirst({ where: eq(submissions.id, id) });
  if (!s) throw new AppError("not_found", "Submission not found");
  return s;
}

export async function submissionForTeam(db: Db, teamId: string) {
  return (await db.query.submissions.findFirst({ where: eq(submissions.teamId, teamId) })) ?? null;
}

export async function getContribution(db: Db, id: string) {
  const c = await db.query.contributions.findFirst({ where: eq(contributions.id, id) });
  if (!c) throw new AppError("not_found", "Contribution not found");
  return c;
}

export const contributionInput = z.object({
  category: z.enum(CONTRIBUTION_CATEGORIES),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(40, "Describe what you did in at least 40 characters").max(4000),
});

/**
 * Each builder writes their own contribution claim; nobody can claim on
 * behalf of a teammate, and membership alone never yields a proof.
 */
export async function saveContribution(
  ctx: Ctx,
  actor: User,
  submissionId: string,
  raw: z.input<typeof contributionInput>,
) {
  const input = contributionInput.parse(raw);
  const submission = await getSubmission(ctx.db, submissionId);
  assert(await isTeamMember(ctx.db, submission.teamId, actor.id), "forbidden", "Only team members can add contributions");
  const event = await getEvent(ctx.db, submission.eventId);
  const existing = await ctx.db.query.contributions.findFirst({
    where: and(eq(contributions.submissionId, submissionId), eq(contributions.userId, actor.id)),
  });
  if (existing) {
    assert(
      existing.status === "draft" || existing.status === "changes_requested",
      "precondition_failed",
      "This contribution is under review or decided and can no longer be edited",
    );
    const [row] = await ctx.db.update(contributions).set(input).where(eq(contributions.id, existing.id)).returning();
    return row;
  }
  assert(ctx.now() < event.submissionDeadline, "precondition_failed", "The submission deadline has passed");
  const [row] = await ctx.db
    .insert(contributions)
    .values({ id: newId(), submissionId, userId: actor.id, ...input })
    .returning();
  return row;
}

async function editableOwnContribution(ctx: Ctx, actor: User, contributionId: string) {
  const c = await getContribution(ctx.db, contributionId);
  assert(c.userId === actor.id, "forbidden", "You can only change your own contribution");
  assert(
    c.status === "draft" || c.status === "changes_requested",
    "precondition_failed",
    "This contribution is under review or decided and can no longer be edited",
  );
  return c;
}

export const evidenceInput = z.object({
  kind: z.enum(EVIDENCE_KINDS),
  url: httpsUrl,
  description: z.string().trim().min(10).max(1000),
});

type VerificationResult = {
  verification: Evidence["verification"];
  ref: string | null;
  detail: Record<string, unknown>;
};

/**
 * Checks commit / pull request evidence against GitHub: it must be in the
 * team's registered repository, authored by this builder's GitHub account,
 * and (for commits) made after the baseline and contained in the submission.
 * This establishes authorship only; whether the work is meaningful is a
 * reviewer's judgement.
 */
async function verifyGithubEvidence(
  ctx: Ctx,
  actor: User,
  repo: Repository,
  finalSha: string | null,
  kind: Evidence["kind"],
  url: string,
): Promise<VerificationResult> {
  const parsed = parseGithubEvidenceUrl(url);
  const expected = kind === "commit" ? "commit" : "pull";
  assert(
    parsed && parsed.type === expected,
    "invalid_input",
    kind === "commit"
      ? "Commit evidence must be a https://github.com/<owner>/<repo>/commit/<sha> URL"
      : "Pull request evidence must be a https://github.com/<owner>/<repo>/pull/<n> URL",
  );
  const sameRepo =
    parsed.owner.toLowerCase() === repo.owner.toLowerCase() && parsed.name.toLowerCase() === repo.name.toLowerCase();
  assert(sameRepo, "invalid_input", `Evidence must be in the registered repository ${repo.owner}/${repo.name}`);
  const fail = (reason: string, ref: string | null): VerificationResult => ({
    verification: "github_check_failed",
    ref,
    detail: { reason },
  });

  if (parsed.type === "pull") {
    const pr = await ctx.github.getPull(repo.owner, repo.name, parsed.number);
    if (!pr) return fail("Pull request not found", String(parsed.number));
    if (pr.user?.id !== actor.githubId) return fail("Pull request was opened by a different GitHub account", String(parsed.number));
    return {
      verification: "github_author_verified",
      ref: String(parsed.number),
      detail: { openedAt: pr.created_at, mergedAt: pr.merged_at },
    };
  }

  const commit = await ctx.github.getCommit(repo.owner, repo.name, parsed.sha);
  if (!commit) return fail("Commit not found in the repository", parsed.sha);
  const sha = commit.sha;
  if (commit.author?.id !== actor.githubId) {
    return fail("Commit is not attributed to your GitHub account", sha);
  }
  if (repo.baselineSha) {
    if (sha === repo.baselineSha) return fail("Commit is the registration baseline (pre-existing work)", sha);
    const vsBaseline = await ctx.github.compare(repo.owner, repo.name, repo.baselineSha, sha);
    if (vsBaseline?.status !== "ahead") return fail("Commit predates or is not built on the registration baseline", sha);
  }
  if (finalSha) {
    const vsFinal = await ctx.github.compare(repo.owner, repo.name, sha, finalSha);
    if (vsFinal?.status !== "ahead" && vsFinal?.status !== "identical") {
      return fail("Commit is not part of the submitted code", sha);
    }
  }
  return {
    verification: "github_author_verified",
    ref: sha,
    detail: { authoredAt: commit.commit.author?.date ?? null, baselineSha: repo.baselineSha, finalSha },
  };
}

export async function addEvidence(ctx: Ctx, actor: User, contributionId: string, raw: z.input<typeof evidenceInput>) {
  const input = evidenceInput.parse(raw);
  const c = await editableOwnContribution(ctx, actor, contributionId);
  const submission = await getSubmission(ctx.db, c.submissionId);
  let result: VerificationResult = { verification: "unverified", ref: null, detail: {} };
  if (input.kind === "commit" || input.kind === "pull_request") {
    const repo = await teamRepository(ctx.db, submission.teamId);
    assert(repo, "precondition_failed", "The team has no registered repository");
    result = await verifyGithubEvidence(ctx, actor, repo, submission.finalSha, input.kind, input.url);
  }
  const [row] = await ctx.db
    .insert(evidence)
    .values({
      id: newId(),
      contributionId,
      kind: input.kind,
      url: input.url,
      description: input.description,
      ref: result.ref,
      verification: result.verification,
      verificationDetail: result.detail,
    })
    .returning();
  return row;
}

export async function removeEvidence(ctx: Ctx, actor: User, evidenceId: string) {
  const ev = await ctx.db.query.evidence.findFirst({ where: eq(evidence.id, evidenceId) });
  assert(ev, "not_found", "Evidence not found");
  await editableOwnContribution(ctx, actor, ev.contributionId);
  await ctx.db.delete(evidence).where(eq(evidence.id, evidenceId));
}

export function listEvidence(db: Db, contributionId: string) {
  return db.query.evidence.findMany({ where: eq(evidence.contributionId, contributionId), orderBy: [asc(evidence.createdAt)] });
}

export async function submitContribution(ctx: Ctx, actor: User, contributionId: string) {
  const c = await editableOwnContribution(ctx, actor, contributionId);
  const items = await listEvidence(ctx.db, contributionId);
  assert(items.length > 0, "precondition_failed", "Add at least one piece of evidence before submitting for review");
  const [row] = await ctx.db
    .update(contributions)
    .set({ status: "submitted", submittedAt: ctx.now() })
    .where(eq(contributions.id, c.id))
    .returning();
  return row;
}

/**
 * A teammate corroborates, or disputes, someone else's claim while it is still
 * open. Disputes are shown to reviewers; self-confirmation is not allowed.
 */
export async function confirmContribution(
  ctx: Ctx,
  actor: User,
  contributionId: string,
  statement: string,
  stance: "confirm" | "dispute" = "confirm",
) {
  const text = z.string().trim().min(10, "Write at least 10 characters").max(1000).parse(statement);
  const c = await getContribution(ctx.db, contributionId);
  assert(c.userId !== actor.id, "forbidden", "You cannot confirm your own contribution");
  const submission = await getSubmission(ctx.db, c.submissionId);
  assert(await isTeamMember(ctx.db, submission.teamId, actor.id), "forbidden", "Only teammates can confirm a contribution");
  assert(
    c.status === "draft" || c.status === "submitted" || c.status === "changes_requested",
    "precondition_failed",
    "This contribution has already been decided",
  );
  await ctx.db
    .insert(confirmations)
    .values({ contributionId, userId: actor.id, statement: text, stance })
    .onConflictDoUpdate({
      target: [confirmations.contributionId, confirmations.userId],
      set: { statement: text, stance },
    });
}

export function listConfirmations(db: Db, contributionId: string) {
  return db
    .select({ statement: confirmations.statement, stance: confirmations.stance, createdAt: confirmations.createdAt, user: users })
    .from(confirmations)
    .innerJoin(users, eq(users.id, confirmations.userId))
    .where(eq(confirmations.contributionId, contributionId));
}

export function listContributions(db: Db, submissionId: string) {
  return db
    .select({ contribution: contributions, user: users })
    .from(contributions)
    .innerJoin(users, eq(users.id, contributions.userId))
    .where(eq(contributions.submissionId, submissionId));
}

export function contributionsForUser(db: Db, userId: string) {
  return db
    .select({ contribution: contributions, submission: submissions, team: teams })
    .from(contributions)
    .innerJoin(submissions, eq(submissions.id, contributions.submissionId))
    .innerJoin(teams, eq(teams.id, submissions.teamId))
    .where(eq(contributions.userId, userId));
}

export type CommitSuggestion = { sha: string; url: string; message: string; date: string | null; alreadyAdded: boolean };

/**
 * The builder's own commits in the team repository since the baseline, to
 * pick as evidence. Picking one still runs the full verification in addEvidence.
 */
export async function suggestCommits(ctx: Ctx, actor: User, contributionId: string): Promise<CommitSuggestion[]> {
  const c = await getContribution(ctx.db, contributionId);
  assert(c.userId === actor.id, "forbidden", "You can only see suggestions for your own contribution");
  const submission = await getSubmission(ctx.db, c.submissionId);
  const repo = await teamRepository(ctx.db, submission.teamId);
  if (!repo) return [];
  const commits = await ctx.github.listCommits(repo.owner, repo.name, repo.defaultBranch, actor.githubLogin);
  const added = new Set((await listEvidence(ctx.db, c.id)).map((e) => e.ref));
  const out: CommitSuggestion[] = [];
  for (const cm of commits) {
    if (cm.sha === repo.baselineSha) break; // older commits predate registration
    if (cm.author?.id !== actor.githubId) continue;
    out.push({
      sha: cm.sha,
      url: `https://github.com/${repo.owner}/${repo.name}/commit/${cm.sha}`,
      message: cm.commit.message.split("\n")[0].slice(0, 200),
      date: cm.commit.author?.date ?? null,
      alreadyAdded: added.has(cm.sha),
    });
  }
  return out;
}
