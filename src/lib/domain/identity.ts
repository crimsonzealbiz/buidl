import { eq } from "drizzle-orm";
import { events } from "@/db/schema";
import type { Db } from "@/db";
import type { User } from "../auth/session";
import type { ProofBundle } from "../proof/bundle";
import { proofsForUser } from "../proof/service";

export type BuildHistoryEntry = {
  proofId: string;
  attestation: string;
  product: string;
  eventName: string;
  eventSlug: string;
  ecosystem: string | null;
  category: string;
  title: string;
  teamName: string;
  issuedAt: Date | null;
};

/**
 * A builder's identity as facts drawn from their issued Proofs of Build:
 * counts of verified builds, hackathons, collaborators and ecosystems, and the
 * history behind them. Deliberately no aggregate score.
 */
export async function builderIdentity(db: Db, user: User) {
  const issued = (await proofsForUser(db, user.id)).filter((p) => p.status === "confirmed");
  const history: BuildHistoryEntry[] = [];
  const collaborators = new Set<number>();
  for (const p of issued) {
    const b = p.bundle as unknown as ProofBundle;
    const ev = await db.query.events.findFirst({ where: eq(events.id, b.event.id) });
    for (const m of b.team.members) if (m.githubId !== user.githubId) collaborators.add(m.githubId);
    history.push({
      proofId: p.id,
      attestation: p.attestationAddress,
      product: b.submission.productName,
      eventName: b.event.name,
      eventSlug: b.event.slug,
      ecosystem: ev?.chain ?? null,
      category: b.contribution.category,
      title: b.contribution.title,
      teamName: b.team.name,
      issuedAt: p.confirmedAt,
    });
  }
  // Roles ordered by how often they were verified.
  const roleCounts = new Map<string, number>();
  for (const h of history) roleCounts.set(h.category, (roleCounts.get(h.category) ?? 0) + 1);
  const roles = [...roleCounts.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r);
  return {
    history,
    roles,
    facts: {
      verifiedBuilds: history.length,
      hackathons: new Set(history.map((h) => h.eventSlug)).size,
      collaborators: collaborators.size,
      ecosystems: new Set(history.map((h) => h.ecosystem).filter(Boolean)).size,
    },
  };
}
