"use server";

import { CONTRIBUTION_CATEGORIES, EVIDENCE_KINDS } from "@/db/schema";
import { addStaff, createEvent, parsePrizeLines, registerForEvent, updateEvent, EVENT_CHAINS } from "@/lib/domain/events";
import { createTeam, joinTeam, leaveTeam, registerRepository } from "@/lib/domain/teams";
import {
  addEvidence,
  confirmContribution,
  removeEvidence,
  saveContribution,
  saveSubmission,
  submitContribution,
} from "@/lib/domain/submissions";
import { reviewContribution } from "@/lib/domain/reviews";
import { createSampleEvent } from "@/lib/domain/demo";
import { getProof, issueProof, revokeProof } from "@/lib/proof/service";
import { loadIssuer } from "@/lib/proof/runtime";
import { AppError } from "@/lib/errors";
import { act, str } from "@/server/actions";
import { makeCtx, requireSession } from "@/server/session";

async function ctxAndUser() {
  const session = await requireSession();
  return { ctx: await makeCtx(session), user: session.user };
}

/** datetime-local inputs carry no zone; the form labels them UTC. */
function utc(v: string) {
  return v && !/[zZ]|[+-]\d\d:\d\d$/.test(v) ? `${v}Z` : v;
}

function eventFieldsFrom(form: FormData) {
  return {
    name: str(form, "name"),
    description: str(form, "description"),
    startsAt: utc(str(form, "startsAt")),
    endsAt: utc(str(form, "endsAt")),
    submissionDeadline: utc(str(form, "submissionDeadline")),
    maxTeamSize: str(form, "maxTeamSize") || "5",
    chain: (str(form, "chain") || "solana") as (typeof EVENT_CHAINS)[number],
    prizes: parsePrizeLines(str(form, "prizes")),
    websiteUrl: str(form, "websiteUrl"),
  };
}

export async function updateEventAction(form: FormData) {
  const { ctx, user } = await ctxAndUser();
  const slug = str(form, "slug");
  return act(`/events/${slug}`, async () => {
    await updateEvent(ctx, user, str(form, "eventId"), eventFieldsFrom(form));
    return "Event updated";
  });
}

export async function leaveTeamAction(form: FormData) {
  const { ctx, user } = await ctxAndUser();
  return act(`/events/${str(form, "slug")}`, async () => {
    const r = await leaveTeam(ctx, user, str(form, "teamId"));
    return r.teamDeleted ? "You left the team; it had no other members and was removed" : "You left the team";
  });
}

export async function revokeProofAction(form: FormData) {
  const { ctx, user } = await ctxAndUser();
  const id = str(form, "proofId");
  return act(`/proofs/${id}`, async () => {
    const loaded = await loadIssuer();
    if (!loaded.issuer) throw new AppError("not_configured", loaded.reason);
    if (!(await getProof(ctx.db, id))) throw new AppError("not_found", "Proof not found");
    await revokeProof(ctx, loaded.issuer, user, id, str(form, "reason")).catch((e) => {
      if (e instanceof AppError || (e as Error).name === "ZodError") throw e;
      throw new AppError("upstream_failed", `Could not reach the Solana cluster: ${(e as Error).message}`);
    });
    return "Proof revoked onchain";
  });
}

export async function createSampleEventAction() {
  const { ctx, user } = await ctxAndUser();
  let slug = "";
  try {
    slug = (await createSampleEvent(ctx, user)).event.slug;
  } catch (e) {
    return act("/events", async () => {
      throw e;
    });
  }
  return act(`/events/${slug}`, async () => "Sample event and demo-day opportunity created");
}

export async function createEventAction(form: FormData) {
  const { ctx, user } = await ctxAndUser();
  const slug = str(form, "slug");
  return act(`/events/${slug}`, async () => {
    await createEvent(ctx, user, { slug, ...eventFieldsFrom(form) });
    return "Event created";
  });
}

export async function addStaffAction(form: FormData) {
  const { ctx, user } = await ctxAndUser();
  return act(`/events/${str(form, "slug")}`, async () => {
    const role = str(form, "role") === "organizer" ? "organizer" : "reviewer";
    const t = await addStaff(ctx, user, str(form, "eventId"), str(form, "login"), role);
    return `@${t.githubLogin} is now a ${role}`;
  });
}

export async function registerAction(form: FormData) {
  const { ctx, user } = await ctxAndUser();
  return act(`/events/${str(form, "slug")}`, async () => {
    await registerForEvent(ctx, user, str(form, "eventId"));
    return "Registered";
  });
}

export async function createTeamAction(form: FormData) {
  const { ctx, user } = await ctxAndUser();
  return act(`/events/${str(form, "slug")}`, async () => {
    await createTeam(ctx, user, str(form, "eventId"), str(form, "name"));
    return "Team created. Share the join code with teammates.";
  });
}

export async function joinTeamAction(form: FormData) {
  const { ctx, user } = await ctxAndUser();
  return act(`/events/${str(form, "slug")}`, async () => {
    const t = await joinTeam(ctx, user, str(form, "code"));
    return `Joined ${t.name}`;
  });
}

export async function registerRepoAction(form: FormData) {
  const { ctx, user } = await ctxAndUser();
  return act(`/events/${str(form, "slug")}`, async () => {
    const r = await registerRepository(ctx, user, str(form, "teamId"), str(form, "repo"));
    return r.baselineSha
      ? `Registered ${r.owner}/${r.name}; baseline ${r.baselineSha.slice(0, 10)}`
      : `Registered ${r.owner}/${r.name} (empty at registration)`;
  });
}

export async function saveSubmissionAction(form: FormData) {
  const { ctx, user } = await ctxAndUser();
  return act(`/events/${str(form, "slug")}`, async () => {
    await saveSubmission(ctx, user, str(form, "teamId"), {
      productName: str(form, "productName"),
      summary: str(form, "summary"),
      demoUrl: str(form, "demoUrl"),
    });
    return "Submission saved; final commit captured from GitHub";
  });
}

export async function saveContributionAction(form: FormData) {
  const { ctx, user } = await ctxAndUser();
  const category = str(form, "category") as (typeof CONTRIBUTION_CATEGORIES)[number];
  let id = "";
  const back = str(form, "back") || "/dashboard";
  try {
    id = (
      await saveContribution(ctx, user, str(form, "submissionId"), {
        category,
        title: str(form, "title"),
        description: str(form, "description"),
      })
    ).id;
  } catch (e) {
    return act(back, async () => {
      throw e;
    });
  }
  return act(`/contributions/${id}`, async () => "Contribution saved. Add evidence, then submit it for review.");
}

export async function addEvidenceAction(form: FormData) {
  const { ctx, user } = await ctxAndUser();
  const id = str(form, "contributionId");
  return act(`/contributions/${id}`, async () => {
    const ev = await addEvidence(ctx, user, id, {
      kind: str(form, "kind") as (typeof EVIDENCE_KINDS)[number],
      url: str(form, "url"),
      description: str(form, "description"),
    });
    if (ev.verification === "github_check_failed") {
      return `Evidence added, but GitHub check failed: ${(ev.verificationDetail as { reason?: string })?.reason ?? ""}`;
    }
    return ev.verification === "github_author_verified" ? "Evidence added and authorship verified on GitHub" : "Evidence added";
  });
}

export async function removeEvidenceAction(form: FormData) {
  const { ctx, user } = await ctxAndUser();
  return act(`/contributions/${str(form, "contributionId")}`, async () => {
    await removeEvidence(ctx, user, str(form, "evidenceId"));
    return "Evidence removed";
  });
}

export async function submitContributionAction(form: FormData) {
  const { ctx, user } = await ctxAndUser();
  const id = str(form, "contributionId");
  return act(`/contributions/${id}`, async () => {
    await submitContribution(ctx, user, id);
    return "Submitted for review";
  });
}

export async function confirmAction(form: FormData) {
  const { ctx, user } = await ctxAndUser();
  const id = str(form, "contributionId");
  return act(`/contributions/${id}`, async () => {
    const stance = str(form, "stance") === "dispute" ? "dispute" : "confirm";
    await confirmContribution(ctx, user, id, str(form, "statement"), stance);
    return stance === "dispute" ? "Dispute recorded; reviewers will see it" : "Confirmation recorded";
  });
}

export async function reviewAction(form: FormData) {
  const { ctx, user } = await ctxAndUser();
  return act(`/events/${str(form, "slug")}/review`, async () => {
    const decision = str(form, "decision") as "approved" | "rejected" | "changes_requested";
    await reviewContribution(ctx, user, str(form, "contributionId"), {
      decision,
      rationale: str(form, "rationale"),
      selectedStats: decision === "approved" ? form.getAll("stats").map(String) : [],
    });
    return `Decision recorded: ${decision.replace("_", " ")}`;
  });
}

export async function issueProofAction(form: FormData) {
  const { ctx, user } = await ctxAndUser();
  const id = str(form, "contributionId");
  return act(`/contributions/${id}`, async () => {
    const loaded = await loadIssuer();
    if (!loaded.issuer) throw new AppError("not_configured", loaded.reason);
    const proof = await issueProof(ctx, loaded.issuer, user, id).catch((e) => {
      if (e instanceof AppError) throw e;
      throw new AppError("upstream_failed", `Could not reach the Solana cluster: ${(e as Error).message}`);
    });
    return proof.status === "confirmed" ? "Proof confirmed onchain" : `Proof status: ${proof.status}`;
  });
}
