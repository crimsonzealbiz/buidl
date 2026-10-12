import { beforeAll, describe, expect, it } from "vitest";
import { generateKeyPairSigner, type KeyPairSigner } from "@solana/kit";
import type { Db } from "@/db";
import type { Ctx } from "@/lib/domain/context";
import type { User } from "@/lib/auth/session";
import type { Ledger } from "@/lib/solana/ledger";
import { createOriginsScenario } from "@/lib/domain/demo";
import { reviewContribution } from "@/lib/domain/reviews";
import { buildView } from "@/lib/domain/builds";
import { builderIdentity } from "@/lib/domain/identity";
import { evaluateOpportunity, verifiedProofsFor } from "@/lib/domain/opportunities";
import { ensureIssuerSetup, issuerAddresses, type IssuerConfig } from "@/lib/proof/issuer";
import { issueProof, type Issuer } from "@/lib/proof/service";
import { verifyProof, type TrustAnchor } from "@/lib/proof/verify";
import type { ProofBundle } from "@/lib/proof/bundle";
import { fixtureUser, testDb } from "./helpers";
import { GithubStub } from "./github-stub";
import { devnetIssuer, makeTestLedger, testLedgerKinds } from "./ledgers";

const cfg: IssuerConfig = { credentialName: "forge-demo-test", schemaName: "buidl-contribution", schemaVersion: 1 };
const kinds = testLedgerKinds({ devnet: true });

if (kinds.length === 0) describe.skip("demo flow (no Solana ledger available on this platform)", () => {
  it("needs Linux/macOS (LiteSVM), LOCALNET_RPC_URL, or DEVNET_TEST_ISSUER_SECRET", () => {});
});

/**
 * The 9-step demo end to end on a real SAS program: profile at 0 → organizer
 * approves one contributor → Proof of Build issued → profile at 1 → proof
 * verifies → opportunity flips to eligible.
 */
describe.each(kinds)("demo flow on %s: build → prove → identity → opportunity", (kind) => {
  let db: Db;
  let ctx: Ctx;
  let ledger: Ledger;
  let issuer: Issuer;
  let trust: TrustAnchor;
  let admin: User;
  let s: Awaited<ReturnType<typeof createOriginsScenario>>;

  beforeAll(async () => {
    process.env.ADMIN_GITHUB_LOGINS = "olivia";
    db = await testDb();
    const gh = new GithubStub();
    const repo = gh.addRepo({ id: 77, owner: "crimsonzealbiz", name: "buidl", createdAt: "2026-01-01T00:00:00Z" });
    gh.commit(repo, 1, "2026-01-02T00:00:00Z");
    ctx = { db, github: gh.client(), now: () => new Date() };
    admin = await fixtureUser(db, "olivia");

    const tl = await makeTestLedger(kind);
    ledger = tl.ledger;
    let signer: KeyPairSigner;
    if (kind === "devnet") signer = await devnetIssuer();
    else {
      signer = await generateKeyPairSigner();
      await tl.fund(signer.address);
    }
    issuer = { signer, config: cfg, ledger };
    await ensureIssuerSetup(ledger, signer, cfg);
    const a = await issuerAddresses(signer.address, cfg);
    trust = { authority: a.authority, credential: a.credential, schema: a.schema };
    s = await createOriginsScenario(ctx, admin, { repo: "crimsonzealbiz/buidl" });
  }, 120_000);

  it("runs the whole loop for Rikuuen, and only for Rikuuen", async () => {
    const rik = s.builders.rikuuen;
    const [solanaAi, grant, bounty] = s.opportunities;

    // 1. Profile starts empty; the Solana AI Hackathon is locked.
    expect((await builderIdentity(db, rik)).facts.verifiedBuilds).toBe(0);
    let check = await verifiedProofsFor(ctx, ledger, trust, rik);
    expect((await evaluateOpportunity(ctx, solanaAi, check)).eligible).toBe(false);

    // 4. The organizer approves Rikuuen's contribution (and only that one).
    await expect(issueProof(ctx, issuer, admin, s.contributions.rikuuen)).rejects.toThrow(/approved/);
    await reviewContribution(ctx, admin, s.contributions.rikuuen, {
      decision: "approved",
      rationale: "Product brief, launch plan and two teammate confirmations support the product/growth role.",
    });

    // 5. Issue the Proof of Build: a real SAS attestation, confirmed by read-back.
    const proof = await issueProof(ctx, issuer, admin, s.contributions.rikuuen);
    expect(proof.status).toBe("confirmed");
    expect(proof.txSignature).toBeTruthy();
    // Retrying never creates a second credential.
    expect((await issueProof(ctx, issuer, admin, s.contributions.rikuuen)).id).toBe(proof.id);

    // 6. The profile goes 0 → 1, with the build in its history.
    const id = await builderIdentity(db, rik);
    expect(id.facts).toEqual({ verifiedBuilds: 1, hackathons: 1, collaborators: 2, ecosystems: 1 });
    expect(id.history[0]).toMatchObject({ product: "FORGE", eventName: "Origins Hackathon", category: "product", title: "Product / Growth" });
    expect(id.roles).toEqual(["product"]);
    // Teammates were not awarded anything.
    const b = await buildView(db, s.team.id);
    expect(b.status).toBe("verified");
    expect(b.members.filter((m) => m.stage === "proof_issued").map((m) => m.user.githubLogin)).toEqual(["rikuuen"]);
    expect((await builderIdentity(db, s.builders.dwayne)).facts.verifiedBuilds).toBe(0);

    // 8. The proof verifies from the chain and against its evidence bundle.
    const v = await verifyProof(ledger, proof.attestationAddress, trust, proof.bundle as unknown as ProofBundle);
    expect(v.valid).toBe(true);
    expect(v.onchain).toMatchObject({ product: "FORGE", category: "product", event: s.event.slug });

    // 9. Opportunities flip from verified onchain data.
    check = await verifiedProofsFor(ctx, ledger, trust, rik);
    expect(check.verified).toHaveLength(1);
    expect(check.verified[0].ecosystem).toBe("solana");
    expect((await evaluateOpportunity(ctx, solanaAi, check)).eligible).toBe(true);
    expect((await evaluateOpportunity(ctx, grant, check)).eligible).toBe(true);
    expect((await evaluateOpportunity(ctx, bounty, check)).eligible).toBe(false);
  }, 180_000);
});
