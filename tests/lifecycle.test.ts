import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import type { Ctx } from "@/lib/domain/context";
import type { User } from "@/lib/auth/session";
import { buildStatus, builderJourney, contributionStage, eventPhase, type JourneyInput } from "@/lib/domain/lifecycle";
import { createEvent } from "@/lib/domain/events";
import { createOpportunity, evaluateOpportunity, type ProofCheck } from "@/lib/domain/opportunities";
import { createOriginsScenario } from "@/lib/domain/demo";
import { canReview, reviewQueue } from "@/lib/domain/reviews";
import { buildView } from "@/lib/domain/builds";
import { builderIdentity } from "@/lib/domain/identity";
import { listEvidence, listConfirmations } from "@/lib/domain/submissions";
import { activeWallet, verifyWalletSignature } from "@/lib/wallet/link";
import { fixtureUser, testDb } from "./helpers";
import { GithubStub } from "./github-stub";

const H = 3600_000;

describe("lifecycle states", () => {
  const ev = { startsAt: new Date(10 * H), submissionDeadline: new Date(20 * H), endsAt: new Date(30 * H) };

  it("derives the event phase from its dates", () => {
    expect(eventPhase(ev, new Date(5 * H))).toBe("upcoming");
    expect(eventPhase(ev, new Date(10 * H))).toBe("live");
    expect(eventPhase(ev, new Date(20 * H))).toBe("reviewing");
    expect(eventPhase(ev, new Date(30 * H))).toBe("ended");
  });

  it("maps contribution and proof status to a single stage", () => {
    expect(contributionStage("draft")).toBe("draft");
    expect(contributionStage("submitted")).toBe("under_review");
    expect(contributionStage("approved")).toBe("approved");
    expect(contributionStage("approved", "failed")).toBe("approved");
    expect(contributionStage("approved", "confirmed")).toBe("proof_issued");
    expect(contributionStage("approved", "revoked")).toBe("revoked");
    expect(contributionStage("rejected")).toBe("rejected");
  });

  it("derives build status from the submission and contributors", () => {
    expect(buildStatus(false, [])).toBe("building");
    expect(buildStatus(true, ["draft"])).toBe("submitted");
    expect(buildStatus(true, ["draft", "under_review"])).toBe("under_review");
    expect(buildStatus(true, ["approved", "rejected"])).toBe("under_review");
    expect(buildStatus(true, ["proof_issued", "under_review"])).toBe("verified");
  });

  it("walks a builder through one primary action per stage", () => {
    const base: JourneyInput = { signedIn: true, registered: true, teamId: "t", hasRepo: true, hasSubmission: true, mine: null, phase: "live" };
    const at = (i: Partial<JourneyInput>) => builderJourney({ ...base, ...i });
    expect(at({ signedIn: false, registered: false }).action.kind).toBe("sign_in");
    expect(at({ registered: false }).action).toMatchObject({ kind: "join", label: "Join event" });
    expect(at({ teamId: null }).action.kind).toBe("team");
    expect(at({ hasRepo: false }).action).toMatchObject({ kind: "register_build", label: "Register build" });
    expect(at({ hasSubmission: false }).action).toMatchObject({ kind: "submit_build", label: "Submit build" });
    expect(at({}).action).toMatchObject({ kind: "contribute", label: "Submit contribution" });
    expect(at({ mine: { id: "c", status: "submitted", proof: null } }).action).toMatchObject({ kind: "view_contribution", href: "/contributions/c" });
    const done = at({ mine: { id: "c", status: "approved", proof: { id: "p", status: "confirmed" } } });
    expect(done.action).toMatchObject({ kind: "view_proof", label: "View Proof of Build", href: "/proofs/p" });
    expect(done.steps.every((s) => s.state === "done")).toBe(true);
    // After the deadline, nothing new can be started.
    expect(at({ registered: false, phase: "reviewing" }).action.kind).toBe("closed");
    expect(at({ hasSubmission: false, phase: "ended" }).action.kind).toBe("closed");
    // The stepper marks everything before the current step as done.
    const team = at({ teamId: null });
    expect(team.steps.map((s) => s.state)).toEqual(["done", "current", "todo", "todo", "todo", "todo", "todo"]);
  });
});

describe("opportunity requirements from verified proofs", () => {
  let db: Db;
  let ctx: Ctx;
  let admin: User;
  let solanaEvent: string;

  beforeAll(async () => {
    process.env.ADMIN_GITHUB_LOGINS = "olivia";
    db = await testDb();
    ctx = { db, github: new GithubStub().client(), now: () => new Date() };
    admin = await fixtureUser(db, "olivia");
    const e = await createEvent(ctx, admin, {
      slug: "origins",
      name: "Origins Hackathon",
      startsAt: new Date(Date.now() - H),
      endsAt: new Date(Date.now() + 48 * H),
      submissionDeadline: new Date(Date.now() + 24 * H),
      chain: "solana",
    });
    solanaEvent = e.id;
  });

  const proof = (over: Partial<ProofCheck["verified"][number]> = {}) => ({
    proofId: "p1", attestation: "A1", event: "origins", category: "product", ecosystem: "solana", ...over,
  });

  it("checks count, ecosystem, role and event, and lists each requirement", async () => {
    const solana = await createOpportunity(ctx, admin, { title: "Solana AI Hackathon", kind: "hackathon", description: "Solana builders only.", ecosystems: ["solana"], minProofs: 1 });
    expect(solana.kind).toBe("hackathon");
    const none = await evaluateOpportunity(ctx, solana, { verified: [], unverified: [] });
    expect(none.eligible).toBe(false);
    expect(none.requirements).toEqual([
      { label: "1+ verified build", met: false },
      { label: "Solana experience", met: false },
    ]);
    const one = await evaluateOpportunity(ctx, solana, { verified: [proof()], unverified: [] });
    expect(one.eligible).toBe(true);
    expect(one.requirements.every((r) => r.met)).toBe(true);
    const otherChain = await evaluateOpportunity(ctx, solana, { verified: [proof({ ecosystem: "base" })], unverified: [] });
    expect(otherChain.eligible).toBe(false);
    expect(otherChain.requirements).toEqual([
      { label: "1+ verified build", met: false },
      { label: "Solana experience", met: false },
    ]);

    const bounty = await createOpportunity(ctx, admin, { title: "Core Protocol Bounty", kind: "bounty", description: "Engineers only, please.", categories: ["engineering"], minProofs: 1 });
    expect((await evaluateOpportunity(ctx, bounty, { verified: [proof()], unverified: [] })).eligible).toBe(false);
    expect((await evaluateOpportunity(ctx, bounty, { verified: [proof({ category: "engineering" })], unverified: [] })).eligible).toBe(true);

    const grant = await createOpportunity(ctx, admin, { title: "Origins Grant", kind: "grant", description: "For Origins builders.", eventId: solanaEvent, minProofs: 2 });
    const g = await evaluateOpportunity(ctx, grant, { verified: [proof(), proof({ proofId: "p2", attestation: "A2", event: "elsewhere" })], unverified: [] });
    expect(g.eligible).toBe(false);
    expect(g.requirements).toEqual([
      { label: "2+ verified builds", met: false },
      { label: "Built at Origins Hackathon", met: true },
    ]);
  });
});

describe("Origins demo scenario (database and GitHub only)", () => {
  let db: Db;
  let ctx: Ctx;
  let admin: User;
  let builder: User;

  beforeAll(async () => {
    process.env.ADMIN_GITHUB_LOGINS = "olivia";
    db = await testDb();
    const gh = new GithubStub();
    const repo = gh.addRepo({ id: 77, owner: "crimsonzealbiz", name: "buidl", createdAt: "2026-01-01T00:00:00Z" });
    gh.commit(repo, 1, "2026-01-02T00:00:00Z");
    ctx = { db, github: gh.client(), now: () => new Date() };
    admin = await fixtureUser(db, "olivia");
    builder = await fixtureUser(db, "someone");
  });

  it("is admin-only", async () => {
    await expect(createOriginsScenario(ctx, builder)).rejects.toThrow(/admins/);
  });

  it("seeds a live event, team FORGE with submitted per-person claims, and opportunities", async () => {
    const s = await createOriginsScenario(ctx, admin, { repo: "crimsonzealbiz/buidl" });
    expect(s.event.slug).toBe("origins");
    expect(eventPhase(s.event)).toBe("live");
    expect(await canReview(db, s.event.id, admin.id)).toBe(true);

    const b = await buildView(db, s.team.id);
    expect(b.team.name).toBe("FORGE");
    expect(b.repo?.owner).toBe("crimsonzealbiz");
    expect(b.submission?.productName).toBe("FORGE");
    expect(b.status).toBe("under_review");
    expect(b.members.map((m) => m.user.githubLogin).sort()).toEqual(["arkkk", "dwayne", "rikuuen"]);
    expect(b.members.every((m) => m.user.demo && m.stage === "under_review")).toBe(true);

    const rik = s.builders.rikuuen;
    const mine = b.members.find((m) => m.user.id === rik.id)!.contribution!;
    expect(mine).toMatchObject({ category: "product", title: "Product / Growth" });
    expect((await listEvidence(db, mine.id)).length).toBeGreaterThan(0);
    expect((await listConfirmations(db, mine.id)).map((c) => c.stance)).toEqual(["confirm", "confirm"]);
    // The demo wallet link carries a real, checkable signature.
    const w = (await activeWallet(db, rik.id))!;
    expect(await verifyWalletSignature(w.address, w.message, w.signature)).toBe(true);

    expect((await reviewQueue(ctx, admin, s.event.id)).length).toBe(3);
    expect(s.opportunities.map((o) => o.kind)).toEqual(["hackathon", "grant", "bounty"]);
    // Nothing is verified until the organizer reviews and issues.
    expect((await builderIdentity(db, rik)).facts).toEqual({ verifiedBuilds: 0, hackathons: 0, collaborators: 0, ecosystems: 0 });
  });

  it("can be loaded again: a new event, the same demo builders", async () => {
    const again = await createOriginsScenario(ctx, admin, { repo: "crimsonzealbiz/buidl" });
    expect(again.event.slug).toBe("origins-2");
    const first = await db.query.users.findMany();
    expect(first.filter((u) => u.githubLogin === "rikuuen")).toHaveLength(1);
  });

  it("organizers review even when not appointed as reviewers, but never their own team", async () => {
    const e = await createEvent(ctx, admin, {
      slug: "org-only",
      name: "Organizer only",
      startsAt: new Date(Date.now() - H),
      endsAt: new Date(Date.now() + 48 * H),
      submissionDeadline: new Date(Date.now() + 24 * H),
    });
    expect(await canReview(db, e.id, admin.id)).toBe(true);
    expect(await canReview(db, e.id, builder.id)).toBe(false);
    await expect(reviewQueue(ctx, builder, e.id)).rejects.toThrow(/not a reviewer/);
  });
});
