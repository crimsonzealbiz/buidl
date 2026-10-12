import { eq } from "drizzle-orm";
import { teamMembers } from "@/db/schema";
import type { Db } from "@/db";
import { proofForContribution } from "../proof/service";
import { getEvent } from "./events";
import { getTeam, listMembers, teamRepository } from "./teams";
import { listContributions, listEvidence, submissionForTeam } from "./submissions";
import { buildStatus, contributionStage, eventPhase, type ContributionStage, type ProofStatus } from "./lifecycle";

/**
 * A build is a team's product at an event: its members, repository,
 * submission, and each contributor's own claim and proof.
 */
export async function buildView(db: Db, teamId: string, now = new Date()) {
  const team = await getTeam(db, teamId);
  const event = await getEvent(db, team.eventId);
  const repo = await teamRepository(db, team.id);
  const submission = await submissionForTeam(db, team.id);
  const claims = submission ? await listContributions(db, submission.id) : [];
  const members = await Promise.all(
    (await listMembers(db, team.id)).map(async (m) => {
      const contribution = claims.find((c) => c.user.id === m.user.id)?.contribution ?? null;
      const proof = contribution ? await proofForContribution(db, contribution.id) : null;
      const stage: ContributionStage | null = contribution
        ? contributionStage(contribution.status, proof?.status as ProofStatus | undefined)
        : null;
      const evidenceCount = contribution ? (await listEvidence(db, contribution.id)).length : 0;
      return { user: m.user, joinedAt: m.joinedAt, contribution, proof, stage, evidenceCount };
    }),
  );
  const status = buildStatus(!!submission, members.map((m) => m.stage).filter((s): s is ContributionStage => !!s));
  return { team, event, phase: eventPhase(event, now), repo, submission, members, status };
}

export type BuildView = Awaited<ReturnType<typeof buildView>>;

/** Every build a builder is part of, newest event first. */
export async function buildsForUser(db: Db, userId: string, now = new Date()) {
  const rows = await db.query.teamMembers.findMany({ where: eq(teamMembers.userId, userId) });
  const views = await Promise.all(rows.map((r) => buildView(db, r.teamId, now)));
  return views.sort((a, b) => b.event.startsAt.getTime() - a.event.startsAt.getTime());
}
