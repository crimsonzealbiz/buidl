import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, sql } from "drizzle-orm";
import { users } from "@/db/schema";
import { activeWallet } from "@/lib/wallet/link";
import { builderIdentity } from "@/lib/domain/identity";
import { listOpportunities } from "@/lib/domain/opportunities";
import { listEvents } from "@/lib/domain/events";
import { OpportunityTile } from "@/components/opportunity-tile";
import { Status, fmtDate, role, shortAddr } from "@/components/ui";
import { eligibilityFor } from "@/server/eligibility";
import { getSession, makeCtx } from "@/server/session";

export default async function Profile({ params }: { params: Promise<{ login: string }> }) {
  const { login } = await params;
  const session = await getSession();
  const ctx = await makeCtx(session);
  // Prefer a real GitHub identity over a demo one that happens to share the login.
  const user = await ctx.db.query.users.findFirst({
    where: sql`lower(${users.githubLogin}) = ${login.toLowerCase()}`,
    orderBy: [asc(users.demo)],
  });
  if (!user) notFound();
  const wallet = await activeWallet(ctx.db, user.id);
  const { history, roles, facts } = await builderIdentity(ctx.db, user);
  const opps = await listOpportunities(ctx.db);
  const { results, error } = await eligibilityFor(ctx, user, opps);
  const eventName = new Map((await listEvents(ctx.db)).map((e) => [e.id, e.name]));
  const isMe = session?.user.id === user.id;
  const counters: [number, string][] = [
    [facts.verifiedBuilds, facts.verifiedBuilds === 1 ? "Verified build" : "Verified builds"],
    [facts.hackathons, facts.hackathons === 1 ? "Hackathon" : "Hackathons"],
    [facts.collaborators, facts.collaborators === 1 ? "Collaborator" : "Collaborators"],
    [facts.ecosystems, facts.ecosystems === 1 ? "Ecosystem" : "Ecosystems"],
  ];

  return (
    <>
      <section className="profile-head">
        <span className="avatar lg">
          {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : (user.name ?? user.githubLogin)[0]?.toUpperCase()}
        </span>
        <div>
          <div className="kicker">Builder</div>
          <h1>{user.name ?? user.githubLogin}</h1>
          <div className="roles">{roles.length ? roles.map(role).join(" · ") : "No verified roles yet"}</div>
          <div className="signals">
            {user.demo ? (
              <span className="signal demo" title="Seeded by the demo scenario; this identity never signed in with GitHub">Demo identity · @{user.githubLogin}</span>
            ) : (
              <a className="signal on" href={`https://github.com/${user.githubLogin}`} rel="noreferrer noopener">GitHub ✓ @{user.githubLogin}</a>
            )}
            {wallet ? (
              <span className="signal on" title={`${wallet.address}, linked by signed message`}>Wallet ✓ {shortAddr(wallet.address)}</span>
            ) : (
              <span className="signal">No wallet linked</span>
            )}
          </div>
        </div>
      </section>

      <div className="counters">
        {counters.map(([n, label]) => (
          <div key={label}>
            <strong className={n === 0 ? "zero" : ""}>{n}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <h2 style={{ marginTop: 0 }}>Build history</h2>
      {history.length === 0 ? (
        <div className="empty">
          No verified builds yet. A build appears here once an event organizer reviews the evidence and issues a Proof of Build.
          {isMe && <> <Link href="/builds">See your builds in progress</Link>.</>}
        </div>
      ) : (
        <div className="history">
          {history.map((h) => (
            <Link key={h.proofId} href={`/proofs/${h.proofId}`}>
              <div>
                <div className="product">{h.product}</div>
                <div className="sub">
                  {h.eventName} · {role(h.category)} · {h.title}
                  {h.issuedAt && <> · issued {fmtDate(h.issuedAt)}</>}
                </div>
              </div>
              <Status value="verified" />
            </Link>
          ))}
        </div>
      )}

      <h2>Opportunities</h2>
      <p className="muted" style={{ maxWidth: 700 }}>
        Checked just now against {user.name ?? user.githubLogin}&apos;s Proofs of Build, re-verified on Solana.
      </p>
      {error && <div className="flash warn">{error}</div>}
      <div className="grid">
        {opps.map((o) => (
          <OpportunityTile
            key={o.id}
            opp={o}
            elig={results.get(o.id)}
            eventName={o.criteria.eventId ? eventName.get(o.criteria.eventId) : undefined}
            query={`?builder=${encodeURIComponent(user.githubLogin)}`}
          />
        ))}
      </div>
    </>
  );
}
