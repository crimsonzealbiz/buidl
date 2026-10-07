import Link from "next/link";
import { notFound } from "next/navigation";
import { getProof } from "@/lib/proof/service";
import { solanaConfig } from "@/lib/config";
import type { ProofBundle } from "@/lib/proof/bundle";
import { Status, explorerUrl, fmt } from "@/components/ui";
import { makeCtx, getSession } from "@/server/session";

export default async function ProofPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db } = await makeCtx(await getSession());
  const proof = await getProof(db, id);
  if (!proof) notFound();
  const b = proof.bundle as unknown as ProofBundle;
  const rpc = solanaConfig().rpcUrl;
  return (
    <>
      <h1>{b.contribution.title}</h1>
      <p>
        <Status value={proof.status} /> <span className="muted">{b.contribution.category} · @{b.holder.githubLogin} ·{" "}
        {b.event.name} · {b.submission.productName}</span>
      </p>
      <div className="card table-wrap">
        <table>
          <tbody>
            <tr><td>Cluster</td><td>{proof.cluster}</td></tr>
            <tr><td>Attestation</td><td><a className="mono" href={explorerUrl("address", proof.attestationAddress, proof.cluster, rpc)}>{proof.attestationAddress}</a></td></tr>
            <tr><td>Transaction</td><td>{proof.txSignature ? <a className="mono" href={explorerUrl("tx", proof.txSignature, proof.cluster, rpc)}>{proof.txSignature}</a> : "—"}</td></tr>
            <tr><td>Holder wallet</td><td className="mono">{proof.walletAddress}</td></tr>
            <tr><td>Credential</td><td className="mono">{proof.credentialAddress}</td></tr>
            <tr><td>Schema</td><td className="mono">{proof.schemaAddress}</td></tr>
            <tr><td>Bundle sha256</td><td className="mono">{proof.bundleHash}</td></tr>
            <tr><td>Approved</td><td>{fmt(b.review.decidedAt)} by @{b.review.reviewer.githubLogin}</td></tr>
            <tr><td>Onchain stats</td><td>{b.stats.length ? b.stats.join(", ") : <span className="muted">none selected</span>}</td></tr>
          </tbody>
        </table>
      </div>
      {proof.error && <pre>{proof.error}</pre>}
      {proof.status === "confirmed" && (
        <div className="row">
          <Link className="button" href={`/verify/${proof.attestationAddress}`}>Verify independently</Link>
          <a className="button secondary" href={`/api/proofs/${proof.id}/export`}>Download evidence (JSON)</a>
        </div>
      )}
      <h2>Reviewer rationale</h2>
      <p style={{ whiteSpace: "pre-wrap" }}>{b.review.rationale}</p>
      <h2>Evidence</h2>
      <ul>
        {b.evidence.map((e, i) => (
          <li key={i}><Status value={e.platformCheck} /> {e.kind}: <a href={e.url}>{e.url}</a> — {e.description}</li>
        ))}
      </ul>
    </>
  );
}
