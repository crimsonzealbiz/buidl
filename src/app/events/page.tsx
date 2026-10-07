import Link from "next/link";
import { listEvents } from "@/lib/domain/events";
import { isPlatformAdmin } from "@/lib/domain/context";
import { Flash, fmt, type PageSearch } from "@/components/ui";
import { getSession, makeCtx } from "@/server/session";
import { createEventAction } from "./actions";

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
          </Link>
        ))}
      </div>
      {session && isPlatformAdmin(session.user) && (
        <>
          <h2>Create an event</h2>
          <form action={createEventAction} className="stack card">
            <label>Name<input name="name" required /></label>
            <label>Slug<input name="slug" required pattern="[a-z0-9-]+" placeholder="solana-summer-2026" /></label>
            <label>Description<textarea name="description" /></label>
            <label>Starts (UTC)<input name="startsAt" type="datetime-local" required /></label>
            <label>Ends (UTC)<input name="endsAt" type="datetime-local" required /></label>
            <label>Submission deadline (UTC)<input name="submissionDeadline" type="datetime-local" required /></label>
            <button type="submit">Create event</button>
          </form>
        </>
      )}
    </>
  );
}
