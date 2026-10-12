import { CONTRIBUTION_CATEGORIES, OPPORTUNITY_KINDS } from "@/db/schema";
import { listOpportunities, type Eligibility } from "@/lib/domain/opportunities";
import { EVENT_CHAINS, listEvents } from "@/lib/domain/events";
import { isPlatformAdmin } from "@/lib/domain/context";
import { OpportunityTile } from "@/components/opportunity-tile";
import { Flash, role, type PageSearch } from "@/components/ui";
import { eligibilityFor } from "@/server/eligibility";
import { getSession, makeCtx } from "@/server/session";
import { createOpportunityAction } from "./actions";

export default async function OpportunitiesPage({ searchParams }: { searchParams: PageSearch }) {
  const sp = await searchParams;
  const session = await getSession();
  const ctx = await makeCtx(session);
  const opps = await listOpportunities(ctx.db);
  const events = await listEvents(ctx.db);
  const eventName = new Map(events.map((e) => [e.id, e.name]));
  const { results, error } = session ? await eligibilityFor(ctx, session.user, opps) : { results: new Map<string, Eligibility>(), error: null };
  return (
    <>
      <Flash searchParams={sp} />
      <div className="page-head">
        <div>
          <div className="kicker">Discover · Opportunities</div>
          <h1>Opportunities</h1>
          <p className="lead-sm">Hackathons, grants, bounties and teams that open up once your builds are verified.</p>
        </div>
      </div>
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
      {session && (
        <details className="card" style={{ marginTop: 32 }}>
          <summary><strong>Create an opportunity</strong></summary>
          <p className="muted">
            Platform admins can create any opportunity; event organizers can create ones scoped to their event.
            {!isPlatformAdmin(session.user) && " Choose your event below."}
          </p>
          <form action={createOpportunityAction} className="stack">
            <label>Title<input name="title" required /></label>
            <label>
              Kind
              <select name="kind" defaultValue="hackathon">
                {OPPORTUNITY_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            <label>Description<textarea name="description" required /></label>
            <label>
              Proofs must come from
              <select name="eventId" defaultValue="">
                <option value="">any event</option>
                {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </label>
            <fieldset className="card">
              <legend>Qualifying roles (none = any)</legend>
              <div className="row">
                {CONTRIBUTION_CATEGORIES.map((c) => (
                  <label key={c} className="check"><input type="checkbox" name="categories" value={c} /> {role(c)}</label>
                ))}
              </div>
            </fieldset>
            <fieldset className="card">
              <legend>Ecosystem experience (none = any)</legend>
              <div className="row">
                {EVENT_CHAINS.map((c) => (
                  <label key={c} className="check"><input type="checkbox" name="ecosystems" value={c} /> {c}</label>
                ))}
              </div>
            </fieldset>
            <label>Minimum verified builds<input name="minProofs" type="number" min={1} max={20} defaultValue={1} /></label>
            <button type="submit">Create</button>
          </form>
        </details>
      )}
    </>
  );
}
