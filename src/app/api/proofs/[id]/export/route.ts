import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { exportEvidence, getProof } from "@/lib/proof/service";

/** Public evidence export. Proof bundles are meant to be shared and independently checked. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const proof = await getProof(await getDb(), (await params).id);
  if (!proof || proof.status !== "confirmed") return NextResponse.json({ error: "Proof not found" }, { status: 404 });
  return new NextResponse(JSON.stringify(exportEvidence(proof), null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="buidl-proof-${proof.attestationAddress}.json"`,
    },
  });
}
