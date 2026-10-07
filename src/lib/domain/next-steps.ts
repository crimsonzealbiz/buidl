import { eq } from "drizzle-orm";
import { eventStaff, events, registrations } from "@/db/schema";
import type { Db } from "@/db";
import type { User } from "../auth/session";
import { activeWallet } from "../wallet/link";
import { proofForContribution } from "../proof/service";
import { teamForUser, teamRepository } from "./teams";
import { listContributions, listEvidence, submissionForTeam } from "./submissions";
import { isTeamMember, listTeams } from "./teams";

export type Step = { label: string; href: string; detail?: string };

/**
 * The single most useful next action per event for a builder, plus staff
 * work waiting on them. Drives the dashboard so nobody has to guess.
 */
export async function nextSteps(db: Db, user: User, now = new Date()): Promise<{ builder: Step[]; staff: Step[] }> {
  const builder: Step[] = [];
  const staff: Step[] = [];
  const wallet = await activeWallet(db, user.id);

  const regs = await db
    .select({ event: events })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .where(eq(registrations.userId, user.id));
  if (regs.length === 0) builder.push({ label: "Register for an event", href: "/events" });

  for (const { event } of regs) {
    const ev = `/events/${event.slug}`;
    const open = now < event.submissionDeadline;
    const team = await teamForUser(db, event.id, user.id);
    if (!team) {
      if (open) builder.push({ label: `Create or join a team for ${event.name}`, href: ev });
      continue;
    }
    if (!(await teamRepository(db, team.id))) {
      if (open) builder.push({ label: `Register your team's repository for ${event.name}`, href: ev });
      continue;
    }
    const submission = await submissionForTeam(db, team.id);
    if (!submission) {
      if (open) builder.push({ label: `Submit your product for ${event.name}`, href: ev });
      continue;
    }
    const mine = (await listContributions(db, submission.id)).find((c) => c.user.id === user.id)?.contribution;
    if (!mine) {
      if (open) builder.push({ label: `Describe your own contribution to ${submission.productName}`, href: ev });
      continue;
    }
    const href = `/contributions/${mine.id}`;
    switch (mine.status) {
      case "draft":
        builder.push(
          (await listEvidence(db, mine.id)).length === 0
            ? { label: `Add evidence to "${mine.title}"`, href }
            : { label: `Submit "${mine.title}" for review`, href },
        );
        break;
      case "changes_requested":
        builder.push({ label: `A reviewer asked for changes to "${mine.title}"`, href });
        break;
      case "submitted":
        builder.push({ label: `"${mine.title}" is waiting for a reviewer`, href, detail: "Nothing to do yet" });
        break;
      case "approved": {
        const proof = await proofForContribution(db, mine.id);
        if (!wallet) builder.push({ label: "Link a wallet to receive your approved proof", href: "/wallet" });
        else if (!proof || proof.status === "failed" || proof.status === "sent" || proof.status === "pending") {
          builder.push({ label: `Issue your proof for "${mine.title}"`, href });
        } else if (proof.status === "confirmed") {
          builder.push({ label: `Share your verified proof for "${mine.title}"`, href: `/proofs/${proof.id}`, detail: "Done" });
        }
        break;
      }
      case "rejected":
        builder.push({ label: `"${mine.title}" was not approved`, href, detail: "See the reviewer's rationale" });
        break;
    }
  }
  if (!wallet && !builder.some((s) => s.href === "/wallet")) {
    builder.push({ label: "Link a Solana wallet (proofs are issued to it)", href: "/wallet" });
  }

  const roles = await db
    .select({ role: eventStaff.role, event: events })
    .from(eventStaff)
    .innerJoin(events, eq(events.id, eventStaff.eventId))
    .where(eq(eventStaff.userId, user.id));
  for (const { role, event } of roles) {
    if (role === "reviewer") {
      let pending = 0;
      for (const t of await listTeams(db, event.id)) {
        const sub = await submissionForTeam(db, t.id);
        if (!sub) continue;
        // Own team's claims are excluded from the queue (conflict of interest).
        if (await isTeamMember(db, t.id, user.id)) continue;
        const rows = await listContributions(db, sub.id);
        pending += rows.filter((r) => r.contribution.status === "submitted").length;
      }
      staff.push({
        label: `Review queue for ${event.name}`,
        href: `/events/${event.slug}/review`,
        detail: pending ? `${pending} awaiting review` : "Nothing waiting",
      });
    } else {
      staff.push({ label: `Manage ${event.name}`, href: `/events/${event.slug}`, detail: "Organizer" });
    }
  }
  return { builder, staff };
}
