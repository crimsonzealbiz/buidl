import Link from "next/link";
import { buildsForUser } from "@/lib/domain/builds";
import { Flash, Status, fmtDate, role, type PageSearch } from "@/components/ui";
import { makeCtx, requireSession } from "@/server/session";

export default async function MyBuilds({ searchParams }: { searchParams: PageSearch }) {
  const sp = await searchParams;
  const session = await requireSession();
  const { db } = await makeCtx(session);
  const builds = await buildsForUser(db, session.user.id);

  return (
    <>
      <Flash searchParams={sp} />
      <div className="page-head">
        <div>
          <div className="kicker">My Builds</div>
          <h1>What you&apos;re building.</h1>
          <p className="lead-sm">Every build you join, from first commit to Proof of Build.</p>
        </div>
        <Link className="button secondary" href="/discover">Find an event</Link>
      </div>
      {builds.length === 0 && (
        <div className="empty">
          No builds yet. <Link href="/discover">Join an event</Link> and form a team to start one.
        </div>
      )}
      <div className="grid">
        {builds.map((b) => {
          const me = b.members.find((m) => m.user.id === session.user.id);
          const next =
            me?.stage === "proof_issued" && me.proof
              ? { href: `/proofs/${me.proof.id}`, label: "View Proof of Build" }
              : me?.contribution
                ? { href: `/contributions/${me.contribution.id}`, label: me.stage === "draft" || me.stage === "changes_requested" ? "Finish contribution" : "View contribution" }
                : { href: `/events/${b.event.slug}#next`, label: "Continue" };
          return (
            <div key={b.team.id} className="tile">
              <div className="tile-top">
                <span className="kicker">{b.event.name}</span>
                <Status value={b.status} />
              </div>
              <h3><Link href={`/builds/${b.team.id}`}>{b.submission?.productName ?? "Untitled build"}</Link></h3>
              <div className="meta">Team {b.team.name} · {b.members.length} builders · deadline {fmtDate(b.event.submissionDeadline)}</div>
              <div className="row" style={{ marginTop: 14, justifyContent: "space-between" }}>
                <span>
                  {me?.contribution ? <>{role(me.contribution.category)} </> : <span className="muted">No contribution yet </span>}
                  {me?.stage && <Status value={me.stage} />}
                </span>
                <Link className="button small arrow" href={next.href}>{next.label}</Link>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
