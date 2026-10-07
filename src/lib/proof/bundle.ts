import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { users } from "@/db/schema";
import type { Wallet } from "./types";
import { canonicalJson, bundleHash, toHex } from "./canonical";
import { computeStats, type StatInputs } from "./stats";
import { clip, proofNonce, type ProofOnchainData } from "./sas-schema";
import type { IssuerAddresses } from "./issuer";
import { getEvent } from "../domain/events";
import { getTeam, listMembers, teamRepository } from "../domain/teams";
import { getContribution, getSubmission, listConfirmations, listEvidence } from "../domain/submissions";
import type { Review } from "../domain/reviews";

export const BUNDLE_VERSION = "buidl-proof-bundle/1";

/**
 * The evidence bundle is the full, human-readable record behind a proof. Its
 * sha256 is written onchain, so the exported bundle can be checked against
 * the attestation by anyone without trusting this platform's database.
 */
export type ProofBundle = {
  version: typeof BUNDLE_VERSION;
  cluster: string;
  issuer: { program: string; authority: string; credential: string; schema: string };
  holder: {
    githubId: number;
    githubLogin: string;
    wallet: string;
    walletLink: { message: string; signature: string; linkedAt: string };
  };
  event: { id: string; slug: string; name: string; startsAt: string; endsAt: string; submissionDeadline: string };
  team: { id: string; name: string; members: { githubId: number; githubLogin: string }[] };
  submission: {
    id: string;
    productName: string;
    summary: string;
    demoUrl: string | null;
    submittedAt: string;
    finalSha: string | null;
    repository: {
      owner: string;
      name: string;
      githubRepoId: number;
      baselineSha: string | null;
      baselineCapturedAt: string;
      capturedAfterEventStart: boolean;
    } | null;
  };
  contribution: { id: string; category: string; title: string; description: string; submittedAt: string | null };
  evidence: { kind: string; url: string; description: string; ref: string | null; platformCheck: string }[];
  confirmations: { githubId: number; githubLogin: string; stance: string; statement: string }[];
  review: {
    decision: string;
    rationale: string;
    reviewer: { githubId: number; githubLogin: string };
    decidedAt: string;
    selectedStats: string[];
  };
  stats: string[];
};

export async function buildProofBundle(
  db: Db,
  opts: { contributionId: string; review: Review; wallet: Wallet; issuer: IssuerAddresses; cluster: string },
): Promise<ProofBundle> {
  const c = await getContribution(db, opts.contributionId);
  const submission = await getSubmission(db, c.submissionId);
  const team = await getTeam(db, submission.teamId);
  const event = await getEvent(db, submission.eventId);
  const repo = await teamRepository(db, team.id);
  const holder = (await db.query.users.findFirst({ where: eq(users.id, c.userId) }))!;
  const reviewer = (await db.query.users.findFirst({ where: eq(users.id, opts.review.reviewerId) }))!;
  const members = await listMembers(db, team.id);
  const ev = await listEvidence(db, c.id);
  const confs = await listConfirmations(db, c.id);

  const statInputs: StatInputs = {
    evidenceKinds: ev.map((e) => e.kind),
    authorVerifiedEvidence: ev.filter((e) => e.verification === "github_author_verified").length,
    teammateConfirmations: confs.filter((x) => x.stance === "confirm").length,
    teamSize: members.length,
    demoUrl: submission.demoUrl,
  };

  return {
    version: BUNDLE_VERSION,
    cluster: opts.cluster,
    issuer: {
      program: opts.issuer.program,
      authority: opts.issuer.authority,
      credential: opts.issuer.credential,
      schema: opts.issuer.schema,
    },
    holder: {
      githubId: holder.githubId,
      githubLogin: holder.githubLogin,
      wallet: opts.wallet.address,
      walletLink: {
        message: opts.wallet.message,
        signature: opts.wallet.signature,
        linkedAt: opts.wallet.linkedAt.toISOString(),
      },
    },
    event: {
      id: event.id,
      slug: event.slug,
      name: event.name,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      submissionDeadline: event.submissionDeadline.toISOString(),
    },
    team: {
      id: team.id,
      name: team.name,
      members: members
        .map((m) => ({ githubId: m.user.githubId, githubLogin: m.user.githubLogin }))
        .sort((a, b) => a.githubId - b.githubId),
    },
    submission: {
      id: submission.id,
      productName: submission.productName,
      summary: submission.summary,
      demoUrl: submission.demoUrl,
      submittedAt: submission.submittedAt.toISOString(),
      finalSha: submission.finalSha,
      repository: repo
        ? {
            owner: repo.owner,
            name: repo.name,
            githubRepoId: repo.githubRepoId,
            baselineSha: repo.baselineSha,
            baselineCapturedAt: repo.baselineCapturedAt.toISOString(),
            capturedAfterEventStart: repo.capturedAfterStart,
          }
        : null,
    },
    contribution: {
      id: c.id,
      category: c.category,
      title: c.title,
      description: c.description,
      submittedAt: c.submittedAt?.toISOString() ?? null,
    },
    evidence: ev.map((e) => ({
      kind: e.kind,
      url: e.url,
      description: e.description,
      ref: e.ref,
      platformCheck: e.verification,
    })),
    confirmations: confs
      .map((x) => ({ githubId: x.user.githubId, githubLogin: x.user.githubLogin, stance: x.stance, statement: x.statement }))
      .sort((a, b) => a.githubId - b.githubId),
    review: {
      decision: opts.review.decision,
      rationale: opts.review.rationale,
      reviewer: { githubId: reviewer.githubId, githubLogin: reviewer.githubLogin },
      decidedAt: opts.review.createdAt.toISOString(),
      selectedStats: opts.review.selectedStats,
    },
    stats: computeStats(opts.review.selectedStats, statInputs),
  };
}

/** The values written into the attestation, derived only from the bundle. */
export function onchainDataFromBundle(bundle: ProofBundle): ProofOnchainData {
  return {
    holder: bundle.holder.wallet,
    github_id: BigInt(bundle.holder.githubId),
    event: clip(bundle.event.slug),
    product: clip(bundle.submission.productName),
    category: bundle.contribution.category,
    approved_at: BigInt(Math.floor(Date.parse(bundle.review.decidedAt) / 1000)),
    stats: bundle.stats.map((s) => clip(s, 96)),
    bundle_hash: Array.from(bundleHash(bundle)),
  };
}

export function describeBundle(bundle: ProofBundle) {
  return {
    canonical: canonicalJson(bundle),
    hashHex: toHex(bundleHash(bundle)),
    nonce: proofNonce(bundle.contribution.id),
  };
}
