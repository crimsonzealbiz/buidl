import Link from "next/link";
import { notFound } from "next/navigation";
import { getEventBySlug, hasStaffRole } from "@/lib/domain/events";
import { listMembers, teamRepository } from "@/lib/domain/teams";
import { listConfirmations, listEvidence } from "@/lib/domain/submissions";
import { reviewQueue } from "@/lib/domain/reviews";
import { STAT_CATALOG, STAT_KEYS } from "@/lib/proof/stats";
import { Flash, Status, type PageSearch } from "@/components/ui";
import { makeCtx, requireSession } from "@/server/session";
import { reviewAction } from "../../actions";

type Props = { params: Promise<{ slug: string }>; searchParams: PageSearch };

export default async function ReviewPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const session = await requireSession();
  const ctx = await makeCtx(session);
  const event = await getEventBySlug(ctx.db, slug);
  if (!event) notFound();
  if (!(await hasStaffRole(ctx.db, event.id, session.user.id, "reviewer"))) {
    return <div className="flash error">You are not a reviewer for this event.</div>;
  }
  const queue = await reviewQueue(ctx, session.user, event.id);
  const items = await Promise.all(
    queue.map(async (q) => ({
      ...q,
      evidence: await listEvidence(ctx.db, q.contribution.id),
      confirmations: await listConfirmations(ctx.db, q.contribution.id),
      repo: await teamRepository(ctx.db, q.team.id),
      teamSize: (await listMembers(ctx.db, q.team.id)).length,
    })),
  );

  return (
    <>
      <Flash searchParams={sp} />
      <p className="muted"><Link href={`/events/${slug}`}>{event.name}</Link></p>
      <h1>Review queue</h1>
      <p className="muted" style={{ maxWidth: 700 }}>
        Judge each person&apos;s contribution on its evidence. Commit counts, follower counts and popularity are not
        evidence of meaningful work. Contributions from teams you belong to are excluded. Stats you select are
        published onchain with the proof.
      </p>
      {items.length === 0 && <p className="muted">Nothing awaiting review.</p>}
      {items.map(({ contribution: c, submission: s, team, user, evidence, confirmations, repo, teamSize }) => (
        <section key={c.id} className="card">
          <div className="muted">{s.productName} · team {team.name} ({teamSize}) · @{user.githubLogin}</div>
          <h3 style={{ marginTop: 4 }}>{c.title} <span className="badge">{c.category}</span></h3>
          <p style={{ whiteSpace: "pre-wrap" }}>{c.description}</p>
          {repo && (
            <div className="muted">
              Repo <a href={`https://github.com/${repo.owner}/${repo.name}`}>{repo.owner}/{repo.name}</a>, baseline{" "}
              <span className="mono">{repo.baselineSha?.slice(0, 10) ?? "empty"}</span>
              {repo.capturedAfterStart && " (captured after start)"}, final <span className="mono">{s.finalSha?.slice(0, 10) ?? "—"}</span>
            </div>
          )}
          <h3>Evidence</h3>
          <ul>
            {evidence.map((e) => (
              <li key={e.id}>
                <Status value={e.verification} /> {e.kind.replace("_", " ")}:{" "}
                <a href={e.url} target="_blank" rel="noreferrer noopener">{e.url}</a> — {e.description}
                {e.verification === "github_check_failed" && (
                  <span className="muted"> ({String((e.verificationDetail as { reason?: string })?.reason ?? "")})</span>
                )}
              </li>
            ))}
          </ul>
          {confirmations.length > 0 && (
            <>
              <h3>Teammate confirmations</h3>
              <ul>{confirmations.map((x) => <li key={x.user.id}>@{x.user.githubLogin}: {x.statement}</li>)}</ul>
            </>
          )}
          <form action={reviewAction} className="stack">
            <input type="hidden" name="contributionId" value={c.id} />
            <input type="hidden" name="slug" value={slug} />
            <label>
              Decision
              <select name="decision" defaultValue="approved">
                <option value="approved">Approve: issue a proof</option>
                <option value="changes_requested">Request changes</option>
                <option value="rejected">Reject</option>
              </select>
            </label>
            <label>Rationale (recorded in the proof bundle)<textarea name="rationale" required minLength={20} /></label>
            <fieldset className="card">
              <legend>Stats to publish onchain (approval only)</legend>
              {STAT_KEYS.map((k) => (
                <label key={k} className="check">
                  <input type="checkbox" name="stats" value={k} />
                  <span><strong>{STAT_CATALOG[k].label}</strong> <span className="muted">{STAT_CATALOG[k].description}</span></span>
                </label>
              ))}
            </fieldset>
            <button type="submit">Record decision</button>
          </form>
        </section>
      ))}
    </>
  );
}
