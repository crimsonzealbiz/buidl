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
      <section className="hero">
        <div className="eyebrow">Identity network for hackathon builders</div>
        <h1>Proof of what you <mark>actually</mark> built.</h1>
        <p className="lead">
          forge links your GitHub identity to a wallet you sign for. Each teammate documents their own contribution
          with evidence, an event reviewer approves it, and the approval is issued as a Solana Attestation Service
          proof that anyone can verify, with no trust in us required.
        </p>
        <div className="row">
          {session ? (
            <Link className="button arrow" href="/dashboard">Go to your dashboard</Link>
          ) : (
            <a className="button arrow" href="/api/auth/github/start">Sign in with GitHub</a>
          )}
          <Link className="button secondary" href="/verify">Verify a proof</Link>
        </div>
      </section>

      <div className="stats">
        <div><strong>1:1</strong><span>One proof per person, per contribution</span></div>
        <div><strong>Onchain</strong><span>Verifiable on Solana without our servers</span></div>
        <div><strong>Reviewed</strong><span>Every proof approved by an event reviewer</span></div>
      </div>

      <div className="section-head">
        <h2>From commit to credential.</h2>
        <p className="muted" style={{ maxWidth: 360, margin: 0 }}>
          Four steps take a hackathon contribution from a repository to a proof anyone can check.
        </p>
      </div>
      <div className="pillars">
        <div>
          <span className="num">01</span>
          <h3>Link</h3>
          <p>Sign in with GitHub and link a Solana wallet by signing a one-time message.</p>
        </div>
        <div>
          <span className="num">02</span>
          <h3>Build</h3>
          <p>Join an event, form a team and register your repository. Its baseline commit is recorded.</p>
        </div>
        <div>
          <span className="num">03</span>
          <h3>Document</h3>
          <p>Each member submits their own contribution and evidence: code, design, research, docs and more.</p>
        </div>
        <div>
          <span className="num">04</span>
          <h3>Verify</h3>
          <p>Approved work becomes a devnet proof. Anyone can verify it, and opportunities check eligibility against it.</p>
        </div>
      </div>

      <div className="cta">
        <h2>Show what you shipped, not just where you were.</h2>
        <Link className="button arrow" href="/events">Browse events</Link>
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
