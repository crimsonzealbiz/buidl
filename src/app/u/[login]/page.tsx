import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { users } from "@/db/schema";
import { proofsForUser } from "@/lib/proof/service";
import { activeWallet } from "@/lib/wallet/link";
import type { ProofBundle } from "@/lib/proof/bundle";
import { fmt } from "@/components/ui";
import { getSession, makeCtx } from "@/server/session";

export default async function Profile({ params }: { params: Promise<{ login: string }> }) {
  const { login } = await params;
  const { db } = await makeCtx(await getSession());
  const user = await db.query.users.findFirst({ where: sql`lower(${users.githubLogin}) = ${login.toLowerCase()}` });
  if (!user) notFound();
  const wallet = await activeWallet(db, user.id);
  const proofs = (await proofsForUser(db, user.id)).filter((p) => p.status === "confirmed");
  return (
    <>
      <h1>@{user.githubLogin}</h1>
      <p className="muted">
        <a href={`https://github.com/${user.githubLogin}`}>GitHub</a>
        {wallet && <> · wallet <span className="mono">{wallet.address}</span></>}
      </p>
      <h2>Verified contributions ({proofs.length})</h2>
      {proofs.length === 0 && <p className="muted">No proofs yet.</p>}
      {proofs.map((p) => {
        const b = p.bundle as unknown as ProofBundle;
        return (
          <div key={p.id} className="card">
            <strong><Link href={`/proofs/${p.id}`}>{b.contribution.title}</Link></strong>{" "}
            <span className="badge">{b.contribution.category}</span>
            <div className="muted">{b.submission.productName} · {b.event.name} · approved {fmt(b.review.decidedAt)}</div>
            <Link href={`/verify/${p.attestationAddress}`}>Verify onchain</Link>
          </div>
        );
      })}
    </>
  );
}
