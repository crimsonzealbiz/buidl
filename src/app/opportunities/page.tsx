import Link from "next/link";
import { CONTRIBUTION_CATEGORIES } from "@/db/schema";
import { listOpportunities } from "@/lib/domain/opportunities";
import { listEvents } from "@/lib/domain/events";
import { isPlatformAdmin } from "@/lib/domain/context";
import { Flash, type PageSearch } from "@/components/ui";
import { getSession, makeCtx } from "@/server/session";
import { createOpportunityAction } from "./actions";

export default async function OpportunitiesPage({ searchParams }: { searchParams: PageSearch }) {
  const sp = await searchParams;
  const session = await getSession();
  const { db } = await makeCtx(session);
  const opps = await listOpportunities(db);
  const events = await listEvents(db);
  const eventName = new Map(events.map((e) => [e.id, e.name]));
  return (
    <>
      <Flash searchParams={sp} />
      <h1>Demo opportunities</h1>
      <p className="muted">Eligibility is decided from proofs verified onchain at the moment you apply.</p>
      {opps.length === 0 && <p className="muted">No opportunities yet.</p>}
      {opps.map((o) => (
        <Link key={o.id} href={`/opportunities/${o.id}`} className="card" style={{ display: "block", textDecoration: "none", color: "inherit" }}>
          <strong>{o.title}</strong>
          <div className="muted">
            Requires {o.criteria.minProofs} verified proof(s)
            {o.criteria.eventId && <> from {eventName.get(o.criteria.eventId) ?? "an event"}</>}
            {o.criteria.categories?.length ? <> in {o.criteria.categories.join(" / ")}</> : null}
          </div>
        </Link>
      ))}
      {session && (
        <>
          <h2>Create an opportunity</h2>
          <p className="muted">
            Platform admins can create any opportunity; event organizers can create ones scoped to their event.
            {!isPlatformAdmin(session.user) && " Choose your event below."}
          </p>
          <form action={createOpportunityAction} className="stack card">
            <label>Title<input name="title" required /></label>
            <label>Description<textarea name="description" required /></label>
            <label>
              Proofs must come from
              <select name="eventId" defaultValue="">
                <option value="">any event</option>
                {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </label>
            <fieldset className="card">
              <legend>Qualifying categories (none = any)</legend>
              <div className="row">
                {CONTRIBUTION_CATEGORIES.map((c) => (
                  <label key={c} className="check"><input type="checkbox" name="categories" value={c} /> {c}</label>
                ))}
              </div>
            </fieldset>
            <label>Minimum verified proofs<input name="minProofs" type="number" min={1} max={20} defaultValue={1} /></label>
            <button type="submit">Create</button>
          </form>
        </>
      )}
    </>
  );
}
