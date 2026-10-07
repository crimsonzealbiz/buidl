import type { ReactNode } from "react";

export function Flash({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  return (
    <>
      {searchParams.ok && <div className="flash ok" role="status">{searchParams.ok}</div>}
      {searchParams.error && <div className="flash error" role="alert">{searchParams.error}</div>}
    </>
  );
}

const TONE: Record<string, "ok" | "warn" | "bad" | ""> = {
  approved: "ok",
  confirmed: "ok",
  github_author_verified: "ok",
  submitted: "warn",
  pending: "warn",
  sent: "warn",
  changes_requested: "warn",
  unverified: "",
  draft: "",
  rejected: "bad",
  failed: "bad",
  revoked: "bad",
  github_check_failed: "bad",
};

const LABEL: Record<string, string> = {
  github_author_verified: "GitHub author verified",
  github_check_failed: "GitHub check failed",
  unverified: "Reviewer judges",
  changes_requested: "Changes requested",
};

export function Status({ value }: { value: string }) {
  return <span className={`badge ${TONE[value] ?? ""}`}>{LABEL[value] ?? value.replace(/_/g, " ")}</span>;
}

export function Card({ children, title }: { children: ReactNode; title?: ReactNode }) {
  return (
    <section className="card">
      {title && <h3 style={{ marginTop: 0 }}>{title}</h3>}
      {children}
    </section>
  );
}

export function explorerUrl(kind: "address" | "tx", value: string, cluster: string, rpcUrl?: string) {
  const q = cluster === "devnet" ? "?cluster=devnet" : `?cluster=custom&customUrl=${encodeURIComponent(rpcUrl ?? "http://127.0.0.1:8899")}`;
  return `https://explorer.solana.com/${kind}/${value}${q}`;
}

export function fmt(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export type PageSearch = Promise<{ ok?: string; error?: string }>;
