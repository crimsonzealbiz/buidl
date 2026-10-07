"use server";

import { CONTRIBUTION_CATEGORIES } from "@/db/schema";
import { applyToOpportunity, createOpportunity } from "@/lib/domain/opportunities";
import { loadTrustAnchor, readLedger } from "@/lib/proof/runtime";
import { AppError } from "@/lib/errors";
import { act, str } from "@/server/actions";
import { makeCtx, requireSession } from "@/server/session";

export async function createOpportunityAction(form: FormData) {
  const session = await requireSession();
  const ctx = await makeCtx(session);
  return act("/opportunities", async () => {
    await createOpportunity(ctx, session.user, {
      title: str(form, "title"),
      description: str(form, "description"),
      eventId: str(form, "eventId") || null,
      categories: form.getAll("categories").map(String) as (typeof CONTRIBUTION_CATEGORIES)[number][],
      minProofs: str(form, "minProofs") || "1",
    });
    return "Opportunity created";
  });
}

export async function applyAction(form: FormData) {
  const session = await requireSession();
  const ctx = await makeCtx(session);
  const id = str(form, "opportunityId");
  return act(`/opportunities/${id}`, async () => {
    const trust = await loadTrustAnchor();
    if (!trust) throw new AppError("not_configured", "No issuer authority configured");
    await applyToOpportunity(ctx, readLedger(), trust, session.user, id, str(form, "note")).catch((e) => {
      if (e instanceof AppError) throw e;
      throw new AppError("upstream_failed", `Could not verify proofs onchain: ${(e as Error).message}`);
    });
    return "Applied. Your eligibility was verified onchain.";
  });
}
