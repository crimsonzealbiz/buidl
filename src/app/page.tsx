import Link from "next/link";
import { configStatus } from "@/lib/config";
import { Flash, type PageSearch } from "@/components/ui";
import { getSession } from "@/server/session";

export default async function Home({ searchParams }: { searchParams: PageSearch }) {
  const sp = await searchParams;
  const session = await getSession();
  const config = configStatus();
  return (
    <>
      <Flash searchParams={sp} />
      <h1>Proof of what you actually built.</h1>
      <p className="muted" style={{ maxWidth: 680 }}>
        buidl is a Solana-first identity network for hackathon builders. Your GitHub identity and a wallet you sign
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
      <h2>Configuration</h2>
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
          </tbody>
        </table>
      </div>
    </>
  );
}
