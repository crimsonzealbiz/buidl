import Link from "next/link";
import { listEvents } from "@/lib/domain/events";
import { isPlatformAdmin } from "@/lib/domain/context";
import { Flash, Status, fmtDate, type PageSearch } from "@/components/ui";
import { eventPhase } from "@/lib/domain/lifecycle";
import { getSession, makeCtx } from "@/server/session";
import { createEventAction, createSampleEventAction } from "./actions";
import { EventFields } from "@/components/event-form";

export default async function EventsPage({ searchParams }: { searchParams: PageSearch }) {
  const sp = await searchParams;
  const session = await getSession();
  const { db } = await makeCtx(session);
  const all = await listEvents(db);
  return (
    <>
      <Flash searchParams={sp} />
      <div className="page-head">
        <div>
          <div className="kicker"><Link href="/discover">Discover</Link> · Events</div>
          <h1>All events</h1>
        </div>
      </div>
      {all.length === 0 && <div className="empty">No events yet.</div>}
      <div className="grid">
        {all.map((e) => (
          <Link key={e.id} href={`/events/${e.slug}`} className="tile">
            <div className="tile-top">
              <span className="kicker">{e.chain} ecosystem</span>
              <Status value={eventPhase(e)} />
            </div>
            <h3>{e.name}</h3>
            <div className="meta">Build window {fmtDate(e.startsAt)} → {fmtDate(e.submissionDeadline)}</div>
            <div className="meta">Teams up to {e.maxTeamSize}{e.prizes.length ? ` · ${e.prizes.length} prize(s)` : ""}</div>
          </Link>
        ))}
      </div>
      {session && isPlatformAdmin(session.user) && (
        <>
          <h2>Create an event</h2>
          <form action={createSampleEventAction} className="card row">
            <span>Preparing a demo? Create a sample event that is open now, with prizes and a demo-day opportunity.</span>
            <button type="submit" className="secondary">Create sample event</button>
          </form>
          <form action={createEventAction} className="stack card">
            <label>Slug (permanent, used in URLs and proofs)<input name="slug" required pattern="[a-z0-9-]+" placeholder="solana-summer-2026" /></label>
            <EventFields />
            <button type="submit">Create event</button>
          </form>
        </>
      )}
    </>
  );
}
