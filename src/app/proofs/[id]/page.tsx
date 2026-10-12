import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { getProof } from "@/lib/proof/service";
import { solanaConfig } from "@/lib/config";
import type { ProofBundle } from "@/lib/proof/bundle";
import { verifyProof, type VerificationResult } from "@/lib/proof/verify";
import { loadTrustAnchor, readLedger } from "@/lib/proof/runtime";
import { hasStaffRole, listStaff } from "@/lib/domain/events";
import { isPlatformAdmin } from "@/lib/domain/context";
import { CopyButton } from "@/components/copy-button";
import { Facts, Flash, Status, explorerUrl, fmt, fmtDate, role, shortAddr, type PageSearch } from "@/components/ui";
import { makeCtx, getSession } from "@/server/session";
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
  const holder = await db.query.users.findFirst({ where: eq(users.id, proof.userId) });
  const organizers = (await listStaff(db, b.event.id).catch(() => [])).filter((s) => s.role === "organizer").map((s) => s.user);
  const canRevoke =
    !!session &&
    proof.status === "confirmed" &&
    (isPlatformAdmin(session.user) || (await hasStaffRole(db, b.event.id, session.user.id, "organizer")));
  const revoker = proof.revokedBy ? await db.query.users.findFirst({ where: eq(users.id, proof.revokedBy) }) : null;

  // Check the credential on Solana right now, against the stored evidence record.
  let live: VerificationResult | null = null;
  let liveError: string | null = null;
  if (proof.status === "confirmed") {
    const trust = await loadTrustAnchor().catch(() => null);
    if (trust) {
      try {
        live = await verifyProof(readLedger(), proof.attestationAddress, trust, b);
      } catch (e) {
        liveError = (e as Error).message;
      }
    }
  }
  const seal =
    proof.status === "revoked"
      ? { cls: "seal bad", text: "Revoked" }
      : proof.status !== "confirmed"
        ? { cls: "seal pending", text: "Not issued yet" }
        : live && !live.valid
          ? { cls: "seal bad", text: "Failed verification" }
          : { cls: "seal", text: live ? "Verified on Solana" : "Issued" };

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
      <article className={`credential ${proof.status === "revoked" ? "revoked" : ""}`}>
        <div className="head">
          <span className="kicker">Proof of Build</span>
          <span className={seal.cls}>{seal.text}</span>
        </div>
        <div className="title">{b.submission.productName}</div>
        <div className="subtitle">
          {role(b.contribution.category)} · {b.contribution.title} · {b.event.name}
        </div>
        <Facts
          items={[
            [
              "Builder",
              <span key="b">
                <Link href={`/u/${b.holder.githubLogin}`}>{holder?.name ?? b.holder.githubLogin}</Link>{" "}
                <span className="muted mono">{shortAddr(b.holder.wallet)}</span>
              </span>,
            ],
            ["Product", <Link key="p" href={`/builds/${b.team.id}`}>{b.submission.productName}</Link>],
            ["Event", <Link key="e" href={`/events/${b.event.slug}`}>{b.event.name}</Link>],
            ["Role", `${role(b.contribution.category)} · ${b.contribution.title}`],
            [
              "Issuer",
              <span key="i">
                {organizers.length ? organizers.map((o) => `@${o.githubLogin}`).join(", ") : "Event organizers"}
                <div className="muted mono" title={b.issuer.authority}>signed by {shortAddr(b.issuer.authority, 6)}</div>
              </span>,
            ],
            ["Issued", proof.confirmedAt ? fmtDate(proof.confirmedAt) : "—"],
            ["Evidence", <a key="ev" href="#evidence">{b.evidence.length} item{b.evidence.length === 1 ? "" : "s"} reviewed</a>],
            [
              "Attestation",
              <a key="a" className="mono" href={explorerUrl("address", proof.attestationAddress, proof.cluster, rpc)}>
                {shortAddr(proof.attestationAddress, 6)}
              </a>,
            ],
          ]}
        />
      </article>

      <div className="row">
        {proof.status === "confirmed" && <Link className="button arrow" href={`/verify/${proof.attestationAddress}`}>Verify on Solana</Link>}
        <a className="button secondary" href="#evidence">View evidence</a>
        <CopyButton text={`/proofs/${proof.id}`} label="Copy proof link" />
        {proof.status === "confirmed" && <a className="button secondary" href={`/api/proofs/${proof.id}/export`}>Download evidence (JSON)</a>}
      </div>
      {liveError && <div className="flash warn">Could not reach Solana to re-check this proof just now: {liveError}</div>}

      <p className="trust-note">
        An authorized issuer for {b.event.name} reviewed {b.holder.githubLogin}&apos;s contribution evidence and issued this
        Proof of Build on Solana. Solana records the credential and lets anyone check it; the judgement that the evidence
        supports the contribution is the issuer&apos;s.
      </p>

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

      <h2 id="evidence">Evidence</h2>
      <p style={{ whiteSpace: "pre-wrap" }}>{b.contribution.description}</p>
      <div className="card">
        {b.evidence.map((e, i) => (
          <div key={i} className="member-row" style={{ gridTemplateColumns: "auto 1fr" }}>
            <Status value={e.platformCheck} />
            <span>
              <strong>{e.kind.replace("_", " ")}</strong> — {e.description}
              <div><a href={e.url} rel="noreferrer noopener" className="muted">{e.url}</a></div>
            </span>
          </div>
        ))}
      </div>
      {b.confirmations.length > 0 && (
        <>
          <h3>Teammates</h3>
          <ul>
            {b.confirmations.map((x) => (
              <li key={x.githubId}>
                <span className={`badge ${x.stance === "dispute" ? "bad" : "ok"}`}>{x.stance === "dispute" ? "disputes" : "confirms"}</span>{" "}
                @{x.githubLogin}: {x.statement}
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>Issuer&apos;s decision</h3>
      <p className="muted">Approved {fmt(b.review.decidedAt)} by @{b.review.reviewer.githubLogin}</p>
      <p style={{ whiteSpace: "pre-wrap" }}>{b.review.rationale}</p>

      <details className="advanced">
        <summary>Technical details</summary>
        <div className="table-wrap">
          <table>
            <tbody>
              <tr><td>Status</td><td><Status value={proof.status} /></td></tr>
              <tr><td>Cluster</td><td>{proof.cluster}</td></tr>
              <tr><td>Attestation</td><td className="mono">{proof.attestationAddress}</td></tr>
              <tr><td>Transaction</td><td>{proof.txSignature ? <a className="mono" href={explorerUrl("tx", proof.txSignature, proof.cluster, rpc)}>{proof.txSignature}</a> : "—"}</td></tr>
              <tr><td>Holder wallet</td><td className="mono">{proof.walletAddress}</td></tr>
              <tr><td>Issuer authority</td><td className="mono">{b.issuer.authority}</td></tr>
              <tr><td>Credential</td><td className="mono">{proof.credentialAddress}</td></tr>
              <tr><td>Schema</td><td className="mono">{proof.schemaAddress}</td></tr>
              <tr><td>Evidence bundle sha256</td><td className="mono">{proof.bundleHash}</td></tr>
              <tr><td>Onchain stats</td><td>{b.stats.length ? b.stats.join(", ") : <span className="muted">none selected</span>}</td></tr>
            </tbody>
          </table>
        </div>
        {proof.error && <pre>{proof.error}</pre>}
      </details>
    </>
  );
}
