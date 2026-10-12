import Link from "next/link";
import { activeWallet } from "@/lib/wallet/link";
import { isPlatformAdmin } from "@/lib/domain/context";
import { nextSteps } from "@/lib/domain/next-steps";
import { configStatus } from "@/lib/config";
import { loadIssuer } from "@/lib/proof/runtime";
import { issuerHealth, type IssuerHealth } from "@/lib/proof/issuer";
import { Facts, Flash, fmt, type PageSearch } from "@/components/ui";
import { makeCtx, requireSession } from "@/server/session";
import { createOriginsScenarioAction, createSampleEventAction } from "../events/actions";

export default async function Dashboard({ searchParams }: { searchParams: PageSearch }) {
  const sp = await searchParams;
  const session = await requireSession();
  const { db } = await makeCtx(session);
  const user = session.user;
  const wallet = await activeWallet(db, user.id);
  const steps = await nextSteps(db, user);
  const admin = isPlatformAdmin(user);
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
      <div className="page-head">
        <div>
          <div className="kicker">Dashboard</div>
          <h1>@{user.githubLogin}</h1>
        </div>
        <Link className="button secondary" href={`/u/${user.githubLogin}`}>View public profile</Link>
      </div>

      <Facts
        items={[
          ["GitHub", `@${user.githubLogin} ✓`],
          [
            "Solana wallet",
            wallet ? (
              <span key="w"><span className="mono">{wallet.address.slice(0, 10)}…</span> <span className="muted">linked {fmt(wallet.linkedAt)}</span></span>
            ) : (
              <Link key="w" href="/wallet">Link a wallet →</Link>
            ),
          ],
          ["Role", admin ? "Platform admin" : "Builder"],
        ]}
      />

      <section className="action-panel">
        <h2>Next steps</h2>
        {steps.builder.length === 0 && steps.staff.length === 0 && <p>You&apos;re all caught up.</p>}
        <ol className="steps">
          {steps.builder.map((st, i) => (
            <li key={i}>
              <Link href={st.href}>{st.label}</Link>
              {st.detail && <span className="muted"> · {st.detail}</span>}
            </li>
          ))}
        </ol>
        {steps.staff.length > 0 && (
          <>
            <h3>As organizer or reviewer</h3>
            <ul>
              {steps.staff.map((st, i) => (
                <li key={i}>
                  <Link href={st.href}>{st.label}</Link>
                  {st.detail && <span className="muted"> · {st.detail}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {admin && (
        <>
          <h2>Demo tools</h2>
          <div className="split">
            <form action={createOriginsScenarioAction} className="card">
              <h3 style={{ marginTop: 0 }}>Proof of Build demo</h3>
              <p className="muted">
                Creates the live <strong>Origins Hackathon</strong> with you as organizer and issuer, team FORGE (Rikuuen,
                Dwayne, Arkkk as labelled demo identities) with submitted contributions and evidence, and three
                opportunities. Review, Solana issuance, verification and eligibility then run for real.
              </p>
              <button type="submit">Load demo scenario</button>
            </form>
            <form action={createSampleEventAction} className="card">
              <h3 style={{ marginTop: 0 }}>Empty sample event</h3>
              <p className="muted">An open event with prizes and a demo-day opportunity, for a demo with real participants.</p>
              <button type="submit" className="secondary">Create sample event</button>
            </form>
          </div>

          <h2>Configuration <span className="muted" style={{ fontSize: "0.8rem" }}>(admins only)</span></h2>
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
