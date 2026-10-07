import Link from "next/link";
import { notFound } from "next/navigation";
import { hasStaffRole } from "@/lib/domain/events";
import { isPlatformAdmin } from "@/lib/domain/context";
import { and, eq } from "drizzle-orm";
import { applications } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { checkEligibility, getOpportunity, listApplications, type Eligibility } from "@/lib/domain/opportunities";
import { loadTrustAnchor, readLedger } from "@/lib/proof/runtime";
import { Flash, fmt, type PageSearch } from "@/components/ui";
import { getSession, makeCtx } from "@/server/session";
import { applyAction } from "../actions";

type Props = { params: Promise<{ id: string }>; searchParams: PageSearch };

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
  const applied = session
    ? await ctx.db.query.applications.findFirst({
        where: and(eq(applications.opportunityId, id), eq(applications.userId, session.user.id)),
      })
    : null;
  let elig: Eligibility | null = null;
  let eligError: string | null = null;
  if (session && !applied) {
    const trust = await loadTrustAnchor();
    if (!trust) eligError = "No issuer authority configured; eligibility cannot be checked.";
    else {
      try {
        elig = await checkEligibility(ctx, readLedger(), trust, session.user, opp);
      } catch (e) {
        eligError = `Could not verify proofs onchain: ${(e as Error).message}`;
      }
    }
  }
  const apps = isOwner ? await listApplications(ctx.db, id) : [];
  return (
    <>
      <Flash searchParams={sp} />
      <h1>{opp.title}</h1>
      <p style={{ whiteSpace: "pre-wrap" }}>{opp.description}</p>
      {!session && <div className="flash warn">Sign in to check your eligibility.</div>}
      {applied && <div className="flash ok">You applied {fmt(applied.createdAt)} with {applied.verifiedAttestations.length} verified proof(s).</div>}
      {eligError && <div className="flash error">{eligError}</div>}
      {elig && (
        <div className="card">
          <div className={`flash ${elig.eligible ? "ok" : "warn"}`}>
            {elig.eligible ? "You are eligible." : elig.reasons.join("; ")}
          </div>
          {elig.qualifying.length > 0 && (
            <ul>{elig.qualifying.map((q) => <li key={q.attestation}><span className="mono">{q.attestation}</span> ({q.event}, {q.category})</li>)}</ul>
          )}
          {elig.unverified.length > 0 && (
            <p className="muted">Proofs that failed onchain verification: {elig.unverified.map((u) => `${u.attestation} (${u.reason})`).join(", ")}</p>
          )}
          {elig.eligible && (
            <form action={applyAction} className="stack">
              <input type="hidden" name="opportunityId" value={opp.id} />
              <label>Note to organizers<textarea name="note" /></label>
              <button type="submit">Apply</button>
            </form>
          )}
        </div>
      )}
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
