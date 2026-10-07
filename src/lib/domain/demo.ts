import { randomBytes } from "node:crypto";
import type { User } from "../auth/session";
import type { Ctx } from "./context";
import { createEvent } from "./events";
import { createOpportunity } from "./opportunities";

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
