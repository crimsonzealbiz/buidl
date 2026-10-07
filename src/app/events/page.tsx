import Link from "next/link";
import { listEvents } from "@/lib/domain/events";
import { isPlatformAdmin } from "@/lib/domain/context";
import { Flash, fmt, type PageSearch } from "@/components/ui";
import { getSession, makeCtx } from "@/server/session";
import { createEventAction } from "./actions";
import { EventFields } from "@/components/event-form";

export default async function EventsPage({ searchParams }: { searchParams: PageSearch }) {
  const sp = await searchParams;
  const session = await getSession();
  const { db } = await makeCtx(session);
  const all = await listEvents(db);
  return (
    <>
      <Flash searchParams={sp} />
      <h1>Events</h1>
      {all.length === 0 && <p className="muted">No events yet.</p>}
      <div className="grid">
        {all.map((e) => (
          <Link key={e.id} href={`/events/${e.slug}`} className="card" style={{ textDecoration: "none", color: "inherit" }}>
            <strong>{e.name}</strong>
            <div className="muted">{fmt(e.startsAt)} → {fmt(e.endsAt)}</div>
            <div className="muted">Submissions close {fmt(e.submissionDeadline)}</div>
            <div className="muted">{e.chain} · teams up to {e.maxTeamSize}{e.prizes.length ? ` · ${e.prizes.length} prize(s)` : ""}</div>
          </Link>
        ))}
      </div>
      {session && isPlatformAdmin(session.user) && (
        <>
          <h2>Create an event</h2>
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
