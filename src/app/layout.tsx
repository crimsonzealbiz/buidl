import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { getSession } from "@/server/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "forge — proof of contribution for hackathon builders",
  description: "Reviewed, evidence-backed contribution proofs issued as Solana attestations.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="" />
        <link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600&display=swap" />
      </head>
      <body>
        <header className="nav">
          <Link className="brand" href="/">forge</Link>
          <nav>
            <Link href="/events">Events</Link>
            <Link href="/opportunities">Opportunities</Link>
            <Link href="/verify">Verify a proof</Link>
            {session && <Link href="/dashboard">Dashboard</Link>}
            {session && <Link href="/wallet">Wallet</Link>}
          </nav>
          {session ? (
            <form action="/api/auth/logout" method="post" className="row">
              <Link href={`/u/${session.user.githubLogin}`}>@{session.user.githubLogin}</Link>
              <button className="secondary" type="submit">Sign out</button>
            </form>
          ) : (
            <a className="button" href="/api/auth/github/start">Sign in with GitHub</a>
          )}
        </header>
        <main>{children}</main>
        <footer className="site">
          <div className="word">forge</div>
          <nav>
            <Link href="/events">Events</Link>
            <Link href="/opportunities">Opportunities</Link>
            <Link href="/verify">Verify a proof</Link>
            <span>Proofs issued on Solana</span>
          </nav>
        </footer>
      </body>
    </html>
  );
}
