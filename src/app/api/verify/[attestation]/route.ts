import { NextResponse, type NextRequest } from "next/server";
import { loadTrustAnchor, readLedger } from "@/lib/proof/runtime";
import { verifyProof } from "@/lib/proof/verify";
import type { ProofBundle } from "@/lib/proof/bundle";
import { jsonError } from "../../_respond";

type Params = { params: Promise<{ attestation: string }> };

async function run(attestation: string, bundle?: ProofBundle) {
  const trust = await loadTrustAnchor();
  if (!trust) return NextResponse.json({ error: "No issuer authority configured (ISSUER_AUTHORITY)" }, { status: 503 });
  try {
    return NextResponse.json(await verifyProof(readLedger(), attestation, trust, bundle));
  } catch (e) {
    return NextResponse.json({ error: `Could not reach the Solana RPC: ${(e as Error).message}` }, { status: 502 });
  }
}

/** Chain-only verification. */
export async function GET(_req: NextRequest, { params }: Params) {
  return run((await params).attestation);
}

/** Verification against a supplied evidence export (or bare bundle). */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const body = (await req.json()) as { bundle?: ProofBundle };
    return run((await params).attestation, (body.bundle ?? body) as ProofBundle);
  } catch (e) {
    return jsonError(e);
  }
}
