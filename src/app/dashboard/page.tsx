import Link from "next/link";
import { eq } from "drizzle-orm";
import { registrations, events } from "@/db/schema";
import { activeWallet } from "@/lib/wallet/link";
import { contributionsForUser } from "@/lib/domain/submissions";
import { proofsForUser } from "@/lib/proof/service";
import { Flash, Status, fmt, type PageSearch } from "@/components/ui";
import { isPlatformAdmin } from "@/lib/domain/context";
import { makeCtx, requireSession } from "@/server/session";

export default async function Dashboard({ searchParams }: { searchParams: PageSearch }) {
  const sp = await searchParams;
  const session = await requireSession();
  const { db } = await makeCtx(session);
  const user = session.user;
  const wallet = await activeWallet(db, user.id);
  const regs = await db
    .select({ event: events })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .where(eq(registrations.userId, user.id));
  const contribs = await contributionsForUser(db, user.id);
  const proofs = await proofsForUser(db, user.id);
  const eventSlug = new Map(regs.map((r) => [r.event.id, r.event.slug]));

  return (
    <>
      <Flash searchParams={sp} />
      <h1>@{user.githubLogin}</h1>
      <div className="grid">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>GitHub identity</h3>
          <div>{user.name ?? user.githubLogin}</div>
          <div className="muted">GitHub id {user.githubId}{isPlatformAdmin(user) ? " · platform admin" : ""}</div>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Solana wallet</h3>
          {wallet ? (
            <>
              <div className="mono">{wallet.address}</div>
              <div className="muted">Linked {fmt(wallet.linkedAt)} via signed message</div>
            </>
          ) : (
            <>
              <p className="muted">No wallet linked. Proofs are issued to your linked wallet.</p>
              <Link className="button" href="/wallet">Link a wallet</Link>
            </>
          )}
        </div>
      </div>

      <h2>Events</h2>
      {regs.length === 0 ? (
        <p className="muted">Not registered for any event. <Link href="/events">Browse events</Link>.</p>
      ) : (
        <ul>{regs.map((r) => <li key={r.event.id}><Link href={`/events/${r.event.slug}`}>{r.event.name}</Link></li>)}</ul>
      )}

      <h2>Your contributions</h2>
      {contribs.length === 0 ? (
        <p className="muted">None yet.</p>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Contribution</th><th>Product</th><th>Category</th><th>Status</th></tr></thead>
            <tbody>
              {contribs.map(({ contribution: c, submission: s }) => (
                <tr key={c.id}>
                  <td><Link href={`/contributions/${c.id}`}>{c.title}</Link></td>
                  <td>
                    {s.productName}
                    {eventSlug.get(s.eventId) && <span className="muted"> · {eventSlug.get(s.eventId)}</span>}
                  </td>
                  <td>{c.category}</td>
                  <td><Status value={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Your proofs</h2>
      {proofs.length === 0 ? (
        <p className="muted">No proofs yet. A proof is issued only after a reviewer approves your individual contribution.</p>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Attestation</th><th>Category</th><th>Status</th></tr></thead>
            <tbody>
              {proofs.map((p) => (
                <tr key={p.id}>
                  <td><Link className="mono" href={`/proofs/${p.id}`}>{p.attestationAddress}</Link></td>
                  <td>{String((p.onchainData as { category?: string }).category ?? "")}</td>
                  <td><Status value={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
