import Link from "next/link";
import { notFound } from "next/navigation";
import { CONTRIBUTION_CATEGORIES } from "@/db/schema";
import { getEventBySlug, isRegistered, listStaff, staffRoles } from "@/lib/domain/events";
import { listMembers, teamForUser, teamRepository } from "@/lib/domain/teams";
import { listContributions, submissionForTeam } from "@/lib/domain/submissions";
import { Flash, Status, fmt, type PageSearch } from "@/components/ui";
import { getSession, makeCtx } from "@/server/session";
import {
  addStaffAction,
  createTeamAction,
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
  const user = session?.user ?? null;
  const roles = user ? await staffRoles(db, event.id, user.id) : [];
  const registered = user ? await isRegistered(db, event.id, user.id) : false;
  const team = user ? await teamForUser(db, event.id, user.id) : null;
  const members = team ? await listMembers(db, team.id) : [];
  const repo = team ? await teamRepository(db, team.id) : null;
  const submission = team ? await submissionForTeam(db, team.id) : null;
  const contribs = submission ? await listContributions(db, submission.id) : [];
  const mine = contribs.find((c) => c.user.id === user?.id)?.contribution;
  const staff = await listStaff(db, event.id);
  const open = new Date() < event.submissionDeadline;
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;

  return (
    <>
      <Flash searchParams={sp} />
      <h1>{event.name}</h1>
      <p className="muted">
        {fmt(event.startsAt)} → {fmt(event.endsAt)} · submissions close {fmt(event.submissionDeadline)}
        {roles.length > 0 && <> · you are {roles.join(" & ")}</>}
      </p>
      {event.description && <p style={{ whiteSpace: "pre-wrap" }}>{event.description}</p>}
      {roles.includes("reviewer") && <p><Link className="button" href={`/events/${slug}/review`}>Open review queue</Link></p>}

      {!user && <div className="flash warn">Sign in with GitHub to register.</div>}
      {user && !registered && (
        <form action={registerAction}>
          {hidden("eventId", event.id)}{hidden("slug", slug)}
          <button type="submit" disabled={!open}>Register for this event</button>
        </form>
      )}

      {user && registered && !team && (
        <div className="grid">
          <form action={createTeamAction} className="stack card">
            <h3 style={{ margin: 0 }}>Start a team</h3>
            {hidden("eventId", event.id)}{hidden("slug", slug)}
            <label>Team name<input name="name" required /></label>
            <button type="submit">Create team</button>
          </form>
          <form action={joinTeamAction} className="stack card">
            <h3 style={{ margin: 0 }}>Join a team</h3>
            {hidden("slug", slug)}
            <label>Join code<input name="code" required /></label>
            <button type="submit">Join</button>
          </form>
        </div>
      )}

      {team && (
        <>
          <h2>Team: {team.name}</h2>
          <div className="card">
            <div>Join code for teammates: <span className="mono">{team.joinCode}</span></div>
            <div className="muted">Members: {members.map((m) => `@${m.user.githubLogin}`).join(", ")}</div>
          </div>

          <h3>Repository</h3>
          {repo ? (
            <div className="card">
              <a href={`https://github.com/${repo.owner}/${repo.name}`}>{repo.owner}/{repo.name}</a>
              <div className="muted">
                Baseline {repo.baselineSha ? <span className="mono">{repo.baselineSha.slice(0, 12)}</span> : "(empty repository)"} captured{" "}
                {fmt(repo.baselineCapturedAt)}
                {repo.capturedAfterStart && " (after the event started)"}. Commits at or before the baseline count as pre-existing work.
              </div>
            </div>
          ) : (
            <form action={registerRepoAction} className="stack card">
              {hidden("teamId", team.id)}{hidden("slug", slug)}
              <label>Public GitHub repository<input name="repo" placeholder="owner/name" required /></label>
              <button type="submit" disabled={!open}>Register repository and record baseline</button>
            </form>
          )}

          <h3>Product submission</h3>
          {repo && (
            <form action={saveSubmissionAction} className="stack card">
              {hidden("teamId", team.id)}{hidden("slug", slug)}
              <label>Product name<input name="productName" defaultValue={submission?.productName} required /></label>
              <label>Summary<textarea name="summary" defaultValue={submission?.summary} required /></label>
              <label>Demo URL (optional)<input name="demoUrl" type="url" defaultValue={submission?.demoUrl ?? ""} /></label>
              {submission && (
                <div className="muted">
                  Last saved {fmt(submission.submittedAt)}; final commit{" "}
                  <span className="mono">{submission.finalSha?.slice(0, 12) ?? "none"}</span>
                </div>
              )}
              <button type="submit" disabled={!open}>{submission ? "Update submission" : "Submit product"}</button>
            </form>
          )}
          {!repo && <p className="muted">Register the repository first.</p>}

          {submission && (
            <>
              <h3>Individual contributions</h3>
              <p className="muted">
                Each member writes their own claim with evidence. Proofs are issued per approved contribution, never
                to the whole team automatically.
              </p>
              <div className="card table-wrap">
                <table>
                  <tbody>
                    {members.map((m) => {
                      const c = contribs.find((x) => x.user.id === m.user.id)?.contribution;
                      return (
                        <tr key={m.user.id}>
                          <td>@{m.user.githubLogin}</td>
                          <td>{c ? <Link href={`/contributions/${c.id}`}>{c.title}</Link> : <span className="muted">no claim yet</span>}</td>
                          <td>{c?.category}</td>
                          <td>{c && <Status value={c.status} />}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {(!mine || mine.status === "draft" || mine.status === "changes_requested") && (
                <form action={saveContributionAction} className="stack card">
                  <h3 style={{ margin: 0 }}>{mine ? "Edit your contribution" : "Describe your contribution"}</h3>
                  {hidden("submissionId", submission.id)}{hidden("back", `/events/${slug}`)}
                  <label>
                    Category
                    <select name="category" defaultValue={mine?.category ?? "engineering"}>
                      {CONTRIBUTION_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  <label>Title<input name="title" defaultValue={mine?.title} required /></label>
                  <label>What you did<textarea name="description" defaultValue={mine?.description} required /></label>
                  <button type="submit">Save and add evidence</button>
                </form>
              )}
            </>
          )}
        </>
      )}

      <h2>Staff</h2>
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
