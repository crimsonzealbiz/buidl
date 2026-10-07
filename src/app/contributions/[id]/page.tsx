import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { EVIDENCE_KINDS, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { getEvent, hasStaffRole } from "@/lib/domain/events";
import { getTeam, isTeamMember } from "@/lib/domain/teams";
import { getContribution, getSubmission, listConfirmations, listEvidence, suggestCommits, type CommitSuggestion } from "@/lib/domain/submissions";
import { reviewHistory } from "@/lib/domain/reviews";
import { proofForContribution } from "@/lib/proof/service";
import { activeWallet } from "@/lib/wallet/link";
import { Flash, Status, fmt, type PageSearch } from "@/components/ui";
import { getSession, makeCtx } from "@/server/session";
import {
  addEvidenceAction,
  confirmAction,
  issueProofAction,
  removeEvidenceAction,
  submitContributionAction,
} from "../../events/actions";

type Props = { params: Promise<{ id: string }>; searchParams: PageSearch };

export default async function ContributionPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await getSession();
  const { db } = await makeCtx(session);
  const c = await getContribution(db, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const submission = await getSubmission(db, c.submissionId);
  const team = await getTeam(db, submission.teamId);
  const event = await getEvent(db, submission.eventId);
  const owner = (await db.query.users.findFirst({ where: eq(users.id, c.userId) }))!;
  const evidence = await listEvidence(db, c.id);
  const confirmations = await listConfirmations(db, c.id);
  const reviews = await reviewHistory(db, c.id);
  const proof = await proofForContribution(db, c.id);
  const user = session?.user;
  const isOwner = user?.id === c.userId;
  const isTeammate = !!user && !isOwner && (await isTeamMember(db, team.id, user.id));
  const isStaff =
    !!user &&
    ((await hasStaffRole(db, event.id, user.id, "reviewer")) || (await hasStaffRole(db, event.id, user.id, "organizer")));
  const canSee = isOwner || isTeammate || isStaff || c.status === "approved";
  if (!canSee) notFound();
  const editable = isOwner && (c.status === "draft" || c.status === "changes_requested");
  const ownerWallet = await activeWallet(db, c.userId);
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;
  let suggestions: CommitSuggestion[] | null = null;
  let suggestionsError: string | null = null;
  if (editable && user) {
    try {
      suggestions = await suggestCommits(await makeCtx(session), user, c.id);
    } catch (e) {
      suggestionsError = (e as Error).message;
    }
  }

  return (
    <>
      <Flash searchParams={sp} />
      <p className="muted"><Link href={`/events/${event.slug}`}>{event.name}</Link> · {submission.productName} · team {team.name}</p>
      <h1>{c.title}</h1>
      <p>
        <Status value={c.status} /> <span className="muted">by @{owner.githubLogin} · {c.category}</span>
      </p>
      <p style={{ whiteSpace: "pre-wrap" }}>{c.description}</p>

      <h2>Evidence</h2>
      {evidence.length === 0 && <p className="muted">No evidence yet.</p>}
      {evidence.map((e) => (
        <div key={e.id} className="card">
          <div className="row">
            <strong>{e.kind.replace("_", " ")}</strong>
            <Status value={e.verification} />
            <a href={e.url} rel="noreferrer noopener" target="_blank">{e.url}</a>
          </div>
          <div>{e.description}</div>
          {e.verification === "github_check_failed" && (
            <div className="muted">{String((e.verificationDetail as { reason?: string })?.reason ?? "")}</div>
          )}
          {editable && (
            <form action={removeEvidenceAction}>
              {hidden("contributionId", c.id)}{hidden("evidenceId", e.id)}
              <button className="secondary" type="submit">Remove</button>
            </form>
          )}
        </div>
      ))}
      {editable && (
        <>
          {suggestions && suggestions.length > 0 && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Your commits since the baseline</h3>
              <p className="muted">Pick the ones that show your work. Each is verified against GitHub when added.</p>
              {suggestions.map((sg) => (
                <form key={sg.sha} action={addEvidenceAction} className="row" style={{ marginBottom: 6 }}>
                  {hidden("contributionId", c.id)}{hidden("kind", "commit")}{hidden("url", sg.url)}
                  <span className="mono">{sg.sha.slice(0, 7)}</span>
                  <input name="description" defaultValue={sg.message.length >= 10 ? sg.message : `Commit ${sg.sha.slice(0, 7)}: ${sg.message}`} style={{ flex: 1, minWidth: 180 }} />
                  <button type="submit" className="secondary" disabled={sg.alreadyAdded}>{sg.alreadyAdded ? "Added" : "Add"}</button>
                </form>
              ))}
            </div>
          )}
          {suggestionsError && <p className="muted">Couldn&apos;t load your commits from GitHub: {suggestionsError}</p>}
          <form action={addEvidenceAction} className="stack card">
            <h3 style={{ margin: 0 }}>Add evidence</h3>
            {hidden("contributionId", c.id)}
            <label>
              Kind
              <select name="kind" defaultValue="link">
                {EVIDENCE_KINDS.map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}
              </select>
            </label>
            <label>URL<input name="url" type="url" required placeholder="https://" /></label>
            <label>What this shows<textarea name="description" required /></label>
            <p className="muted">
              Commit and pull request evidence is checked against GitHub: it must be in your team repository,
              attributed to your GitHub account, and newer than the registration baseline. Design files, documents,
              videos and deployments are judged by the reviewer.
            </p>
            <button type="submit">Add evidence</button>
          </form>
          <form action={submitContributionAction}>
            {hidden("contributionId", c.id)}
            <button type="submit" disabled={evidence.length === 0}>Submit for review</button>
          </form>
        </>
      )}

      <h2>Teammate input</h2>
      {confirmations.length === 0 && <p className="muted">None.</p>}
      {confirmations.map((x) => (
        <div key={x.user.id} className="card">
          <span className={`badge ${x.stance === "dispute" ? "bad" : "ok"}`}>{x.stance === "dispute" ? "disputes" : "confirms"}</span>{" "}
          <strong>@{x.user.githubLogin}</strong>: {x.statement}
        </div>
      ))}
      {isTeammate && (c.status === "draft" || c.status === "submitted" || c.status === "changes_requested") && (
        <form action={confirmAction} className="stack card">
          {hidden("contributionId", c.id)}
          <p className="muted" style={{ margin: 0 }}>
            Does this claim match what @{owner.githubLogin} actually did? Reviewers see your answer.
          </p>
          <label className="check"><input type="radio" name="stance" value="confirm" defaultChecked /> Confirm: this is accurate</label>
          <label className="check"><input type="radio" name="stance" value="dispute" /> Dispute: this overstates or misattributes the work</label>
          <label>Your statement<textarea name="statement" required minLength={10} /></label>
          <button type="submit">Submit</button>
        </form>
      )}

      <h2>Review</h2>
      {reviews.length === 0 && <p className="muted">Not reviewed yet.</p>}
      {reviews.map(({ review: r, reviewer }) => (
        <div key={r.id} className="card">
          <Status value={r.decision} /> <span className="muted">by @{reviewer.githubLogin}, {fmt(r.createdAt)}</span>
          <p style={{ whiteSpace: "pre-wrap" }}>{r.rationale}</p>
          {r.selectedStats.length > 0 && <div className="muted">Stats to publish: {r.selectedStats.join(", ")}</div>}
        </div>
      ))}

      {c.status === "approved" && (
        <>
          <h2>Onchain proof</h2>
          {proof ? (
            <div className="card">
              <Status value={proof.status} /> <Link className="mono" href={`/proofs/${proof.id}`}>{proof.attestationAddress}</Link>
              {proof.error && <pre>{proof.error}</pre>}
            </div>
          ) : (
            <p className="muted">Not issued yet.</p>
          )}
          {(isOwner || isStaff) && proof?.status !== "confirmed" && proof?.status !== "revoked" && (
            <form action={issueProofAction} className="card">
              {hidden("contributionId", c.id)}
              {ownerWallet ? (
                <p>Issues a Solana Attestation Service proof on devnet to <span className="mono">{ownerWallet.address}</span>.</p>
              ) : (
                <p className="flash warn">@{owner.githubLogin} must link a wallet before the proof can be issued.</p>
              )}
              <button type="submit" disabled={!ownerWallet}>{proof ? "Retry issuance" : "Issue proof"}</button>
            </form>
          )}
        </>
      )}
    </>
  );
}
