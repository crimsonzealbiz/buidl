import Link from "next/link";
import { notFound } from "next/navigation";
import { getEventBySlug } from "@/lib/domain/events";
import { isTeamMember, listTeams } from "@/lib/domain/teams";
import { buildView } from "@/lib/domain/builds";
import { listConfirmations, listEvidence } from "@/lib/domain/submissions";
import { canReview } from "@/lib/domain/reviews";
import { activeWallet } from "@/lib/wallet/link";
import { STAT_CATALOG, STAT_KEYS } from "@/lib/proof/stats";
import { Facts, Flash, Status, fmt, role, type PageSearch } from "@/components/ui";
import { makeCtx, requireSession } from "@/server/session";
import { issueProofAction, reviewAction } from "../../actions";

type Props = { params: Promise<{ slug: string }>; searchParams: PageSearch };

export default async function ReviewPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const session = await requireSession();
  const ctx = await makeCtx(session);
  const event = await getEventBySlug(ctx.db, slug);
  if (!event) notFound();
  if (!(await canReview(ctx.db, event.id, session.user.id))) {
    return <div className="flash error">Only this event&apos;s organizers and reviewers can review contributions.</div>;
  }
  const builds = [];
  for (const t of await listTeams(ctx.db, event.id)) {
    // Conflict of interest: you never review your own team.
    if (await isTeamMember(ctx.db, t.id, session.user.id)) continue;
    const b = await buildView(ctx.db, t.id);
    if (!b.submission) continue;
    const contributors = await Promise.all(
      b.members
        .filter((m) => m.contribution && m.stage !== "draft")
        .map(async (m) => ({
          ...m,
          evidence: await listEvidence(ctx.db, m.contribution!.id),
          confirmations: await listConfirmations(ctx.db, m.contribution!.id),
          wallet: await activeWallet(ctx.db, m.user.id),
        })),
    );
    builds.push({ ...b, contributors });
  }
  const pending = builds.flatMap((b) => b.contributors).filter((c) => c.stage === "under_review").length;
  const ready = builds.flatMap((b) => b.contributors).filter((c) => c.stage === "approved").length;
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;

  return (
    <>
      <Flash searchParams={sp} />
      <div className="page-head">
        <div>
          <div className="kicker"><Link href={`/events/${slug}`}>{event.name}</Link> · Issuer review</div>
          <h1>Review contributions</h1>
          <p className="lead-sm">
            Judge each contributor on their own evidence. Builds from teams you belong to are excluded.
          </p>
        </div>
      </div>
      <Facts
        items={[
          ["Awaiting review", String(pending)],
          ["Approved, ready to issue", String(ready)],
          ["Build window", `${fmt(event.startsAt)} → ${fmt(event.submissionDeadline)}`],
        ]}
      />
      <p className="trust-note">
        Approval means the issuer attests that the submitted evidence supports this contributor&apos;s participation in
        this build. Only approved contributions can be issued as a Proof of Build on Solana. Commit counts and
        popularity are not evidence of meaningful work.
      </p>
      {builds.length === 0 && <div className="empty">No submitted builds yet.</div>}

      {builds.map((b) => (
        <section key={b.team.id} style={{ marginTop: 40 }}>
          <div className="page-head" style={{ marginBottom: 12 }}>
            <div>
              <div className="kicker">Build · Team {b.team.name}</div>
              <h2 style={{ margin: "4px 0 0" }}><Link href={`/builds/${b.team.id}`}>{b.submission!.productName}</Link></h2>
            </div>
            <Status value={b.status} />
          </div>
          <Facts
            items={[
              ["Team", b.members.map((m) => `@${m.user.githubLogin}`).join(", ")],
              [
                "Repository",
                b.repo ? <a key="r" href={`https://github.com/${b.repo.owner}/${b.repo.name}`}>{b.repo.owner}/{b.repo.name}</a> : "—",
              ],
              ["Baseline → submitted", `${b.repo?.baselineSha?.slice(0, 8) ?? "empty"} → ${b.submission!.finalSha?.slice(0, 8) ?? "—"}`],
              ["Build submitted", fmt(b.submission!.submittedAt)],
            ]}
          />
          {b.contributors.length === 0 && <p className="muted">No contributor has submitted a claim yet.</p>}
          {b.contributors.map((m) => {
            const c = m.contribution!;
            return (
              <article key={c.id} className="card" style={{ padding: 24 }}>
                <div className="tile-top">
                  <div>
                    <div className="kicker">{role(c.category)}</div>
                    <h3 style={{ margin: "6px 0 2px", fontSize: "1.35rem" }}>
                      {m.user.name ?? m.user.githubLogin} <span className="muted" style={{ fontWeight: 400 }}>· {c.title}</span>
                    </h3>
                  </div>
                  <Status value={m.stage!} />
                </div>
                <Facts
                  items={[
                    [
                      "GitHub account",
                      m.user.demo ? (
                        <span key="g">@{m.user.githubLogin} <span className="signal demo">Demo identity</span></span>
                      ) : (
                        <a key="g" href={`https://github.com/${m.user.githubLogin}`}>@{m.user.githubLogin}</a>
                      ),
                    ],
                    ["Wallet", m.wallet ? <span key="w" className="mono">{m.wallet.address.slice(0, 10)}…</span> : "Not linked"],
                    ["Joined team", fmt(m.joinedAt)],
                    ["Claim submitted", fmt(c.submittedAt)],
                  ]}
                />
                <p style={{ whiteSpace: "pre-wrap" }}>{c.description}</p>
                <h4 className="kicker" style={{ marginTop: 16 }}>Evidence</h4>
                <ul>
                  {m.evidence.map((e) => (
                    <li key={e.id} style={{ marginBottom: 6 }}>
                      <Status value={e.verification} /> {e.kind.replace("_", " ")}:{" "}
                      <a href={e.url} target="_blank" rel="noreferrer noopener">{e.url}</a> — {e.description}
                      {e.verification === "github_check_failed" && (
                        <span className="muted"> ({String((e.verificationDetail as { reason?: string })?.reason ?? "")})</span>
                      )}
                    </li>
                  ))}
                </ul>
                {m.confirmations.length > 0 && (
                  <>
                    <h4 className="kicker">Teammate input</h4>
                    <ul>
                      {m.confirmations.map((x) => (
                        <li key={x.user.id}>
                          <span className={`badge ${x.stance === "dispute" ? "bad" : "ok"}`}>{x.stance === "dispute" ? "disputes" : "confirms"}</span>{" "}
                          @{x.user.githubLogin}: {x.statement}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <div className="row" style={{ marginTop: 8 }}>
                  <Link href={`/contributions/${c.id}`}>Open contribution</Link>
                </div>

                {m.stage === "under_review" && (
                  <form action={reviewAction} className="stack" style={{ marginTop: 16, maxWidth: "none" }}>
                    {hidden("contributionId", c.id)}{hidden("slug", slug)}
                    <label>
                      Decision
                      <select name="decision" defaultValue="approved">
                        <option value="approved">Approve</option>
                        <option value="changes_requested">Request changes</option>
                        <option value="rejected">Reject</option>
                      </select>
                    </label>
                    <label>Rationale (recorded in the evidence bundle)<textarea name="rationale" required minLength={20} /></label>
                    <details>
                      <summary className="muted">Stats to publish onchain with the proof (approval only)</summary>
                      {STAT_KEYS.map((k) => (
                        <label key={k} className="check">
                          <input type="checkbox" name="stats" value={k} />
                          <span><strong>{STAT_CATALOG[k].label}</strong> <span className="muted">{STAT_CATALOG[k].description}</span></span>
                        </label>
                      ))}
                    </details>
                    <button type="submit">Record decision</button>
                  </form>
                )}
                {m.stage === "approved" && (
                  <form action={issueProofAction} className="row" style={{ marginTop: 16 }}>
                    {hidden("contributionId", c.id)}{hidden("back", `/events/${slug}/review`)}
                    <button type="submit" className="button arrow" disabled={!m.wallet}>Issue Proof of Build</button>
                    <span className="muted">
                      {m.wallet ? "Writes the attestation on Solana and verifies it before marking it issued." : "The contributor must link a wallet first."}
                    </span>
                  </form>
                )}
                {m.stage === "proof_issued" && m.proof && (
                  <div className="row" style={{ marginTop: 16 }}>
                    <Link className="button secondary" href={`/proofs/${m.proof.id}`}>View Proof of Build</Link>
                  </div>
                )}
                {m.proof?.status === "failed" && m.proof.error && <pre>{m.proof.error}</pre>}
              </article>
            );
          })}
        </section>
      ))}
    </>
  );
}
