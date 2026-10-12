import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { applications, users } from "@/db/schema";
import { getEvent, hasStaffRole } from "@/lib/domain/events";
import { isPlatformAdmin } from "@/lib/domain/context";
import { AppError } from "@/lib/errors";
import { getOpportunity, listApplications, type Eligibility } from "@/lib/domain/opportunities";
import { Flash, Status, fmt, type PageSearch } from "@/components/ui";
import { eligibilityFor } from "@/server/eligibility";
import { getSession, makeCtx } from "@/server/session";
import { applyAction } from "../actions";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Awaited<PageSearch> & { builder?: string }> };

const KIND_LABEL: Record<string, string> = { hackathon: "Hackathon", grant: "Grant", bounty: "Bounty", team: "Team" };

export default async function OpportunityPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await getSession();
  const ctx = await makeCtx(session);
  const opp = await getOpportunity(ctx.db, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const isOwner =
    !!session &&
    (session.user.id === opp.createdBy ||
      isPlatformAdmin(session.user) ||
      (!!opp.criteria.eventId && (await hasStaffRole(ctx.db, opp.criteria.eventId, session.user.id, "organizer"))));
  // Anyone can check any builder: proofs are public. Default to the signed-in builder.
  const builderLogin = sp.builder?.trim();
  const builder = builderLogin
    ? await ctx.db.query.users.findFirst({
        where: sql`lower(${users.githubLogin}) = ${builderLogin.toLowerCase()}`,
        orderBy: [asc(users.demo)],
      })
    : session?.user;
  const isSelf = !!builder && builder.id === session?.user.id;
  const applied =
    isSelf && session
      ? await ctx.db.query.applications.findFirst({
          where: and(eq(applications.opportunityId, id), eq(applications.userId, session.user.id)),
        })
      : null;
  const { results, error } = builder ? await eligibilityFor(ctx, builder, [opp]) : { results: new Map<string, Eligibility>(), error: null };
  const elig = results.get(opp.id);
  const event = opp.criteria.eventId ? await getEvent(ctx.db, opp.criteria.eventId).catch(() => null) : null;
  const apps = isOwner ? await listApplications(ctx.db, id) : [];

  return (
    <>
      <Flash searchParams={sp} />
      <div className="page-head">
        <div>
          <div className="kicker"><Link href="/discover#opportunities">Opportunities</Link> · {KIND_LABEL[opp.kind] ?? opp.kind}</div>
          <h1>{opp.title}</h1>
        </div>
        {elig && <Status value={elig.eligible ? "eligible" : "not_eligible"} />}
      </div>
      <p className="lead-sm" style={{ whiteSpace: "pre-wrap" }}>{opp.description}</p>
      {event && <p className="muted">Proofs must come from <Link href={`/events/${event.slug}`}>{event.name}</Link>.</p>}

      <section className="action-panel">
        <div className="kicker">
          {builder ? <>Eligibility for <Link href={`/u/${builder.githubLogin}`}>@{builder.githubLogin}</Link></> : "Requirements"}
        </div>
        {elig ? (
          <>
            <h2 style={{ marginTop: 8 }}>{elig.eligible ? "Eligible ✓" : "Not eligible yet"}</h2>
            <ul className="reqs">
              {elig.requirements.map((r) => <li key={r.label} className={r.met ? "met" : ""}>{r.label}</li>)}
            </ul>
            <p className="muted" style={{ marginTop: 12 }}>
              Decided from {elig.qualifying.length} qualifying Proof{elig.qualifying.length === 1 ? "" : "s"} of Build, re-verified on Solana just now.
            </p>
            {elig.qualifying.length > 0 && (
              <ul>
                {elig.qualifying.map((q) => (
                  <li key={q.attestation}><Link className="mono" href={`/verify/${q.attestation}`}>{q.attestation.slice(0, 10)}…</Link> <span className="muted">({q.event}, {q.category})</span></li>
                ))}
              </ul>
            )}
            {elig.unverified.length > 0 && (
              <p className="muted">Proofs that failed onchain verification: {elig.unverified.map((u) => `${u.attestation.slice(0, 10)}… (${u.reason})`).join(", ")}</p>
            )}
          </>
        ) : (
          !error && <p className="muted">{builderLogin ? `No builder named @${builderLogin}.` : "Sign in to check your eligibility."}</p>
        )}
        {error && <div className="flash warn">{error}</div>}
        {applied && <div className="flash ok">You applied {fmt(applied.createdAt)} with {applied.verifiedAttestations.length} verified proof(s).</div>}
        {isSelf && elig?.eligible && !applied && (
          <form action={applyAction} className="stack" style={{ marginTop: 16 }}>
            <input type="hidden" name="opportunityId" value={opp.id} />
            <label>Note to organizers<textarea name="note" /></label>
            <button type="submit">Apply</button>
          </form>
        )}
        <form method="get" className="row" style={{ marginTop: 16 }}>
          <input name="builder" placeholder="Check another builder by GitHub login" defaultValue={isSelf ? "" : builderLogin} style={{ flex: 1, minWidth: 200 }} />
          <button type="submit" className="secondary">Check</button>
        </form>
      </section>

      {isOwner && (
        <>
          <h2>Applications ({apps.length})</h2>
          {apps.length === 0 && <p className="muted">No applications yet.</p>}
          {apps.map(({ application: a, user: applicant }) => (
            <div key={a.id} className="card">
              <strong><Link href={`/u/${applicant.githubLogin}`}>@{applicant.githubLogin}</Link></strong>{" "}
              <span className="muted">applied {fmt(a.createdAt)} · eligibility verified onchain {fmt(a.verifiedAt)}</span>
              {a.note && <p style={{ whiteSpace: "pre-wrap" }}>{a.note}</p>}
              <div>
                Proofs:{" "}
                {a.verifiedAttestations.map((att) => (
                  <Link key={att} className="mono" href={`/verify/${att}`} style={{ marginRight: 8 }}>{att.slice(0, 8)}…</Link>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}
