import "server-only";
import type { User } from "@/lib/auth/session";
import type { Ctx } from "@/lib/domain/context";
import { evaluateOpportunity, verifiedProofsFor, type Eligibility, type Opportunity } from "@/lib/domain/opportunities";
import { loadTrustAnchor, readLedger } from "@/lib/proof/runtime";

/**
 * Eligibility of one builder for several opportunities. Proofs are
 * re-verified onchain once per call. On failure, returns why instead of
 * guessing: an unreachable cluster never reads as "not eligible".
 */
export async function eligibilityFor(
  ctx: Ctx,
  user: User,
  opps: Opportunity[],
): Promise<{ results: Map<string, Eligibility>; error: string | null }> {
  const results = new Map<string, Eligibility>();
  if (opps.length === 0) return { results, error: null };
  const trust = await loadTrustAnchor().catch(() => null);
  if (!trust) return { results, error: "No issuer is configured, so proofs cannot be verified." };
  try {
    const check = await verifiedProofsFor(ctx, readLedger(), trust, user);
    for (const o of opps) results.set(o.id, await evaluateOpportunity(ctx, o, check));
    return { results, error: null };
  } catch (e) {
    return { results, error: `Could not verify proofs on Solana: ${(e as Error).message}` };
  }
}
