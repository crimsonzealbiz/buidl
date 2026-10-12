import Link from "next/link";
import type { Eligibility, Opportunity } from "@/lib/domain/opportunities";
import { Status } from "./ui";

const KIND_LABEL: Record<string, string> = { hackathon: "Hackathon", grant: "Grant", bounty: "Bounty", team: "Team" };

/** An opportunity with its requirements, and eligibility when it was checked. */
export function OpportunityTile({
  opp,
  elig,
  eventName,
  query = "",
}: {
  opp: Opportunity;
  elig?: Eligibility;
  eventName?: string;
  query?: string;
}) {
  const c = opp.criteria;
  const reqs = elig?.requirements ?? [
    { label: `${c.minProofs}+ verified build${c.minProofs === 1 ? "" : "s"}`, met: false },
    ...(eventName ? [{ label: `Built at ${eventName}`, met: false }] : []),
    ...(c.categories?.length ? [{ label: `${c.categories.join(" or ")} contribution`, met: false }] : []),
    ...(c.ecosystems?.length ? [{ label: `${c.ecosystems.join(" or ")} experience`, met: false }] : []),
  ];
  return (
    <Link href={`/opportunities/${opp.id}${query}`} className="tile">
      <div className="tile-top">
        <span className="kicker">{KIND_LABEL[opp.kind] ?? opp.kind}</span>
        {elig && <Status value={elig.eligible ? "eligible" : "not_eligible"} />}
      </div>
      <h3>{opp.title}</h3>
      <div className="meta">Requirements</div>
      <ul className="reqs">
        {reqs.map((r) => <li key={r.label} className={elig && r.met ? "met" : ""}>{r.label}</li>)}
      </ul>
    </Link>
  );
}
