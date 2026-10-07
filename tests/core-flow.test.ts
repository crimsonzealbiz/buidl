import { beforeAll, describe, expect, it } from "vitest";
import { generateKeyPairSigner, type KeyPairSigner } from "@solana/kit";
import type { Db } from "@/db";
import type { Ctx } from "@/lib/domain/context";
import { addStaff, createEvent, registerForEvent } from "@/lib/domain/events";
import { createTeam, joinTeam, registerRepository } from "@/lib/domain/teams";
import {
  addEvidence,
  confirmContribution,
  saveContribution,
  saveSubmission,
  submitContribution,
} from "@/lib/domain/submissions";
import { reviewContribution, reviewQueue } from "@/lib/domain/reviews";
import { applyToOpportunity, checkEligibility, createOpportunity } from "@/lib/domain/opportunities";
import { completeLink, createLinkChallenge } from "@/lib/wallet/link";
import { ensureIssuerSetup, issuerAddresses, type IssuerConfig } from "@/lib/proof/issuer";
import { exportEvidence, issueProof, type Issuer } from "@/lib/proof/service";
import { verifyProof, type TrustAnchor } from "@/lib/proof/verify";
import type { ProofBundle } from "@/lib/proof/bundle";
import { MAINNET_GENESIS_HASH } from "@/lib/solana/ledger";
import type { User } from "@/lib/auth/session";
import { fixtureUser, testDb, testWallet } from "./helpers";
import { GithubStub, type StubRepo } from "./github-stub";
import { LiteSvmLedger } from "./litesvm-ledger";
import { makeTestLedger, testLedgerKinds } from "./ledgers";
import type { Ledger } from "@/lib/solana/ledger";

const cfg: IssuerConfig = { credentialName: "buidl-identity", schemaName: "buidl-contribution", schemaVersion: 1 };

describe.each(testLedgerKinds())("core flow on %s: GitHub identity → wallet → event → contribution → review → SAS proof → verify → opportunity", (ledgerKind) => {
  let db: Db;
  let ctx: Ctx;
  let gh: GithubStub;
  let repo: StubRepo;
  let ledger: Ledger;
  let issuerSigner: KeyPairSigner;
  let issuer: Issuer;
  let trust: TrustAnchor;
  const u: Record<string, User> = {};
  let eventId: string;
  let teamId: string;
  let submissionId: string;
  const contrib: Record<string, string> = {};
  let preexistingSha: string;
  let aliceSha: string;
  let carlSha: string;

  beforeAll(async () => {
    process.env.ADMIN_GITHUB_LOGINS = "olivia";
    db = await testDb();
    gh = new GithubStub();
    ctx = { db, github: gh.client(), now: () => new Date() };
    for (const login of ["olivia", "rex", "alice", "bob", "carl", "dana"]) u[login] = await fixtureUser(db, login);

    const tl = await makeTestLedger(ledgerKind);
    ledger = tl.ledger;
    issuerSigner = await generateKeyPairSigner();
    await tl.fund(issuerSigner.address);
    issuer = { signer: issuerSigner, config: cfg, ledger };
    const setup = await ensureIssuerSetup(ledger, issuerSigner, cfg);
    expect(setup.actions).toHaveLength(2);
    // Idempotent: a second run creates nothing.
    expect((await ensureIssuerSetup(ledger, issuerSigner, cfg)).actions).toHaveLength(0);
    const a = await issuerAddresses(issuerSigner.address, cfg);
    trust = { authority: a.authority, credential: a.credential, schema: a.schema };

    repo = gh.addRepo({ id: 42, owner: "team-x", name: "proofs-app", createdAt: "2026-01-01T00:00:00Z" });
    preexistingSha = gh.commit(repo, u.alice.githubId, "2026-01-02T00:00:00Z");
  });

  it("organizer creates an event and grants a reviewer; non-admins cannot create events", async () => {
    await expect(
      createEvent(ctx, u.alice, {
        slug: "nope",
        name: "Nope",
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 1e8),
        submissionDeadline: new Date(Date.now() + 1e7),
      }),
    ).rejects.toThrow(/admins/);
    const event = await createEvent(ctx, u.olivia, {
      slug: "solana-summer",
      name: "Solana Summer Hack",
      startsAt: new Date(Date.now() - 3600_000),
      endsAt: new Date(Date.now() + 2 * 86400_000),
      submissionDeadline: new Date(Date.now() + 86400_000),
    });
    eventId = event.id;
    await addStaff(ctx, u.olivia, eventId, "rex", "reviewer");
    await expect(addStaff(ctx, u.alice, eventId, "bob", "reviewer")).rejects.toThrow(/organizers/);
  });

  it("builders register, form a team, and register a repository baseline", async () => {
    await expect(createTeam(ctx, u.alice, eventId, "Team X")).rejects.toThrow(/Register/);
    for (const n of ["alice", "bob", "carl", "dana"]) await registerForEvent(ctx, u[n], eventId);
    const team = await createTeam(ctx, u.alice, eventId, "Team X");
    teamId = team.id;
    await joinTeam(ctx, u.bob, team.joinCode);
    await joinTeam(ctx, u.carl, team.joinCode);
    await joinTeam(ctx, u.dana, team.joinCode);
    await expect(joinTeam(ctx, u.bob, team.joinCode)).rejects.toThrow(/already on a team/);

    await expect(registerRepository(ctx, u.rex, teamId, "team-x/proofs-app")).rejects.toThrow(/team members/);
    const r = await registerRepository(ctx, u.alice, teamId, "https://github.com/team-x/proofs-app");
    expect(r.baselineSha).toBe(preexistingSha);
    expect(r.capturedAfterStart).toBe(true);
    await expect(registerRepository(ctx, u.bob, teamId, "team-x/proofs-app")).rejects.toThrow(/already registered/);

    // Work during the event.
    aliceSha = gh.commit(repo, u.alice.githubId);
    carlSha = gh.commit(repo, u.carl.githubId);
  });

  it("team submits the product; each member writes their own contribution with evidence", async () => {
    const s = await saveSubmission(ctx, u.bob, teamId, {
      productName: "ProofKit",
      summary: "A wallet-native way for hackathon teams to show who built what.",
      demoUrl: "https://proofkit.example",
    });
    submissionId = s.id;
    expect(s.finalSha).toBe(carlSha);

    // Engineering contribution with GitHub-verified evidence.
    contrib.alice = (
      await saveContribution(ctx, u.alice, submissionId, {
        category: "engineering",
        title: "Attestation pipeline",
        description: "Built the issuance pipeline that writes reviewed proofs to Solana devnet and the verifier.",
      })
    ).id;
    const ok = await addEvidence(ctx, u.alice, contrib.alice, {
      kind: "commit",
      url: `https://github.com/team-x/proofs-app/commit/${aliceSha}`,
      description: "Issuer service and verifier",
    });
    expect(ok.verification).toBe("github_author_verified");
    const pre = await addEvidence(ctx, u.alice, contrib.alice, {
      kind: "commit",
      url: `https://github.com/team-x/proofs-app/commit/${preexistingSha}`,
      description: "Older scaffold work",
    });
    expect(pre.verification).toBe("github_check_failed");
    expect(pre.verificationDetail).toMatchObject({ reason: expect.stringMatching(/baseline/) });
    const notMine = await addEvidence(ctx, u.alice, contrib.alice, {
      kind: "commit",
      url: `https://github.com/team-x/proofs-app/commit/${carlSha}`,
      description: "Claiming a teammate's commit",
    });
    expect(notMine.verification).toBe("github_check_failed");
    await expect(
      addEvidence(ctx, u.alice, contrib.alice, {
        kind: "commit",
        url: `https://github.com/other/repo/commit/${aliceSha}`,
        description: "Some other repository",
      }),
    ).rejects.toThrow(/registered repository/);
    const after = gh.commit(repo, u.alice.githubId);
    const late = await addEvidence(ctx, u.alice, contrib.alice, {
      kind: "commit",
      url: `https://github.com/team-x/proofs-app/commit/${after}`,
      description: "After submission",
    });
    expect(late.verificationDetail).toMatchObject({ reason: expect.stringMatching(/not part of the submitted/) });

    // Non-engineering contribution: evidence judged by the reviewer.
    contrib.bob = (
      await saveContribution(ctx, u.bob, submissionId, {
        category: "design",
        title: "Product and interaction design",
        description: "Designed the proof card, verification page and the onboarding flow; ran three user interviews.",
      })
    ).id;
    await addEvidence(ctx, u.bob, contrib.bob, {
      kind: "design_file",
      url: "https://www.figma.com/file/abc/proofkit",
      description: "Figma file with final screens",
    });
    await addEvidence(ctx, u.bob, contrib.bob, {
      kind: "document",
      url: "https://docs.example/interviews",
      description: "User interview notes and synthesis",
    });

    contrib.dana = (
      await saveContribution(ctx, u.dana, submissionId, {
        category: "community",
        title: "Hype",
        description: "Posted about the project on social media a lot during the event weekend.",
      })
    ).id;
    await addEvidence(ctx, u.dana, contrib.dana, {
      kind: "link",
      url: "https://x.com/dana/status/1",
      description: "A tweet about the project",
    });

    // Nobody can write a claim on someone else's contribution.
    await expect(
      addEvidence(ctx, u.bob, contrib.alice, { kind: "link", url: "https://a.example", description: "not mine to add" }),
    ).rejects.toThrow(/own contribution/);
    await expect(submitContribution(ctx, u.bob, contrib.alice)).rejects.toThrow(/own contribution/);

    // Teammates corroborate; self-confirmation is refused.
    await confirmContribution(ctx, u.alice, contrib.bob, "Bob designed every screen we shipped.");
    await expect(confirmContribution(ctx, u.bob, contrib.bob, "I did great work, trust me.")).rejects.toThrow(/own/);
    await expect(confirmContribution(ctx, u.rex, contrib.bob, "Looks right to me, I guess.")).rejects.toThrow(/teammates/);

    for (const n of ["alice", "bob", "dana"]) await submitContribution(ctx, u[n], contrib[n]);
    await expect(
      addEvidence(ctx, u.alice, contrib.alice, { kind: "link", url: "https://a.example", description: "after submit" }),
    ).rejects.toThrow(/under review/);
  });

  it("reviewers decide per contribution; conflicts of interest are refused", async () => {
    await expect(reviewQueue(ctx, u.alice, eventId)).rejects.toThrow(/not a reviewer/);
    const queue = await reviewQueue(ctx, u.rex, eventId);
    expect(queue.map((q) => q.user.githubLogin).sort()).toEqual(["alice", "bob", "dana"]);

    // A team member made reviewer still cannot review their own team.
    await addStaff(ctx, u.olivia, eventId, "carl", "reviewer");
    await expect(
      reviewContribution(ctx, u.carl, contrib.bob, { decision: "approved", rationale: "My teammate did great work here." }),
    ).rejects.toThrow(/Conflict of interest/);
    await expect(
      reviewContribution(ctx, u.rex, contrib.alice, {
        decision: "approved",
        rationale: "Verified commit implements the issuer.",
        selectedStats: ["follower_count"],
      }),
    ).rejects.toThrow(/Unknown stats/);
    await expect(
      reviewContribution(ctx, u.rex, contrib.alice, { decision: "approved", rationale: "ok" }),
    ).rejects.toThrow();

    await reviewContribution(ctx, u.rex, contrib.alice, {
      decision: "approved",
      rationale: "The verified commit implements the issuer and verifier described; two other claims were discounted.",
      selectedStats: ["github_authorship_verified", "evidence_items"],
    });
    await reviewContribution(ctx, u.rex, contrib.bob, {
      decision: "approved",
      rationale: "Figma file and interview synthesis clearly show the design work; teammate corroborates.",
      selectedStats: ["evidence_kinds", "teammate_confirmations", "demo_shipped"],
    });
    await reviewContribution(ctx, u.rex, contrib.dana, {
      decision: "rejected",
      rationale: "Social posts are not evidence of a contribution to the product.",
    });
    await expect(
      reviewContribution(ctx, u.rex, contrib.alice, { decision: "rejected", rationale: "Changing my mind on this one." }),
    ).rejects.toThrow(/submitted/);
  });

  it("does not award proofs to rejected contributions, non-contributors, or wallets that are not linked", async () => {
    await expect(issueProof(ctx, issuer, u.dana, contrib.dana)).rejects.toThrow(/approved/);
    await expect(issueProof(ctx, issuer, u.dana, contrib.alice)).rejects.toThrow(/contributor or event staff/);
    await expect(issueProof(ctx, issuer, u.alice, contrib.alice)).rejects.toThrow(/link a Solana wallet/);
  });

  let aliceAttestation: string;
  let bobWallet: Awaited<ReturnType<typeof testWallet>>;

  it("issues a real SAS attestation for an approved contribution to the linked wallet", async () => {
    const w = await testWallet();
    const ch = await createLinkChallenge(db, u.alice, w.address, "buidl.test");
    await completeLink(db, u.alice, ch.nonce, await w.sign(ch.message));

    const proof = await issueProof(ctx, issuer, u.alice, contrib.alice);
    expect(proof.status).toBe("confirmed");
    expect(proof.txSignature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
    expect(proof.walletAddress).toBe(w.address);
    expect(proof.onchainData).toMatchObject({
      holder: w.address,
      event: "solana-summer",
      category: "engineering",
      stats: ["evidence_items=4", "github_authorship_verified=true"],
    });
    aliceAttestation = proof.attestationAddress;
    expect((await ledger.getAccount(proof.attestationAddress as never)).exists).toBe(true);

    // Retrying is idempotent: same proof, no second attestation.
    const again = await issueProof(ctx, issuer, u.rex, contrib.alice);
    expect(again.id).toBe(proof.id);
    expect(again.txSignature).toBe(proof.txSignature);

    // Non-engineering contributor gets their own proof.
    bobWallet = await testWallet();
    const ch2 = await createLinkChallenge(db, u.bob, bobWallet.address, "buidl.test");
    await completeLink(db, u.bob, ch2.nonce, await bobWallet.sign(ch2.message));
    const bobProof = await issueProof(ctx, issuer, u.rex, contrib.bob);
    expect(bobProof.status).toBe("confirmed");
    expect(bobProof.onchainData).toMatchObject({
      category: "design",
      stats: ["evidence_kinds=design_file,document", "teammate_confirmations=1", "demo_shipped=true"],
    });
  });

  it("verifies independently from the chain and an exported evidence bundle", async () => {
    const { proofByAttestation } = await import("@/lib/proof/service");
    const proof = (await proofByAttestation(db, aliceAttestation))!;
    // Simulate a third party: export → JSON file → parse, then verify with only chain + file.
    const exported = JSON.parse(JSON.stringify(exportEvidence(proof)));
    const bundle = exported.bundle as ProofBundle;

    const res = await verifyProof(ledger, aliceAttestation, trust, bundle);
    expect(res.checks.filter((c) => !c.ok)).toEqual([]);
    expect(res.valid).toBe(true);
    expect(res.onchain?.githubId).toBe(String(u.alice.githubId));
    expect(res.onchain?.bundleHashHex).toBe(exported.proof.bundleSha256);

    // Chain-only verification (no bundle) still establishes issuer and fields.
    expect((await verifyProof(ledger, aliceAttestation, trust)).valid).toBe(true);

    // Tampering with any part of the bundle is detected.
    const tampered = structuredClone(bundle);
    tampered.contribution.description += " (and also everything else)";
    const bad = await verifyProof(ledger, aliceAttestation, trust, tampered);
    expect(bad.valid).toBe(false);
    expect(bad.checks.find((c) => c.name === "Bundle hash matches onchain hash")?.ok).toBe(false);

    // A different trusted issuer rejects the proof.
    const otherIssuer = await generateKeyPairSigner();
    const other = await issuerAddresses(otherIssuer.address, cfg);
    const wrongTrust = await verifyProof(ledger, aliceAttestation, {
      authority: other.authority,
      credential: other.credential,
      schema: other.schema,
    });
    expect(wrongTrust.valid).toBe(false);

    // Unknown attestation.
    const missing = await verifyProof(ledger, (await generateKeyPairSigner()).address, trust);
    expect(missing.valid).toBe(false);
  });

  it("decides opportunity eligibility from onchain-verified proofs", async () => {
    const opp = await createOpportunity(ctx, u.olivia, {
      title: "Demo Day slot: design track",
      description: "Present at demo day. Requires a verified design proof from Solana Summer.",
      eventId,
      categories: ["design"],
      minProofs: 1,
    });
    await expect(
      createOpportunity(ctx, u.alice, { title: "Fake", description: "Not allowed to make this", minProofs: 1 }),
    ).rejects.toThrow(/admins/);

    const alice = await checkEligibility(ctx, ledger, trust, u.alice, opp);
    expect(alice.eligible).toBe(false);
    expect(alice.reasons[0]).toMatch(/design/);

    const bob = await checkEligibility(ctx, ledger, trust, u.bob, opp);
    expect(bob.eligible).toBe(true);
    expect(bob.qualifying).toHaveLength(1);

    const dana = await checkEligibility(ctx, ledger, trust, u.dana, opp);
    expect(dana.eligible).toBe(false);

    await expect(applyToOpportunity(ctx, ledger, trust, u.alice, opp.id, "")).rejects.toThrow(/Needs 1/);
    const app = await applyToOpportunity(ctx, ledger, trust, u.bob, opp.id, "Excited to demo!");
    expect(app.verifiedAttestations).toEqual(bob.qualifying.map((q) => q.attestation));

    // If the attestation disappears onchain, eligibility is lost even though the DB still says confirmed.
    const ledger2 = new LiteSvmLedger(); // a cluster without the proofs
    const fresh = await checkEligibility(ctx, ledger2, trust, u.bob, opp);
    expect(fresh.eligible).toBe(false);
    expect(fresh.unverified).toHaveLength(1);
  });

  it("refuses to issue on mainnet", async () => {
    const mainnetLike = Object.assign(Object.create(ledger), {
      cluster: "devnet",
      genesisHash: async () => MAINNET_GENESIS_HASH,
    });
    await expect(ensureIssuerSetup(mainnetLike, issuerSigner, cfg)).rejects.toThrow(/mainnet/);
  });
});
