import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { generateKeyPair, getAddressFromPublicKey, getBase58Decoder } from "@solana/kit";
import { users } from "@/db/schema";
import { appUrl } from "../config";
import { assert } from "../errors";
import { newId } from "../ids";
import type { User } from "../auth/session";
import { activeWallet, completeLink, createLinkChallenge } from "../wallet/link";
import { isPlatformAdmin, type Ctx } from "./context";
import { addStaff, createEvent, getEventBySlug, registerForEvent } from "./events";
import { createOpportunity } from "./opportunities";
import { createTeam, joinTeam, registerRepository } from "./teams";
import { addEvidence, confirmContribution, saveContribution, saveSubmission, submitContribution } from "./submissions";

/**
 * Creates a ready-to-use sample event (open now, deadline tomorrow) and a
 * matching demo-day opportunity, so a live demo does not start with forms.
 * Everything else in the demo is done for real by the participants.
 */
export async function createSampleEvent(ctx: Ctx, actor: User) {
  const now = ctx.now().getTime();
  const suffix = Array.from(randomBytes(4), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  const event = await createEvent(ctx, actor, {
    slug: `demo-${suffix}`,
    name: "Solana Builders Demo Hack",
    description:
      "A sample hackathon. Form a team, register your repo, ship, and document what you personally built. " +
      "Approved contributions become verifiable Solana proofs.",
    startsAt: new Date(now - 60 * 60 * 1000),
    endsAt: new Date(now + 2 * 24 * 60 * 60 * 1000),
    submissionDeadline: new Date(now + 24 * 60 * 60 * 1000),
    maxTeamSize: 4,
    chain: "solana",
    prizes: [
      { title: "Grand prize", reward: "$5,000" },
      { title: "Best design", reward: "$1,000" },
      { title: "Best developer tooling", reward: "$1,000" },
    ],
  });
  const opportunity = await createOpportunity(ctx, actor, {
    title: `Demo Day slot: ${event.name}`,
    description: "Present on demo day. Requires one verified contribution proof from this event.",
    eventId: event.id,
    categories: [],
    minProofs: 1,
  });
  return { event, opportunity };
}

/** Demo builders. Their GitHub ids sit far above real GitHub ids so they can never collide. */
const DEMO_BUILDERS = [
  { githubId: 9_000_000_000_001, login: "rikuuen", name: "Rikuuen" },
  { githubId: 9_000_000_000_002, login: "dwayne", name: "Dwayne" },
  { githubId: 9_000_000_000_003, login: "arkkk", name: "Arkkk" },
] as const;

/**
 * A demo identity: a user row flagged `demo` (it never signed in with GitHub)
 * whose wallet is linked through the normal challenge flow, signed by a
 * keypair generated here. The signature is real; the private key is discarded.
 */
async function demoBuilder(ctx: Ctx, spec: (typeof DEMO_BUILDERS)[number]): Promise<User> {
  let user = await ctx.db.query.users.findFirst({ where: eq(users.githubId, spec.githubId) });
  if (!user) {
    [user] = await ctx.db
      .insert(users)
      .values({ id: newId(), githubId: spec.githubId, githubLogin: spec.login, name: spec.name, demo: true })
      .returning();
  }
  if (!(await activeWallet(ctx.db, user.id))) {
    const kp = await generateKeyPair();
    const address = await getAddressFromPublicKey(kp.publicKey);
    const challenge = await createLinkChallenge(ctx.db, user, address, new URL(appUrl()).host, ctx.now());
    const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", kp.privateKey, new TextEncoder().encode(challenge.message)));
    await completeLink(ctx.db, user, challenge.nonce, getBase58Decoder().decode(sig), ctx.now());
  }
  return user;
}

async function freeSlug(ctx: Ctx, base: string) {
  for (let i = 1; ; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    if (!(await getEventBySlug(ctx.db, slug))) return slug;
  }
}

/**
 * Seeds the Proof of Build demo: the Origins Hackathon (live, the signed-in
 * admin as organizer and issuer), team FORGE with three demo builders who
 * have each submitted their own contribution with evidence, and opportunities
 * whose eligibility depends on verified proofs.
 *
 * Seeded: the demo builders, their claims and evidence. Real: the GitHub
 * repository baseline (fetched from GitHub), wallet signatures, and everything
 * after this point in the demo (review, Solana issuance, verification,
 * eligibility).
 */
export async function createOriginsScenario(ctx: Ctx, actor: User, opts: { repo?: string; deploymentUrl?: string } = {}) {
  assert(isPlatformAdmin(actor), "forbidden", "Only platform admins can load the demo scenario");
  assert(!actor.demo, "forbidden", "Demo identities cannot load the demo scenario");
  const day = 24 * 60 * 60 * 1000;
  const now = ctx.now().getTime();
  const event = await createEvent(ctx, actor, {
    slug: await freeSlug(ctx, "origins"),
    name: "Origins Hackathon",
    description:
      "Ship a product in five days. Every contributor documents their own work, the organizers review it, and " +
      "approved contributions are issued as Proofs of Build on Solana.",
    startsAt: new Date(now - 2 * day),
    endsAt: new Date(now + 3 * day),
    submissionDeadline: new Date(now + day),
    maxTeamSize: 4,
    chain: "solana",
    prizes: [
      { title: "Grand prize", reward: "$10,000" },
      { title: "Best consumer product", reward: "$3,000" },
    ],
  });
  await addStaff(ctx, actor, event.id, actor.githubLogin, "reviewer");

  const [rikuuen, dwayne, arkkk] = await Promise.all(DEMO_BUILDERS.map((b) => demoBuilder(ctx, b)));
  for (const u of [rikuuen, dwayne, arkkk]) await registerForEvent(ctx, u, event.id);
  const team = await createTeam(ctx, rikuuen, event.id, "FORGE");
  await joinTeam(ctx, dwayne, team.joinCode);
  await joinTeam(ctx, arkkk, team.joinCode);

  const repoRef = opts.repo ?? process.env.DEMO_REPO ?? "crimsonzealbiz/buidl";
  const repo = await registerRepository(ctx, dwayne, team.id, repoRef);
  const repoUrl = `https://github.com/${repo.owner}/${repo.name}`;
  const deployment = opts.deploymentUrl ?? process.env.DEMO_DEPLOYMENT_URL ?? (appUrl().startsWith("https://") ? appUrl() : undefined);
  const submission = await saveSubmission(ctx, rikuuen, team.id, {
    productName: "FORGE",
    summary:
      "A builder identity network: verified hackathon contributions become portable Proofs of Build on Solana " +
      "that open doors to the next opportunity.",
    demoUrl: deployment,
  });

  const claims = [
    {
      user: rikuuen,
      category: "product" as const,
      title: "Product / Growth",
      description:
        "Defined the Proof of Build lifecycle and the demo narrative, ran builder interviews, and planned the launch " +
        "and growth loop from verified builds to opportunities.",
      evidence: [
        { kind: "document" as const, url: `${repoUrl}#readme`, description: "Demo evidence: product brief and lifecycle definition" },
        { kind: "link" as const, url: `${repoUrl}/commits`, description: "Demo evidence: launch plan and growth notes" },
      ],
    },
    {
      user: dwayne,
      category: "engineering" as const,
      title: "Engineering",
      description:
        "Built the Solana Attestation Service integration, the evidence bundle and the independent verifier, plus the " +
        "review and issuance flow.",
      evidence: [{ kind: "link" as const, url: repoUrl, description: "Demo evidence: application repository" }],
    },
    {
      user: arkkk,
      category: "design" as const,
      title: "Design",
      description:
        "Designed the FORGE identity, the builder profile and the Proof of Build credential, and ran usability passes " +
        "on the event flow.",
      evidence: [{ kind: "design_file" as const, url: `${repoUrl}#forge`, description: "Demo evidence: FORGE design system" }],
    },
  ];
  const ids: Record<string, string> = {};
  for (const c of claims) {
    const row = await saveContribution(ctx, c.user, submission.id, {
      category: c.category,
      title: c.title,
      description: c.description,
    });
    for (const e of c.evidence) await addEvidence(ctx, c.user, row.id, e);
    ids[c.user.githubLogin] = row.id;
  }
  await confirmContribution(ctx, dwayne, ids.rikuuen, "Rikuuen owned product and growth for FORGE throughout the event.");
  await confirmContribution(ctx, arkkk, ids.rikuuen, "Rikuuen drove the product decisions and the demo narrative.");
  await confirmContribution(ctx, rikuuen, ids.dwayne, "Dwayne built the onchain proof and verification pieces.");
  await confirmContribution(ctx, rikuuen, ids.arkkk, "Arkkk designed the FORGE brand, profile and credential.");
  for (const c of claims) await submitContribution(ctx, c.user, ids[c.user.githubLogin]);

  const opportunities = [
    await createOpportunity(ctx, actor, {
      title: "Solana AI Hackathon",
      kind: "hackathon",
      description: "Invite-only track for builders who have already shipped on Solana. Requires one verified build in the Solana ecosystem.",
      ecosystems: ["solana"],
      minProofs: 1,
    }),
    await createOpportunity(ctx, actor, {
      title: "Origins Builder Grant",
      kind: "grant",
      description: "Follow-on funding for Origins teams that keep shipping. Requires a verified build from the Origins Hackathon.",
      eventId: event.id,
      minProofs: 1,
    }),
    await createOpportunity(ctx, actor, {
      title: "Core Protocol Bounty",
      kind: "bounty",
      description: "Protocol work for experienced engineers. Requires a verified engineering build.",
      categories: ["engineering"],
      minProofs: 1,
    }),
  ];
  return { event, team, submission, contributions: ids, opportunities, builders: { rikuuen, dwayne, arkkk } };
}
