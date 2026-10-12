import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { getDb } from "@/db";
import { activeWallet } from "@/lib/wallet/link";
import { shortAddr } from "@/components/ui";
import { getSession } from "@/server/session";
import "./globals.css";
import "./lifecycle.css";

export const metadata: Metadata = {
  title: "FORGE — every build becomes part of your identity",
  description:
    "Builder identity network: verified hackathon contributions become portable Proofs of Build on Solana.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  const wallet = session ? await activeWallet(await getDb(), session.user.id) : null;
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="" />
        <link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600&display=swap" />
      </head>
      <body>
        <header className="nav">
          <Link className="brand" href="/">FORGE</Link>
          <nav aria-label="Main">
            <Link href="/discover">Discover</Link>
            {session && <Link href="/builds">My Builds</Link>}
            {session && <Link href={`/u/${session.user.githubLogin}`}>Profile</Link>}
            {session && <Link href="/dashboard">Dashboard</Link>}
          </nav>
          {session ? (
            <form action="/api/auth/logout" method="post" className="account">
              <Link className={`wallet-chip ${wallet ? "on" : ""}`} href="/wallet" title={wallet ? wallet.address : "Link a Solana wallet"}>
                {wallet ? shortAddr(wallet.address) : "Link wallet"}
              </Link>
              <Link className="who" href={`/u/${session.user.githubLogin}`}>@{session.user.githubLogin}</Link>
              <button className="secondary small" type="submit">Sign out</button>
            </form>
          ) : (
            <a className="button small" href="/api/auth/github/start">Sign in with GitHub</a>
          )}
        </header>
        <main>{children}</main>
        <footer className="site">
          <div>
            <div className="word">FORGE</div>
            <p className="muted" style={{ margin: "12px 0 0" }}>Every build becomes part of your identity.</p>
          </div>
          <nav aria-label="Footer">
            <Link href="/discover">Discover</Link>
            <Link href="/events">All events</Link>
            <Link href="/opportunities">Opportunities</Link>
            <Link href="/verify">Verify a proof</Link>
            <a href="/api/issuer">Issuer trust anchor</a>
          </nav>
        </footer>
      </body>
    </html>
  );
}
