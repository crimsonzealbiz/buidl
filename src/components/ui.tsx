import type { ReactNode } from "react";
import { STATUS_LABEL, type JourneyStep } from "@/lib/domain/lifecycle";

export function Flash({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  return (
    <>
      {searchParams.ok && <div className="flash ok" role="status">{searchParams.ok}</div>}
      {searchParams.error && <div className="flash error" role="alert">{searchParams.error}</div>}
    </>
  );
}

const TONE: Record<string, "ok" | "warn" | "bad" | "live" | "accent" | ""> = {
  approved: "ok",
  confirmed: "ok",
  github_author_verified: "ok",
  proof_issued: "ok",
  verified: "ok",
  eligible: "ok",
  live: "live",
  building: "accent",
  submitted: "warn",
  under_review: "warn",
  reviewing: "warn",
  pending: "warn",
  sent: "warn",
  changes_requested: "warn",
  upcoming: "",
  ended: "",
  unverified: "",
  draft: "",
  not_eligible: "",
  rejected: "bad",
  failed: "bad",
  revoked: "bad",
  github_check_failed: "bad",
};

const LABEL: Record<string, string> = {
  ...STATUS_LABEL,
  github_author_verified: "GitHub author verified",
  github_check_failed: "GitHub check failed",
  unverified: "Reviewer judges",
  eligible: "Eligible",
  not_eligible: "Not eligible",
  confirmed: "Confirmed",
};

export function Status({ value }: { value: string }) {
  const tone = TONE[value] ?? "";
  return (
    <span className={`badge ${tone}`}>
      {(tone === "ok" || tone === "live") && <span className="dot" aria-hidden />}
      {LABEL[value] ?? value.replace(/_/g, " ")}
    </span>
  );
}

export function Card({ children, title }: { children: ReactNode; title?: ReactNode }) {
  return (
    <section className="card">
      {title && <h3 style={{ marginTop: 0 }}>{title}</h3>}
      {children}
    </section>
  );
}

/** Label/value pairs laid out as a compact grid of facts. */
export function Facts({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="facts">
      {items.map(([k, v], i) => (
        <div key={i}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Stepper({ steps }: { steps: JourneyStep[] }) {
  return (
    <ol className="stepper">
      {steps.map((s, i) => (
        <li key={s.key} className={s.state}>
          <span className="n">{s.state === "done" ? "✓" : String(i + 1).padStart(2, "0")}</span>
          <span>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

export const ROLE_LABEL: Record<string, string> = {
  engineering: "Engineering",
  design: "Design",
  product: "Product",
  research: "Research",
  content: "Content",
  community: "Community",
  business: "Business",
  other: "Other",
};

export function role(category: string) {
  return ROLE_LABEL[category] ?? category;
}

export function shortAddr(a: string, n = 4) {
  return a.length > 2 * n + 1 ? `${a.slice(0, n)}…${a.slice(-n)}` : a;
}

export function explorerUrl(kind: "address" | "tx", value: string, cluster: string, rpcUrl?: string) {
  const q = cluster === "devnet" ? "?cluster=devnet" : `?cluster=custom&customUrl=${encodeURIComponent(rpcUrl ?? "http://127.0.0.1:8899")}`;
  return `https://explorer.solana.com/${kind}/${value}${q}`;
}

export function fmt(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export type PageSearch = Promise<{ ok?: string; error?: string }>;
