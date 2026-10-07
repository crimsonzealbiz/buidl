import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { CONTRIBUTION_CATEGORIES, applications, opportunities, users, type OpportunityCriteria } from "@/db/schema";
import type { Db } from "@/db";
import { AppError, assert } from "../errors";
import { newId } from "../ids";
import type { User } from "../auth/session";
import type { Ledger } from "../solana/ledger";
import { verifyProof, type TrustAnchor } from "../proof/verify";
import type { ProofBundle } from "../proof/bundle";
import { proofsForUser } from "../proof/service";
import { isPlatformAdmin, type Ctx } from "./context";
import { getEvent, hasStaffRole } from "./events";

export type Opportunity = typeof opportunities.$inferSelect;

export const opportunityInput = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(4000),
  eventId: z.string().optional().nullable(),
  categories: z.array(z.enum(CONTRIBUTION_CATEGORIES)).default([]),
  minProofs: z.coerce.number().int().min(1).max(20).default(1),
  closesAt: z.coerce.date().optional().nullable(),
});

/** Admins create open opportunities; organizers may create ones scoped to their event. */
export async function createOpportunity(ctx: Ctx, actor: User, raw: z.input<typeof opportunityInput>) {
  const input = opportunityInput.parse(raw);
  if (input.eventId) {
    await getEvent(ctx.db, input.eventId);
    assert(
      isPlatformAdmin(actor) || (await hasStaffRole(ctx.db, input.eventId, actor.id, "organizer")),
      "forbidden",
      "Only admins or this event's organizers can create opportunities for it",
    );
  } else {
    assert(isPlatformAdmin(actor), "forbidden", "Only platform admins can create cross-event opportunities");
  }
  const criteria: OpportunityCriteria = {
    eventId: input.eventId ?? null,
    categories: input.categories,
    minProofs: input.minProofs,
  };
  const [row] = await ctx.db
    .insert(opportunities)
    .values({
      id: newId(),
      title: input.title,
      description: input.description,
      criteria,
      createdBy: actor.id,
      closesAt: input.closesAt ?? null,
    })
    .returning();
  return row;
}

export async function getOpportunity(db: Db, id: string) {
  const o = await db.query.opportunities.findFirst({ where: eq(opportunities.id, id) });
  if (!o) throw new AppError("not_found", "Opportunity not found");
  return o;
}

export function listOpportunities(db: Db) {
  return db.query.opportunities.findMany({ orderBy: [desc(opportunities.createdAt)] });
}

export type Eligibility = {
  eligible: boolean;
  required: number;
  qualifying: { attestation: string; event: string; category: string }[];
  /** Proofs that exist in the database but failed onchain verification. */
  unverified: { attestation: string; reason: string }[];
  reasons: string[];
};

/**
 * Eligibility is decided from proofs re-verified onchain at check time, using
 * the attested values (event, category), not the platform's database claims.
 */
export async function checkEligibility(
  ctx: Ctx,
  ledger: Ledger,
  trust: TrustAnchor,
  user: User,
  opportunity: Opportunity,
): Promise<Eligibility> {
  const crit = opportunity.criteria;
  const eventSlug = crit.eventId ? (await getEvent(ctx.db, crit.eventId)).slug : null;
  const candidates = (await proofsForUser(ctx.db, user.id)).filter((p) => p.status === "confirmed");
  const qualifying: Eligibility["qualifying"] = [];
  const unverified: Eligibility["unverified"] = [];
  for (const p of candidates) {
    const r = await verifyProof(ledger, p.attestationAddress, trust, p.bundle as unknown as ProofBundle);
    if (!r.valid || !r.onchain) {
      unverified.push({
        attestation: p.attestationAddress,
        reason: r.checks.filter((c) => !c.ok).map((c) => c.name).join("; ") || "verification failed",
      });
      continue;
    }
    // The wallet named onchain must still be the holder's linked identity.
    if (r.onchain.githubId !== String(user.githubId)) {
      unverified.push({ attestation: p.attestationAddress, reason: "Attested GitHub id does not match" });
      continue;
    }
    if (eventSlug && r.onchain.event !== eventSlug) continue;
    if (crit.categories?.length && !crit.categories.includes(r.onchain.category)) continue;
    qualifying.push({ attestation: p.attestationAddress, event: r.onchain.event, category: r.onchain.category });
  }
  const reasons: string[] = [];
  if (qualifying.length < crit.minProofs) {
    const scope = [
      eventSlug ? `from ${eventSlug}` : null,
      crit.categories?.length ? `in ${crit.categories.join("/")}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    reasons.push(`Needs ${crit.minProofs} verified proof(s)${scope ? " " + scope : ""}; found ${qualifying.length}`);
  }
  if (opportunity.closesAt && ctx.now() > opportunity.closesAt) reasons.push("This opportunity has closed");
  return { eligible: reasons.length === 0, required: crit.minProofs, qualifying, unverified, reasons };
}

export async function applyToOpportunity(
  ctx: Ctx,
  ledger: Ledger,
  trust: TrustAnchor,
  actor: User,
  opportunityId: string,
  note: string,
) {
  const opp = await getOpportunity(ctx.db, opportunityId);
  const elig = await checkEligibility(ctx, ledger, trust, actor, opp);
  assert(elig.eligible, "precondition_failed", elig.reasons.join("; "));
  const [row] = await ctx.db
    .insert(applications)
    .values({
      id: newId(),
      opportunityId,
      userId: actor.id,
      note: z.string().max(2000).parse(note ?? ""),
      verifiedAttestations: elig.qualifying.map((q) => q.attestation),
      verifiedAt: ctx.now(),
    })
    .onConflictDoNothing()
    .returning();
  assert(row, "conflict", "You already applied to this opportunity");
  return row;
}

export function listApplications(db: Db, opportunityId: string) {
  return db
    .select({ application: applications, user: users })
    .from(applications)
    .innerJoin(users, eq(users.id, applications.userId))
    .where(eq(applications.opportunityId, opportunityId))
    .orderBy(desc(applications.createdAt));
}
