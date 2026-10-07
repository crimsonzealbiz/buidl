import Link from "next/link";
import { notFound } from "next/navigation";
import { getProof } from "@/lib/proof/service";
import { solanaConfig } from "@/lib/config";
import type { ProofBundle } from "@/lib/proof/bundle";
import { Status, explorerUrl, fmt } from "@/components/ui";
import { makeCtx, getSession } from "@/server/session";
import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { hasStaffRole } from "@/lib/domain/events";
import { isPlatformAdmin } from "@/lib/domain/context";
import { Flash, type PageSearch } from "@/components/ui";
import { revokeProofAction } from "../../events/actions";

export default async function ProofPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: PageSearch }) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await getSession();
  const { db } = await makeCtx(session);
  const proof = await getProof(db, id);
  if (!proof) notFound();
  const b = proof.bundle as unknown as ProofBundle;
  const rpc = solanaConfig().rpcUrl;
  const canRevoke =
    !!session &&
    proof.status === "confirmed" &&
    (isPlatformAdmin(session.user) || (await hasStaffRole(db, b.event.id, session.user.id, "organizer")));
  const revoker = proof.revokedBy ? await db.query.users.findFirst({ where: eq(users.id, proof.revokedBy) }) : null;
  return (
    <>
      <Flash searchParams={sp} />
      {proof.status === "revoked" && (
        <div className="flash error">
          Revoked {fmt(proof.revokedAt)}{revoker && ` by @${revoker.githubLogin}`}: {proof.revokeReason}
          {proof.revokeTxSignature && (
            <> (<a href={explorerUrl("tx", proof.revokeTxSignature, proof.cluster, rpc)}>transaction</a>)</>
          )}
          . The attestation was closed onchain and no longer verifies.
        </div>
      )}
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
      {canRevoke && (
        <details className="card">
          <summary><strong>Revoke this proof</strong> <span className="muted">(organizers only, cannot be undone)</span></summary>
          <form action={revokeProofAction} className="stack" style={{ marginTop: 12 }}>
            <input type="hidden" name="proofId" value={proof.id} />
            <p className="muted">
              Closes the attestation onchain. It will stop verifying and stop counting toward opportunities. Use this
              when an approval was a mistake or the contribution turned out not to be genuine.
            </p>
            <label>Reason (kept on record)<textarea name="reason" required minLength={10} /></label>
            <button type="submit">Revoke proof</button>
          </form>
        </details>
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
