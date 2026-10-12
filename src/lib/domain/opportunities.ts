import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  CONTRIBUTION_CATEGORIES,
  OPPORTUNITY_KINDS,
  applications,
  events,
  opportunities,
  users,
  type OpportunityCriteria,
} from "@/db/schema";
import type { Db } from "@/db";
import { AppError, assert } from "../errors";
import { newId } from "../ids";
import type { User } from "../auth/session";
import type { Ledger } from "../solana/ledger";
import { verifyProof, type TrustAnchor } from "../proof/verify";
import type { ProofBundle } from "../proof/bundle";
import { proofsForUser } from "../proof/service";
import { isPlatformAdmin, type Ctx } from "./context";
import { EVENT_CHAINS, getEvent, hasStaffRole } from "./events";

export type Opportunity = typeof opportunities.$inferSelect;

export const opportunityInput = z.object({
  title: z.string().trim().min(3).max(120),
  kind: z.enum(OPPORTUNITY_KINDS).default("hackathon"),
  description: z.string().trim().min(10).max(4000),
  eventId: z.string().optional().nullable(),
  categories: z.array(z.enum(CONTRIBUTION_CATEGORIES)).default([]),
  ecosystems: z.array(z.enum(EVENT_CHAINS)).default([]),
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
    ecosystems: input.ecosystems,
    minProofs: input.minProofs,
  };
  const [row] = await ctx.db
    .insert(opportunities)
    .values({
      id: newId(),
      title: input.title,
      kind: input.kind,
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

export type Requirement = { label: string; met: boolean };

export type Eligibility = {
  eligible: boolean;
  required: number;
  /** Each requirement in plain words, met or not, for the UI. */
  requirements: Requirement[];
  qualifying: { attestation: string; event: string; category: string }[];
  /** Proofs that exist in the database but failed onchain verification. */
  unverified: { attestation: string; reason: string }[];
  reasons: string[];
};

/** A builder's proof after onchain re-verification, described by attested values. */
export type VerifiedProof = {
  proofId: string;
  attestation: string;
  /** Attested event slug. */
  event: string;
  category: string;
  /** Ecosystem of the attested event, looked up by its slug. */
  ecosystem: string | null;
};

export type ProofCheck = { verified: VerifiedProof[]; unverified: Eligibility["unverified"] };

/**
 * Re-verifies every confirmed proof of a builder onchain. Do this once and
 * evaluate as many opportunities against it as needed.
 */
export async function verifiedProofsFor(ctx: Ctx, ledger: Ledger, trust: TrustAnchor, user: User): Promise<ProofCheck> {
  const candidates = (await proofsForUser(ctx.db, user.id)).filter((p) => p.status === "confirmed");
  const verified: VerifiedProof[] = [];
  const unverified: ProofCheck["unverified"] = [];
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
    const ev = await ctx.db.query.events.findFirst({ where: eq(events.slug, r.onchain.event) });
    verified.push({
      proofId: p.id,
      attestation: p.attestationAddress,
      event: r.onchain.event,
      category: r.onchain.category,
      ecosystem: ev?.chain ?? null,
    });
  }
  return { verified, unverified };
}

/** Decides one opportunity from already re-verified proofs. */
export async function evaluateOpportunity(ctx: Ctx, opportunity: Opportunity, check: ProofCheck): Promise<Eligibility> {
  const crit = opportunity.criteria;
  const event = crit.eventId ? await getEvent(ctx.db, crit.eventId) : null;
  const cats = crit.categories ?? [];
  const ecos = crit.ecosystems ?? [];
  const fromEvent = (p: VerifiedProof) => !event || p.event === event.slug;
  const inCategory = (p: VerifiedProof) => !cats.length || cats.includes(p.category);
  const inEcosystem = (p: VerifiedProof) => !ecos.length || (!!p.ecosystem && ecos.includes(p.ecosystem));
  const qualifying = check.verified
    .filter((p) => fromEvent(p) && inCategory(p) && inEcosystem(p))
    .map((p) => ({ attestation: p.attestation, event: p.event, category: p.category }));

  const requirements: Requirement[] = [
    {
      label: `${crit.minProofs}+ verified build${crit.minProofs === 1 ? "" : "s"}`,
      met: qualifying.length >= crit.minProofs,
    },
  ];
  if (event) requirements.push({ label: `Built at ${event.name}`, met: check.verified.some(fromEvent) });
  if (cats.length) requirements.push({ label: `${cats.map(cap).join(" or ")} contribution`, met: check.verified.some(inCategory) });
  if (ecos.length) requirements.push({ label: `${ecos.map(cap).join(" or ")} experience`, met: check.verified.some(inEcosystem) });

  const reasons: string[] = [];
  if (qualifying.length < crit.minProofs) {
    const scope = [
      event ? `from ${event.slug}` : null,
      cats.length ? `in ${cats.join("/")}` : null,
      ecos.length ? `on ${ecos.join("/")}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    reasons.push(`Needs ${crit.minProofs} verified proof(s)${scope ? " " + scope : ""}; found ${qualifying.length}`);
  }
  if (opportunity.closesAt && ctx.now() > opportunity.closesAt) {
    reasons.push("This opportunity has closed");
    requirements.push({ label: "Open for applications", met: false });
  }
  return {
    eligible: reasons.length === 0,
    required: crit.minProofs,
    requirements,
    qualifying,
    unverified: check.unverified,
    reasons,
  };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
  return evaluateOpportunity(ctx, opportunity, await verifiedProofsFor(ctx, ledger, trust, user));
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
