import Link from "next/link";
import { Flash, type PageSearch } from "@/components/ui";
import { getSession } from "@/server/session";

const LOOP = [
  ["Build", "Join a hackathon, form a team and ship. Your repository and submission are recorded inside the build window."],
  ["Prove", "Claim your own contribution with evidence. The event's organizer reviews it and issues a Proof of Build on Solana."],
  ["Identity", "Every Proof of Build lands on your builder profile: verified builds, hackathons, collaborators, ecosystems."],
  ["Opportunity", "Hackathons, grants, bounties and teams check your verified builds, and open up when you qualify."],
] as const;

export default async function Home({ searchParams }: { searchParams: PageSearch }) {
  const sp = await searchParams;
  const session = await getSession();
  return (
    <>
      <Flash searchParams={sp} />
      <section className="hero">
        <div className="eyebrow">Builder identity network on Solana</div>
        <h1>Every build becomes part of your <mark>identity</mark>.</h1>
        <p className="lead">
          FORGE turns verified hackathon contributions into portable Proofs of Build. Ship with your team, show what
          you did, and carry it to your next opportunity.
        </p>
        <div className="row">
          <Link className="button arrow" href="/discover">Discover events</Link>
          {session ? (
            <Link className="button secondary" href={`/u/${session.user.githubLogin}`}>Your profile</Link>
          ) : (
            <a className="button secondary" href="/api/auth/github/start">Sign in with GitHub</a>
          )}
        </div>
      </section>

      <div className="section-head">
        <h2>Build. Prove. Identity. Opportunity.</h2>
        <p className="muted" style={{ maxWidth: 380, margin: 0 }}>
          One loop: each verified build makes the next opportunity easier to reach.
        </p>
      </div>
      <div className="loop">
        {LOOP.map(([title, text], i) => (
          <div key={title}>
            <span className="num">{String(i + 1).padStart(2, "0")}</span>
            <h3>{title}</h3>
            <p>{text}</p>
          </div>
        ))}
      </div>

      <div className="stats">
        <div><strong>Per person</strong><span>Each contributor is reviewed on their own evidence. No automatic team awards.</span></div>
        <div><strong>Reviewed</strong><span>An authorized issuer approves every Proof of Build.</span></div>
        <div><strong>Portable</strong><span>Issued on Solana, so anyone can check it without trusting FORGE.</span></div>
      </div>

      <p className="trust-note" style={{ marginTop: 32 }}>
        How trust works: GitHub sign-in proves you control an account, and commits are evidence. The event organizer
        judges whether the evidence supports your contribution. Solana stores the credential they issue so anyone can
        verify it later.
      </p>

      <div className="cta">
        <h2>Show what you shipped, not just where you were.</h2>
        <Link className="button arrow" href="/discover">Find your next build</Link>
      </div>
    </>
  );
}
