import Link from "next/link";
import { notFound } from "next/navigation";
import { AppError } from "@/lib/errors";
import { hasStaffRole } from "@/lib/domain/events";
import { buildView } from "@/lib/domain/builds";
import { Facts, Status, fmt, role, type PageSearch } from "@/components/ui";
import { Flash } from "@/components/ui";
import { getSession, makeCtx } from "@/server/session";

type Props = { params: Promise<{ teamId: string }>; searchParams: PageSearch };

export default async function BuildPage({ params, searchParams }: Props) {
  const { teamId } = await params;
  const sp = await searchParams;
  const session = await getSession();
  const { db } = await makeCtx(session);
  const b = await buildView(db, teamId).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const user = session?.user;
  const onTeam = !!user && b.members.some((m) => m.user.id === user.id);
  const isStaff =
    !!user && ((await hasStaffRole(db, b.event.id, user.id, "organizer")) || (await hasStaffRole(db, b.event.id, user.id, "reviewer")));
  // Review progress is visible to the team and the issuer; the public sees issued proofs.
  const insider = onTeam || isStaff;
  const s = b.submission;
  const inWindow = s ? s.submittedAt >= b.event.startsAt && s.submittedAt <= b.event.submissionDeadline : null;

  return (
    <>
      <Flash searchParams={sp} />
      <div className="page-head">
        <div>
          <div className="kicker">
            <Link href={`/events/${b.event.slug}`}>{b.event.name}</Link> · Team {b.team.name}
          </div>
          <h1>{s?.productName ?? "Untitled build"}</h1>
        </div>
        <Status value={b.status} />
      </div>
      {s && <p className="lead-sm" style={{ whiteSpace: "pre-wrap" }}>{s.summary}</p>}

      <Facts
        items={[
          ["Event", <Link key="e" href={`/events/${b.event.slug}`}>{b.event.name}</Link>],
          [
            "Repository",
            b.repo ? (
              <a key="r" href={`https://github.com/${b.repo.owner}/${b.repo.name}`} rel="noreferrer noopener">
                github.com/{b.repo.owner}/{b.repo.name}
              </a>
            ) : (
              "Not registered yet"
            ),
          ],
          ["Deployment", s?.demoUrl ? <a key="d" href={s.demoUrl} rel="noreferrer noopener">{s.demoUrl.replace(/^https:\/\//, "")}</a> : "—"],
          ["Submitted", s ? fmt(s.submittedAt) : "Not yet"],
          ["Deadline", fmt(b.event.submissionDeadline)],
          ["Builders", String(b.members.length)],
        ]}
      />

      <h2>Team</h2>
      <p className="muted" style={{ maxWidth: 700 }}>
        Each builder claims their own contribution. A Proof of Build is issued per person after the organizer reviews
        that person&apos;s evidence; being on the team is not enough.
      </p>
      <div className="card">
        {b.members.map((m) => {
          const c = m.contribution;
          const canOpen = c && (insider || m.stage === "proof_issued");
          return (
            <div key={m.user.id} className="member-row">
              <span className="avatar">{m.user.githubLogin[0]?.toUpperCase()}</span>
              <span>
                <Link href={`/u/${m.user.githubLogin}`}><strong>{m.user.name ?? m.user.githubLogin}</strong></Link>
                <span className="muted"> @{m.user.githubLogin}</span>
                <div className="muted">
                  {c ? <>{role(c.category)} · {canOpen ? <Link href={`/contributions/${c.id}`}>{c.title}</Link> : c.title}</> : "No contribution claimed yet"}
                  {c && insider && <> · {m.evidenceCount} evidence item{m.evidenceCount === 1 ? "" : "s"}</>}
                </div>
              </span>
              <span className="row">
                {m.stage === "proof_issued" && m.proof ? (
                  <Link href={`/proofs/${m.proof.id}`}><Status value="verified" /></Link>
                ) : (
                  insider && m.stage && <Status value={m.stage} />
                )}
              </span>
            </div>
          );
        })}
      </div>

      <h2>Build evidence</h2>
      <div className="card table-wrap">
        <table>
          <tbody>
            <tr>
              <td>Repository baseline</td>
              <td>
                {b.repo ? (
                  <>
                    {b.repo.baselineSha ? <span className="mono">{b.repo.baselineSha.slice(0, 12)}</span> : "empty repository"} recorded{" "}
                    {fmt(b.repo.baselineCapturedAt)}
                    {b.repo.capturedAfterStart && <span className="muted"> (after the build window opened)</span>}
                    <div className="muted">Commits at or before the baseline count as pre-existing work.</div>
                  </>
                ) : (
                  "—"
                )}
              </td>
            </tr>
            <tr>
              <td>Submitted commit</td>
              <td>{s?.finalSha ? <span className="mono">{s.finalSha.slice(0, 12)}</span> : "—"}</td>
            </tr>
            <tr>
              <td>Submitted within the build window</td>
              <td>{inWindow === null ? "—" : inWindow ? <Status value="approved" /> : <Status value="rejected" />}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="trust-note">
        GitHub data is evidence for the organizer&apos;s review: signing in proves control of a GitHub account, and commit
        checks show authorship in this repository. Neither proves on its own that the work was meaningful; the organizer
        decides that, and Solana records the credential they issue.
      </p>
    </>
  );
}
