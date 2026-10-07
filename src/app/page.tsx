import Link from "next/link";
import { configStatus } from "@/lib/config";
import { isPlatformAdmin } from "@/lib/domain/context";
import { loadIssuer } from "@/lib/proof/runtime";
import { issuerHealth, type IssuerHealth } from "@/lib/proof/issuer";
import { Flash, type PageSearch } from "@/components/ui";
import { getSession } from "@/server/session";

export default async function Home({ searchParams }: { searchParams: PageSearch }) {
  const sp = await searchParams;
  const session = await getSession();
  const admin = !!session && isPlatformAdmin(session.user);
  const config = admin ? configStatus() : [];
  let health: IssuerHealth | null = null;
  let healthError: string | null = null;
  if (admin) {
    const loaded = await loadIssuer();
    if (loaded.issuer) {
      try {
        health = await issuerHealth(loaded.issuer.ledger, loaded.issuer.signer.address, loaded.issuer.config);
      } catch (e) {
        healthError = `Could not reach the Solana RPC: ${(e as Error).message}`;
      }
    }
  }
  return (
    <>
      <Flash searchParams={sp} />
      <h1>Proof of what you actually built.</h1>
      <p className="muted" style={{ maxWidth: 680 }}>
        forge is a Solana-first identity network for hackathon builders. Your GitHub identity and a wallet you sign
        for are linked; each teammate documents their own contribution with evidence; an event reviewer approves it;
        and the approval is issued as a Solana Attestation Service proof that anyone can verify, with no trust in us
        required.
      </p>
      <ol className="steps">
        <li>Sign in with GitHub</li>
        <li>Link a Solana wallet by signing a one-time message</li>
        <li>Register for an event, form a team, register your repository (its baseline commit is recorded)</li>
        <li>Submit the product, then each member submits their own contribution and evidence: code, design, research, docs, and more</li>
        <li>A reviewer approves or rejects each contribution individually</li>
        <li>Approved contributions become devnet proofs with reviewer-selected stats</li>
        <li>Anyone can verify a proof and download its evidence; opportunities check eligibility against verified proofs</li>
      </ol>
      <div className="row">
        {session ? (
          <Link className="button" href="/dashboard">Go to your dashboard</Link>
        ) : (
          <a className="button" href="/api/auth/github/start">Sign in with GitHub</a>
        )}
        <Link className="button secondary" href="/verify">Verify a proof</Link>
      </div>
      {admin && (
        <>
          <h2>Configuration <span className="muted" style={{ fontSize: "0.8rem" }}>(visible to admins only)</span></h2>
          <div className="card table-wrap">
            <table>
              <tbody>
                {config.map((c) => (
                  <tr key={c.name}>
                    <td>{c.name}</td>
                    <td><span className={`badge ${c.ok ? "ok" : "bad"}`}>{c.ok ? "ready" : "missing"}</span></td>
                    <td className="muted">{c.detail}</td>
                  </tr>
                ))}
                {health && (
                  <tr>
                    <td>Issuer readiness</td>
                    <td><span className={`badge ${health.problems.length ? "bad" : "ok"}`}>{health.problems.length ? "action needed" : "ready"}</span></td>
                    <td className="muted">
                      {health.balanceSol} SOL · credential {health.credentialExists ? "✓" : "missing"} · schema {health.schemaExists ? "✓" : "missing"}
                      {health.problems.map((p) => <div key={p}>{p}</div>)}
                    </td>
                  </tr>
                )}
                {healthError && (
                  <tr><td>Issuer readiness</td><td><span className="badge bad">unknown</span></td><td className="muted">{healthError}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
