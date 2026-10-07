import { loadTrustAnchor, readLedger } from "@/lib/proof/runtime";
import { verifyProof } from "@/lib/proof/verify";
import { BundleCheck } from "@/components/bundle-check";
import { ChecksTable } from "@/components/checks-table";

export default async function VerifyPage({ params }: { params: Promise<{ attestation: string }> }) {
  const { attestation } = await params;
  const trust = await loadTrustAnchor();
  if (!trust) {
    return <div className="flash error">No issuer authority is configured (set ISSUER_AUTHORITY), so there is nothing to verify against.</div>;
  }
  let result;
  let error: string | null = null;
  try {
    result = await verifyProof(readLedger(), attestation, trust);
  } catch (e) {
    error = `Could not reach the Solana RPC: ${(e as Error).message}`;
  }
  return (
    <>
      <h1>Verification</h1>
      <p className="mono">{attestation}</p>
      <p className="muted">Trusted issuer authority: <span className="mono">{trust.authority}</span></p>
      {error && <div className="flash error">{error}</div>}
      {result && (
        <>
          <div className={`flash ${result.valid ? "ok" : "error"}`}>
            {result.valid ? "Valid: genuine buidl proof onchain (chain-only check)" : "Not a valid buidl proof"}
          </div>
          <ChecksTable checks={result.checks} />
          {result.onchain && (
            <>
              <h2>Attested data</h2>
              <pre>{JSON.stringify(result.onchain, null, 2)}</pre>
            </>
          )}
          <h2>Check an evidence export</h2>
          <BundleCheck attestation={attestation} />
        </>
      )}
    </>
  );
}
