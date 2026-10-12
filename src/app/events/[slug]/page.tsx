import Link from "next/link";
import { notFound } from "next/navigation";
import { CONTRIBUTION_CATEGORIES } from "@/db/schema";
import { getEventBySlug, isRegistered, listStaff, staffRoles } from "@/lib/domain/events";
import { listTeams, teamForUser } from "@/lib/domain/teams";
import { buildView } from "@/lib/domain/builds";
import { builderJourney, eventPhase, type ProofStatus } from "@/lib/domain/lifecycle";
import { Facts, Flash, Status, Stepper, fmt, role, type PageSearch } from "@/components/ui";
import { EventFields } from "@/components/event-form";
import { getSession, makeCtx } from "@/server/session";
import {
  addStaffAction,
  createTeamAction,
  leaveTeamAction,
  updateEventAction,
  joinTeamAction,
  registerAction,
  registerRepoAction,
  saveContributionAction,
  saveSubmissionAction,
} from "../actions";

type Props = { params: Promise<{ slug: string }>; searchParams: PageSearch };

export default async function EventPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const session = await getSession();
  const { db } = await makeCtx(session);
  const event = await getEventBySlug(db, slug);
  if (!event) notFound();
  const now = new Date();
  const phase = eventPhase(event, now);
  const open = now < event.submissionDeadline;
  const user = session?.user ?? null;
  const roles = user ? await staffRoles(db, event.id, user.id) : [];
  const isStaff = roles.length > 0;
  const registered = user ? await isRegistered(db, event.id, user.id) : false;
  const team = user ? await teamForUser(db, event.id, user.id) : null;
  const build = team ? await buildView(db, team.id, now) : null;
  const me = build?.members.find((m) => m.user.id === user?.id) ?? null;
  const mine = me?.contribution ?? null;
  const staff = await listStaff(db, event.id);
  const organizers = staff.filter((s) => s.role === "organizer").map((s) => s.user);
  const journey = builderJourney({
    signedIn: !!user,
    registered,
    teamId: team?.id ?? null,
    hasRepo: !!build?.repo,
    hasSubmission: !!build?.submission,
    mine: mine
      ? { id: mine.id, status: mine.status, proof: me?.proof ? { id: me.proof.id, status: me.proof.status as ProofStatus } : null }
      : null,
    phase,
  });
  const allBuilds = isStaff ? await Promise.all((await listTeams(db, event.id)).map((t) => buildView(db, t.id, now))) : [];
  const awaiting = allBuilds.flatMap((b) => b.members).filter((m) => m.stage === "under_review").length;
  const toIssue = allBuilds.flatMap((b) => b.members).filter((m) => m.stage === "approved").length;
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;
  const showJourney = !isStaff || registered;
  const a = journey.action;

  return (
    <>
      <Flash searchParams={sp} />
      <div className="page-head">
        <div>
          <div className="kicker">{event.chain} ecosystem · Hackathon</div>
          <h1>{event.name}</h1>
        </div>
        <Status value={phase} />
      </div>
      {event.description && <p className="lead-sm" style={{ whiteSpace: "pre-wrap" }}>{event.description}</p>}

      <Facts
        items={[
          ["Build window opens", fmt(event.startsAt)],
          ["Submission deadline", fmt(event.submissionDeadline)],
          ["Event ends", fmt(event.endsAt)],
          ["Organizer · Issuer", organizers.map((o) => `@${o.githubLogin}`).join(", ") || "—"],
          ["Teams", `Up to ${event.maxTeamSize} builders`],
          ...(user && showJourney ? [["You", registered ? (team ? `Registered · ${team.name}` : "Registered") : "Not registered"] as [string, string]] : []),
        ]}
      />

      {isStaff && (
        <section className="action-panel">
          <div className="kicker">You are {roles.join(" & ")}</div>
          <h2>Review contributions and issue Proofs of Build</h2>
          <p>
            {awaiting} contribution{awaiting === 1 ? "" : "s"} awaiting review · {toIssue} approved and ready to issue
          </p>
          <Link className="button arrow" href={`/events/${slug}/review`}>Open review</Link>
        </section>
      )}

      {showJourney && (
        <>
          <h2 style={{ marginTop: 0 }}>Your path to a Proof of Build</h2>
          <Stepper steps={journey.steps} />
          <section className="action-panel" id="next">
            {a.kind === "sign_in" && (
              <>
                <h2>Sign in to join</h2>
                <p>Sign in with GitHub, then join the event and build with your team.</p>
                <a className="button arrow" href="/api/auth/github/start">Sign in with GitHub</a>
              </>
            )}
            {a.kind === "join" && (
              <form action={registerAction}>
                <h2>Join {event.name}</h2>
                <p className="muted">Joining registers you as a builder. Next you form or join a team.</p>
                {hidden("eventId", event.id)}{hidden("slug", slug)}
                <button type="submit" className="button arrow">Join event</button>
              </form>
            )}
            {a.kind === "team" && (
              <div className="split">
                <form action={createTeamAction} className="stack">
                  <h2>Create team</h2>
                  {hidden("eventId", event.id)}{hidden("slug", slug)}
                  <label>Team name<input name="name" required /></label>
                  <button type="submit">Create team</button>
                </form>
                <form action={joinTeamAction} className="stack">
                  <h2>Join team</h2>
                  {hidden("slug", slug)}
                  <label>Join code from a teammate<input name="code" required /></label>
                  <button type="submit" className="secondary">Join team</button>
                </form>
              </div>
            )}
            {a.kind === "register_build" && team && (
              <form action={registerRepoAction} className="stack">
                <h2>Register your build</h2>
                <p className="muted">
                  Register the team&apos;s public GitHub repository. Its current commit is recorded as the baseline, so work
                  that existed before registration is not counted as built during the event.
                </p>
                {hidden("teamId", team.id)}{hidden("slug", slug)}
                <label>Repository<input name="repo" placeholder="owner/name or github.com URL" required /></label>
                <button type="submit">Register build</button>
              </form>
            )}
            {a.kind === "submit_build" && team && (
              <form action={saveSubmissionAction} className="stack">
                <h2>Submit your build</h2>
                <p className="muted">Submit the product before {fmt(event.submissionDeadline)}. You can update it until then.</p>
                {hidden("teamId", team.id)}{hidden("slug", slug)}
                <label>Product name<input name="productName" required /></label>
                <label>What it does<textarea name="summary" required /></label>
                <label>Deployment URL (optional)<input name="demoUrl" type="url" placeholder="https://" /></label>
                <button type="submit">Submit build</button>
              </form>
            )}
            {a.kind === "contribute" && !a.href && build?.submission && (
              <form action={saveContributionAction} className="stack">
                <h2>Submit your contribution</h2>
                <p className="muted">
                  Proofs of Build are issued per person. Describe what <strong>you</strong> did on {build.submission.productName};
                  next you add evidence (commits, designs, documents, links) and send it for review.
                </p>
                {hidden("submissionId", build.submission.id)}{hidden("back", `/events/${slug}`)}
                <label>
                  Your role
                  <select name="category" defaultValue="engineering">
                    {CONTRIBUTION_CATEGORIES.map((c) => <option key={c} value={c}>{role(c)}</option>)}
                  </select>
                </label>
                <label>Title<input name="title" placeholder="e.g. Product / Growth" required /></label>
                <label>What you did<textarea name="description" required /></label>
                <button type="submit">Save and add evidence</button>
              </form>
            )}
            {(a.kind === "view_contribution" || a.kind === "view_proof" || (a.kind === "contribute" && a.href)) && (
              <>
                <h2>
                  {me?.stage === "under_review" && "Your contribution is under review"}
                  {me?.stage === "approved" && "Approved: your Proof of Build is being issued"}
                  {me?.stage === "proof_issued" && "Your Proof of Build is issued"}
                  {me?.stage === "rejected" && "Your contribution was not approved"}
                  {me?.stage === "revoked" && "Your Proof of Build was revoked"}
                  {(me?.stage === "draft" || me?.stage === "changes_requested") &&
                    (me.stage === "draft" ? "Finish your contribution" : "The issuer asked for changes")}
                </h2>
                <p>{mine?.title} · {mine && role(mine.category)}</p>
                <Link className="button arrow" href={a.kind === "contribute" ? a.href! : a.href}>{a.label}</Link>
              </>
            )}
            {a.kind === "closed" && (
              <>
                <h2>{a.label}</h2>
                <p>This event is past its submission deadline.</p>
              </>
            )}
          </section>
        </>
      )}

      {build && team && (
        <>
          <h2>Your build</h2>
          <div className="card">
            <div className="tile-top">
              <div>
                <div className="kicker">Team {team.name}</div>
                <h3 style={{ margin: "6px 0 0", fontSize: "1.5rem" }}>{build.submission?.productName ?? "Untitled build"}</h3>
              </div>
              <Status value={build.status} />
            </div>
            <div style={{ marginTop: 12 }}>
              {build.members.map((m) => (
                <div key={m.user.id} className="member-row">
                  <span className="avatar">{m.user.githubLogin[0]?.toUpperCase()}</span>
                  <span>
                    <strong>@{m.user.githubLogin}</strong>
                    <span className="muted"> · {m.contribution ? role(m.contribution.category) : "no contribution yet"}</span>
                  </span>
                  {m.stage && <Status value={m.stage} />}
                </div>
              ))}
            </div>
            <p className="muted" style={{ marginTop: 12 }}>
              Join code for teammates: <span className="mono">{team.joinCode}</span> · {build.members.length}/{event.maxTeamSize} builders
            </p>
            <div className="row">
              <Link className="button secondary" href={`/builds/${team.id}`}>View build</Link>
              {open && (!mine || mine.status === "draft" || mine.status === "changes_requested") && (
                <form action={leaveTeamAction}>
                  {hidden("teamId", team.id)}{hidden("slug", slug)}
                  <button className="secondary" type="submit" title="Your draft contribution, if any, is discarded">Leave team</button>
                </form>
              )}
            </div>
          </div>
          {build.submission && open && (
            <details className="card">
              <summary><strong>Update build submission</strong></summary>
              <form action={saveSubmissionAction} className="stack" style={{ marginTop: 12 }}>
                {hidden("teamId", team.id)}{hidden("slug", slug)}
                <label>Product name<input name="productName" defaultValue={build.submission.productName} required /></label>
                <label>What it does<textarea name="summary" defaultValue={build.submission.summary} required /></label>
                <label>Deployment URL (optional)<input name="demoUrl" type="url" defaultValue={build.submission.demoUrl ?? ""} /></label>
                <button type="submit">Update submission</button>
              </form>
            </details>
          )}
        </>
      )}

      {event.prizes.length > 0 && (
        <>
          <h2>Prizes</h2>
          <div className="grid">
            {event.prizes.map((p, i) => (
              <div key={i} className="tile">
                <div className="kicker">{p.title}</div>
                <h3>{p.reward || "—"}</h3>
              </div>
            ))}
          </div>
        </>
      )}

      {isStaff && (
        <>
          <h2>Builds ({allBuilds.length})</h2>
          <div className="card table-wrap">
            <table>
              <thead><tr><th>Build</th><th>Team</th><th>Status</th><th>Contributors</th></tr></thead>
              <tbody>
                {allBuilds.map((b) => (
                  <tr key={b.team.id}>
                    <td><Link href={`/builds/${b.team.id}`}>{b.submission?.productName ?? <span className="muted">not submitted</span>}</Link></td>
                    <td>{b.team.name}</td>
                    <td><Status value={b.status} /></td>
                    <td>
                      {b.members.map((m) => (
                        <div key={m.user.id} className="row" style={{ gap: 6 }}>
                          <span>@{m.user.githubLogin}</span>
                          {m.contribution ? (
                            <Link href={`/contributions/${m.contribution.id}`}>{role(m.contribution.category)}</Link>
                          ) : (
                            <span className="muted">no claim</span>
                          )}
                          {m.stage && <Status value={m.stage} />}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {roles.includes("organizer") && (
        <details className="card">
          <summary><strong>Edit event settings</strong></summary>
          <form action={updateEventAction} className="stack" style={{ marginTop: 12 }}>
            {hidden("eventId", event.id)}{hidden("slug", slug)}
            <EventFields event={event} />
            <button type="submit">Save changes</button>
          </form>
        </details>
      )}

      <h2>Organizers &amp; reviewers</h2>
      <p className="muted" style={{ maxWidth: 680 }}>
        The organizers review each contributor&apos;s evidence and decide whether to issue a Proof of Build. Solana
        records the credential; it does not judge the work.
      </p>
      <ul>{staff.map((s) => <li key={`${s.user.id}-${s.role}`}>@{s.user.githubLogin} <span className="muted">{s.role}</span></li>)}</ul>
      {roles.includes("organizer") && (
        <form action={addStaffAction} className="stack card">
          {hidden("eventId", event.id)}{hidden("slug", slug)}
          <label>GitHub login (must have signed in once)<input name="login" required /></label>
          <label>
            Role
            <select name="role" defaultValue="reviewer"><option value="reviewer">reviewer</option><option value="organizer">organizer</option></select>
          </label>
          <button type="submit">Add staff</button>
        </form>
      )}
    </>
  );
}
