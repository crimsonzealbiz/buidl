import Link from "next/link";
import { solanaConfig } from "@/lib/config";
import { loadTrustAnchor, readLedger } from "@/lib/proof/runtime";
import { verifyProof, type VerificationResult } from "@/lib/proof/verify";
import { proofByAttestation } from "@/lib/proof/service";
import type { ProofBundle } from "@/lib/proof/bundle";
import { BundleCheck } from "@/components/bundle-check";
import { ChecksTable } from "@/components/checks-table";
import { Facts, explorerUrl, fmt, role, shortAddr } from "@/components/ui";
import { getDb } from "@/db";

/** Checks that only an evidence bundle can establish. */
const BUNDLE_CHECKS = ["Bundle hash matches onchain hash", "Onchain fields match bundle", "Wallet signed the link message"];

export default async function VerifyPage({ params }: { params: Promise<{ attestation: string }> }) {
  const { attestation } = await params;
  const trust = await loadTrustAnchor();
  if (!trust) {
    return <div className="flash error">No issuer authority is configured (set ISSUER_AUTHORITY), so there is nothing to verify against.</div>;
  }
  const cfg = solanaConfig();
  // This server's evidence record, if it has one; the chain is checked against it, never the other way round.
  const record = await proofByAttestation(await getDb(), attestation).catch(() => null);
  const bundle = record ? (record.bundle as unknown as ProofBundle) : undefined;
  let result: VerificationResult | null = null;
  let error: string | null = null;
  try {
    result = await verifyProof(readLedger(), attestation, trust, bundle);
  } catch (e) {
    error = `Could not reach Solana: ${(e as Error).message}`;
  }
  const chainChecks = result?.checks.filter((c) => !BUNDLE_CHECKS.includes(c.name)) ?? [];
  const chainOk = chainChecks.length > 0 && chainChecks.every((c) => c.ok);
  const integrity = !bundle
    ? "No evidence record on this server; upload an export below"
    : result?.checks.find((c) => c.name === "Bundle hash matches onchain hash")?.ok
      ? "✓ Evidence matches the attested hash"
      : "✕ Evidence does not match the attested hash";
  const o = result?.onchain;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="kicker"><Link href="/verify">Verify</Link> · {cfg.cluster}</div>
          <h1>{result ? (result.valid ? "Authentic proof" : chainOk ? "Authentic onchain, evidence mismatch" : "Not an authentic proof") : "Verification"}</h1>
        </div>
        {result && <span className={result.valid ? "seal" : "seal bad"}>{result.valid ? "Authentic" : "Failed"}</span>}
      </div>
      {error && <div className="flash error">{error}</div>}
      {result && !result.valid && (
        <div className="flash error">
          {result.checks.filter((c) => !c.ok).map((c) => c.name).join(" · ")}
        </div>
      )}
      {o && (
        <Facts
          items={[
            [
              "Builder",
              <span key="b">
                {bundle ? <Link href={`/u/${bundle.holder.githubLogin}`}>@{bundle.holder.githubLogin}</Link> : `GitHub id ${o.githubId}`}{" "}
                <span className="muted mono">{shortAddr(o.holder)}</span>
              </span>,
            ],
            ["Product", o.product],
            ["Event", bundle?.event.name ?? o.event],
            ["Role", role(o.category)],
            ["Issuer", <span key="i" className="mono" title={trust.authority}>{shortAddr(trust.authority, 6)}</span>],
            ["Approved", fmt(o.approvedAt)],
            ["Evidence integrity", integrity],
            [
              "Attestation",
              <a key="a" className="mono" href={explorerUrl("address", attestation, cfg.cluster, cfg.rpcUrl)}>{shortAddr(attestation, 6)}</a>,
            ],
          ]}
        />
      )}
      {record && <p><Link className="button secondary" href={`/proofs/${record.id}`}>Open the Proof of Build</Link></p>}
      <p className="trust-note">
        &quot;Authentic&quot; means this credential exists on Solana, was issued by the trusted issuer under the Proof of Build
        schema, and has not been revoked. It does not by itself prove the builder built anything: that judgement was
        made by the issuer when they reviewed the evidence.
      </p>

      {result && (
        <details className="advanced">
          <summary>Advanced verification</summary>
          <p className="muted">Trusted issuer authority: <span className="mono">{trust.authority}</span></p>
          <ChecksTable checks={result.checks} />
          {o && (
            <>
              <h3>Attested data</h3>
              <pre>{JSON.stringify(o, null, 2)}</pre>
            </>
          )}
          <h3>Check an evidence export</h3>
          <BundleCheck attestation={attestation} />
          <h3>Verify independently with the open-source CLI</h3>
          <pre>npm run verify -- {attestation} --bundle export.json --issuer {trust.authority}{cfg.cluster === "localnet" ? ` --rpc ${cfg.rpcUrl}` : ""}</pre>
        </details>
      )}
    </>
  );
}
