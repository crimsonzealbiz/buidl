import { NextResponse } from "next/server";
import { solanaConfig } from "@/lib/config";
import { loadTrustAnchor } from "@/lib/proof/runtime";
import { SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS } from "@solana/attestation";
import { PROOF_SCHEMA_FIELDS } from "@/lib/proof/sas-schema";

/** Public trust anchor: what verifiers should expect a genuine proof to reference. */
export async function GET() {
  const trust = await loadTrustAnchor();
  if (!trust) return NextResponse.json({ error: "Issuer not configured" }, { status: 503 });
  const cfg = solanaConfig();
  return NextResponse.json({
    cluster: cfg.cluster,
    program: SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
    ...trust,
    schemaName: cfg.schemaName,
    schemaVersion: cfg.schemaVersion,
    fields: PROOF_SCHEMA_FIELDS.map(([n]) => n),
  });
}
