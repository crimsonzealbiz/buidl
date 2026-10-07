import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { confirmations, contributions, repositories, submissions, teamMembers, teams, users } from "@/db/schema";
import type { Db } from "@/db";
import { AppError, assert } from "../errors";
import { newId, randomToken } from "../ids";
import type { User } from "../auth/session";
import { parseRepoRef } from "../github/client";
import type { Ctx } from "./context";
import { getEvent, isRegistered } from "./events";

export type Team = typeof teams.$inferSelect;
export type Repository = typeof repositories.$inferSelect;

export async function getTeam(db: Db, teamId: string) {
  const team = await db.query.teams.findFirst({ where: eq(teams.id, teamId) });
  if (!team) throw new AppError("not_found", "Team not found");
  return team;
}

export async function teamForUser(db: Db, eventId: string, userId: string) {
  const row = await db
    .select({ team: teams })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(teamMembers.eventId, eventId), eq(teamMembers.userId, userId)))
    .limit(1);
  return row[0]?.team ?? null;
}

export async function isTeamMember(db: Db, teamId: string, userId: string) {
  return !!(await db.query.teamMembers.findFirst({
    where: and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)),
  }));
}

export function listMembers(db: Db, teamId: string) {
  return db
    .select({ user: users, joinedAt: teamMembers.joinedAt })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teamMembers.teamId, teamId));
}

export function listTeams(db: Db, eventId: string) {
  return db.query.teams.findMany({ where: eq(teams.eventId, eventId) });
}

async function assertCanJoinEvent(ctx: Ctx, eventId: string, actor: User) {
  const event = await getEvent(ctx.db, eventId);
  assert(ctx.now() < event.submissionDeadline, "precondition_failed", "The submission deadline has passed");
  assert(await isRegistered(ctx.db, eventId, actor.id), "precondition_failed", "Register for the event first");
  assert(!(await teamForUser(ctx.db, eventId, actor.id)), "conflict", "You are already on a team for this event");
  return event;
}

export async function createTeam(ctx: Ctx, actor: User, eventId: string, name: string) {
  const parsedName = z.string().trim().min(2).max(80).parse(name);
  await assertCanJoinEvent(ctx, eventId, actor);
  return ctx.db.transaction(async (tx) => {
    const [team] = await tx
      .insert(teams)
      .values({ id: newId(), eventId, name: parsedName, joinCode: randomToken(6), createdBy: actor.id })
      .returning();
    await tx.insert(teamMembers).values({ teamId: team.id, userId: actor.id, eventId });
    return team;
  });
}

/** Joining requires the join code, which a teammate shares out of band. */
export async function joinTeam(ctx: Ctx, actor: User, joinCode: string) {
  const team = await ctx.db.query.teams.findFirst({ where: eq(teams.joinCode, joinCode.trim()) });
  assert(team, "not_found", "No team has this join code");
  const event = await assertCanJoinEvent(ctx, team.eventId, actor);
  const members = await listMembers(ctx.db, team.id);
  assert(members.length < event.maxTeamSize, "precondition_failed", `This team is full (max ${event.maxTeamSize} members)`);
  await ctx.db.insert(teamMembers).values({ teamId: team.id, userId: actor.id, eventId: team.eventId });
  return team;
}

/**
 * Leaves a team before the deadline. Only a draft (or changes-requested)
 * contribution can be abandoned; once a claim is under review or decided,
 * leaving would orphan a reviewed record, so it is refused. An empty team is
 * deleted along with its repository registration and submission.
 */
export async function leaveTeam(ctx: Ctx, actor: User, teamId: string) {
  const team = await getTeam(ctx.db, teamId);
  assert(await isTeamMember(ctx.db, teamId, actor.id), "forbidden", "You are not on this team");
  const event = await getEvent(ctx.db, team.eventId);
  assert(ctx.now() < event.submissionDeadline, "precondition_failed", "Teams are locked after the submission deadline");
  const submission = await ctx.db.query.submissions.findFirst({ where: eq(submissions.teamId, teamId) });
  const mine = submission
    ? await ctx.db.query.contributions.findFirst({
        where: and(eq(contributions.submissionId, submission.id), eq(contributions.userId, actor.id)),
      })
    : undefined;
  assert(
    !mine || mine.status === "draft" || mine.status === "changes_requested",
    "precondition_failed",
    "Your contribution is under review or decided; you cannot leave this team now",
  );
  return ctx.db.transaction(async (tx) => {
    if (mine) await tx.delete(contributions).where(eq(contributions.id, mine.id));
    if (submission) {
      // Corroborations the leaver gave on still-open claims no longer come from a teammate.
      const open = await tx
        .select({ id: contributions.id })
        .from(contributions)
        .where(
          and(
            eq(contributions.submissionId, submission.id),
            inArray(contributions.status, ["draft", "submitted", "changes_requested"]),
          ),
        );
      if (open.length) {
        await tx
          .delete(confirmations)
          .where(and(eq(confirmations.userId, actor.id), inArray(confirmations.contributionId, open.map((o) => o.id))));
      }
    }
    await tx.delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, actor.id)));
    const remaining = await tx.select().from(teamMembers).where(eq(teamMembers.teamId, teamId)).limit(1);
    if (remaining.length === 0) await tx.delete(teams).where(eq(teams.id, teamId));
    return { teamDeleted: remaining.length === 0 };
  });
}

export async function teamRepository(db: Db, teamId: string) {
  return (await db.query.repositories.findFirst({ where: eq(repositories.teamId, teamId) })) ?? null;
}

/**
 * Registers the team's repository and records its baseline: the head of the
 * default branch as reported by GitHub right now. Commits at or before the
 * baseline are treated as pre-existing work.
 */
export async function registerRepository(ctx: Ctx, actor: User, teamId: string, repoInput: string) {
  const team = await getTeam(ctx.db, teamId);
  assert(await isTeamMember(ctx.db, teamId, actor.id), "forbidden", "Only team members can register a repository");
  const event = await getEvent(ctx.db, team.eventId);
  const now = ctx.now();
  assert(now < event.submissionDeadline, "precondition_failed", "The submission deadline has passed");
  assert(!(await teamRepository(ctx.db, teamId)), "conflict", "This team already registered a repository");
  const ref = parseRepoRef(repoInput);
  assert(ref, "invalid_input", 'Enter a repository as "owner/name" or a github.com URL');

  const repo = await ctx.github.getRepo(ref.owner, ref.name);
  assert(repo, "not_found", `GitHub repository ${ref.owner}/${ref.name} was not found or is not public`);
  assert(!repo.private, "invalid_input", "Only public repositories are supported for now");
  const head = await ctx.github.getBranchHead(repo.owner.login, repo.name, repo.default_branch);

  const [row] = await ctx.db
    .insert(repositories)
    .values({
      id: newId(),
      teamId,
      owner: repo.owner.login,
      name: repo.name,
      githubRepoId: repo.id,
      defaultBranch: repo.default_branch,
      repoCreatedAt: new Date(repo.created_at),
      baselineSha: head?.sha ?? null,
      baselineCommittedAt: head?.commit.committer?.date ? new Date(head.commit.committer.date) : null,
      baselineCapturedAt: now,
      capturedAfterStart: now > event.startsAt,
    })
    .returning();
  return row;
}
