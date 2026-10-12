/**
 * The Proof of Build lifecycle as the UI presents it. Everything here is
 * derived from stored records (event dates, submissions, contribution and
 * proof statuses); no extra state is persisted.
 *
 * DISCOVER → JOIN → BUILD → SUBMIT → REVIEW → PROOF → IDENTITY → OPPORTUNITY
 */
import type { ContributionStatus } from "@/db/schema";

type EventDates = { startsAt: Date; endsAt: Date; submissionDeadline: Date };

export type EventPhase = "upcoming" | "live" | "reviewing" | "ended";

/** Upcoming before the start, live until the submission deadline, then reviewing until the end. */
export function eventPhase(e: EventDates, now = new Date()): EventPhase {
  if (now < e.startsAt) return "upcoming";
  if (now < e.submissionDeadline) return "live";
  if (now < e.endsAt) return "reviewing";
  return "ended";
}

export type ProofStatus = "pending" | "sent" | "confirmed" | "failed" | "revoked";

export type ContributionStage =
  | "draft"
  | "under_review"
  | "changes_requested"
  | "approved"
  | "rejected"
  | "proof_issued"
  | "revoked";

/** One contributor's claim, including whether its Proof of Build has been issued. */
export function contributionStage(status: ContributionStatus, proofStatus?: ProofStatus | null): ContributionStage {
  if (status === "approved") {
    if (proofStatus === "confirmed") return "proof_issued";
    if (proofStatus === "revoked") return "revoked";
    return "approved";
  }
  if (status === "submitted") return "under_review";
  return status;
}

export type BuildStatus = "building" | "submitted" | "under_review" | "verified";

/**
 * A build is the team's product. It is BUILDING until the product is
 * submitted, UNDER REVIEW while any contributor's claim awaits a decision or
 * issuance, and VERIFIED once at least one contributor holds a Proof of Build.
 */
export function buildStatus(submitted: boolean, stages: ContributionStage[]): BuildStatus {
  if (!submitted) return "building";
  if (stages.includes("proof_issued")) return "verified";
  if (stages.some((s) => s === "under_review" || s === "approved")) return "under_review";
  return "submitted";
}

export type JourneyKey = "join" | "team" | "build" | "submit" | "contribute" | "review" | "proof";
export type JourneyStep = { key: JourneyKey; label: string; state: "done" | "current" | "todo" };

export type JourneyAction =
  | { kind: "sign_in"; label: string }
  | { kind: "join"; label: string }
  | { kind: "team"; label: string }
  | { kind: "register_build"; label: string }
  | { kind: "submit_build"; label: string }
  | { kind: "contribute"; label: string; href?: string }
  | { kind: "view_contribution"; label: string; href: string }
  | { kind: "view_proof"; label: string; href: string }
  | { kind: "closed"; label: string };

export type JourneyInput = {
  signedIn: boolean;
  registered: boolean;
  teamId: string | null;
  hasRepo: boolean;
  hasSubmission: boolean;
  mine: { id: string; status: ContributionStatus; proof: { id: string; status: ProofStatus } | null } | null;
  phase: EventPhase;
};

const STEP_LABELS: Record<JourneyKey, string> = {
  join: "Join event",
  team: "Form team",
  build: "Register build",
  submit: "Submit build",
  contribute: "Submit contribution",
  review: "Issuer review",
  proof: "Proof of Build",
};

/**
 * Where a builder is in an event, and the single primary action to take next.
 * Steps before the current one are done; later ones are still to do.
 */
export function builderJourney(i: JourneyInput): { steps: JourneyStep[]; current: JourneyKey; action: JourneyAction } {
  const open = i.phase === "upcoming" || i.phase === "live";
  const stage = i.mine ? contributionStage(i.mine.status, i.mine.proof?.status) : null;
  let current: JourneyKey;
  let action: JourneyAction;

  if (!i.signedIn) {
    current = "join";
    action = open ? { kind: "sign_in", label: "Sign in to join" } : { kind: "closed", label: "Registration closed" };
  } else if (!i.registered) {
    current = "join";
    action = open ? { kind: "join", label: "Join event" } : { kind: "closed", label: "Registration closed" };
  } else if (!i.teamId) {
    current = "team";
    action = open ? { kind: "team", label: "Create or join a team" } : { kind: "closed", label: "Teams are locked" };
  } else if (!i.hasRepo) {
    current = "build";
    action = open ? { kind: "register_build", label: "Register build" } : { kind: "closed", label: "Submissions closed" };
  } else if (!i.hasSubmission) {
    current = "submit";
    action = open ? { kind: "submit_build", label: "Submit build" } : { kind: "closed", label: "Submissions closed" };
  } else if (!i.mine || stage === "draft" || stage === "changes_requested") {
    current = "contribute";
    action = i.mine
      ? {
          kind: "contribute",
          label: stage === "changes_requested" ? "Update your contribution" : "Submit contribution",
          href: `/contributions/${i.mine.id}`,
        }
      : { kind: "contribute", label: "Submit contribution" };
  } else if (stage === "under_review" || stage === "rejected") {
    current = "review";
    action = { kind: "view_contribution", label: "View contribution", href: `/contributions/${i.mine.id}` };
  } else if (stage === "proof_issued" && i.mine.proof) {
    current = "proof";
    action = { kind: "view_proof", label: "View Proof of Build", href: `/proofs/${i.mine.proof.id}` };
  } else {
    // Approved and awaiting issuance (or revoked).
    current = "proof";
    action = { kind: "view_contribution", label: "View contribution", href: `/contributions/${i.mine!.id}` };
  }

  const order = Object.keys(STEP_LABELS) as JourneyKey[];
  const at = order.indexOf(current);
  const steps = order.map((key, idx) => ({
    key,
    label: STEP_LABELS[key],
    state: (idx < at || (key === "proof" && stage === "proof_issued") ? "done" : idx === at ? "current" : "todo") as JourneyStep["state"],
  }));
  return { steps, current, action };
}

/** Human labels for every status the UI shows. */
export const STATUS_LABEL: Record<string, string> = {
  upcoming: "Upcoming",
  live: "Live",
  reviewing: "In review",
  ended: "Ended",
  building: "Building",
  submitted: "Submitted",
  under_review: "Under review",
  verified: "Verified",
  draft: "Draft",
  changes_requested: "Changes requested",
  approved: "Approved",
  rejected: "Rejected",
  proof_issued: "Proof issued",
  revoked: "Revoked",
};
