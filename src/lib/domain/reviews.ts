import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { contributions, reviews, submissions, teams, users } from "@/db/schema";
import type { Db } from "@/db";
import { assert } from "../errors";
import { newId } from "../ids";
import type { User } from "../auth/session";
import { isStatKey } from "../proof/stats";
import type { Ctx } from "./context";
import { hasStaffRole } from "./events";
import { isTeamMember } from "./teams";
import { getContribution, getSubmission } from "./submissions";

export type Review = typeof reviews.$inferSelect;

export const reviewInput = z.object({
  decision: z.enum(["approved", "rejected", "changes_requested"]),
  rationale: z.string().trim().min(20, "Explain the decision in at least 20 characters").max(4000),
  selectedStats: z.array(z.string()).default([]),
});

/**
 * A reviewer decides on one builder's contribution. Reviewers must be event
 * staff, cannot review their own team, and must justify every decision.
 */
export async function reviewContribution(
  ctx: Ctx,
  actor: User,
  contributionId: string,
  raw: z.input<typeof reviewInput>,
) {
  const input = reviewInput.parse(raw);
  const c = await getContribution(ctx.db, contributionId);
  const submission = await getSubmission(ctx.db, c.submissionId);
  assert(
    await hasStaffRole(ctx.db, submission.eventId, actor.id, "reviewer"),
    "forbidden",
    "Only reviewers for this event can review contributions",
  );
  assert(c.userId !== actor.id, "forbidden", "You cannot review your own contribution");
  assert(
    !(await isTeamMember(ctx.db, submission.teamId, actor.id)),
    "forbidden",
    "Conflict of interest: you are on this team",
  );
  assert(c.status === "submitted", "precondition_failed", "Only submitted contributions can be reviewed");
  const unknown = input.selectedStats.filter((s) => !isStatKey(s));
  assert(unknown.length === 0, "invalid_input", `Unknown stats: ${unknown.join(", ")}`);
  assert(
    input.decision === "approved" || input.selectedStats.length === 0,
    "invalid_input",
    "Stats can only be selected when approving",
  );

  return ctx.db.transaction(async (tx) => {
    const [review] = await tx
      .insert(reviews)
      .values({
        id: newId(),
        contributionId,
        reviewerId: actor.id,
        decision: input.decision,
        rationale: input.rationale,
        selectedStats: [...new Set(input.selectedStats)],
        createdAt: ctx.now(),
      })
      .returning();
    await tx.update(contributions).set({ status: input.decision }).where(eq(contributions.id, contributionId));
    return review;
  });
}

export async function latestReview(db: Db, contributionId: string) {
  return (
    (await db.query.reviews.findFirst({
      where: eq(reviews.contributionId, contributionId),
      orderBy: [desc(reviews.createdAt)],
    })) ?? null
  );
}

export function reviewHistory(db: Db, contributionId: string) {
  return db
    .select({ review: reviews, reviewer: users })
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.reviewerId))
    .where(eq(reviews.contributionId, contributionId))
    .orderBy(desc(reviews.createdAt));
}

/** Contributions awaiting review for an event, excluding the reviewer's own team. */
export async function reviewQueue(ctx: Ctx, actor: User, eventId: string) {
  assert(await hasStaffRole(ctx.db, eventId, actor.id, "reviewer"), "forbidden", "You are not a reviewer for this event");
  const rows = await ctx.db
    .select({ contribution: contributions, submission: submissions, team: teams, user: users })
    .from(contributions)
    .innerJoin(submissions, eq(submissions.id, contributions.submissionId))
    .innerJoin(teams, eq(teams.id, submissions.teamId))
    .innerJoin(users, eq(users.id, contributions.userId))
    .where(eq(submissions.eventId, eventId));
  const out = [];
  for (const r of rows) {
    if (r.contribution.status !== "submitted") continue;
    if (await isTeamMember(ctx.db, r.team.id, actor.id)) continue;
    out.push(r);
  }
  return out;
}

export function reviewsByIds(db: Db, ids: string[]) {
  return ids.length ? db.query.reviews.findMany({ where: inArray(reviews.id, ids) }) : Promise.resolve([]);
}
