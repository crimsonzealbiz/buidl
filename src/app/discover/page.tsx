import Link from "next/link";
import { listEvents, listStaff } from "@/lib/domain/events";
import { listOpportunities, type Eligibility } from "@/lib/domain/opportunities";
import { eventPhase, type EventPhase } from "@/lib/domain/lifecycle";
import { OpportunityTile } from "@/components/opportunity-tile";
import { Flash, Status, fmtDate, type PageSearch } from "@/components/ui";
import { eligibilityFor } from "@/server/eligibility";
import { getSession, makeCtx } from "@/server/session";

const PHASE_ORDER: Record<EventPhase, number> = { live: 0, upcoming: 1, reviewing: 2, ended: 3 };

export default async function Discover({ searchParams }: { searchParams: PageSearch }) {
  const sp = await searchParams;
  const session = await getSession();
  const ctx = await makeCtx(session);
  const now = new Date();
  const events = (await listEvents(ctx.db))
    .map((e) => ({ e, phase: eventPhase(e, now) }))
    .sort((a, b) => PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase] || a.e.startsAt.getTime() - b.e.startsAt.getTime());
  const organizers = new Map(
    await Promise.all(
      events.map(async ({ e }) => [e.id, (await listStaff(ctx.db, e.id)).filter((s) => s.role === "organizer").map((s) => s.user)] as const),
    ),
  );
  const opps = await listOpportunities(ctx.db);
  const eventName = new Map(events.map(({ e }) => [e.id, e.name]));
  const { results, error } = session ? await eligibilityFor(ctx, session.user, opps) : { results: new Map<string, Eligibility>(), error: null };

  return (
    <>
      <Flash searchParams={sp} />
      <div className="page-head">
        <div>
          <div className="kicker">Discover</div>
          <h1>Find your next build.</h1>
          <p className="lead-sm">
            Join a hackathon, ship with a team, and earn a Proof of Build. Verified builds unlock the opportunities below.
          </p>
        </div>
      </div>

      <h2 id="events">Events</h2>
      {events.length === 0 && <div className="empty">No events yet.</div>}
      <div className="grid">
        {events.map(({ e, phase }) => (
          <Link key={e.id} href={`/events/${e.slug}`} className="tile">
            <div className="tile-top">
              <span className="kicker">{e.chain} ecosystem</span>
              <Status value={phase} />
            </div>
            <h3>{e.name}</h3>
            <div className="meta">Build window {fmtDate(e.startsAt)} → {fmtDate(e.submissionDeadline)}</div>
            <div className="meta">
              Organized by {organizers.get(e.id)?.map((u) => `@${u.githubLogin}`).join(", ") || "—"}
            </div>
            {(phase === "live" || phase === "upcoming") && (
              <div style={{ marginTop: 14 }}><span className="button small arrow">Join event</span></div>
            )}
          </Link>
        ))}
      </div>

      <h2 id="opportunities">Opportunities</h2>
      <p className="muted" style={{ maxWidth: 680 }}>
        Eligibility is decided from your Proofs of Build, re-verified on Solana when you open this page.
        {!session && " Sign in to see which ones you qualify for."}
      </p>
      {error && <div className="flash warn">{error}</div>}
      {opps.length === 0 && <div className="empty">No opportunities yet.</div>}
      <div className="grid">
        {opps.map((o) => (
          <OpportunityTile
            key={o.id}
            opp={o}
            elig={results.get(o.id)}
            eventName={o.criteria.eventId ? eventName.get(o.criteria.eventId) : undefined}
          />
        ))}
      </div>
    </>
  );
}
