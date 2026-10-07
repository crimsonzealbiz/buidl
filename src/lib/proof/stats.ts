/**
 * Stats a reviewer may choose to publish onchain with a proof. Every stat is
 * derived from reviewed evidence; none is a raw activity count (commits,
 * followers, ratings), because those do not establish meaningful contribution.
 */
export type StatInputs = {
  evidenceKinds: string[];
  authorVerifiedEvidence: number;
  teammateConfirmations: number;
  teamSize: number;
  demoUrl: string | null;
};

type StatDef = { label: string; description: string; compute: (i: StatInputs) => string | null };

export const STAT_CATALOG = {
  evidence_items: {
    label: "Evidence items reviewed",
    description: "Number of evidence items the reviewer assessed for this contribution.",
    compute: (i) => String(i.evidenceKinds.length),
  },
  evidence_kinds: {
    label: "Kinds of evidence",
    description: "Distinct evidence types, e.g. design_file, document, commit.",
    compute: (i) => (i.evidenceKinds.length ? [...new Set(i.evidenceKinds)].sort().join(",") : null),
  },
  github_authorship_verified: {
    label: "GitHub authorship verified",
    description: "Whether at least one commit or pull request was verified as authored by this builder.",
    compute: (i) => (i.authorVerifiedEvidence > 0 ? "true" : "false"),
  },
  teammate_confirmations: {
    label: "Teammate confirmations",
    description: "Number of teammates who corroborated this contribution.",
    compute: (i) => String(i.teammateConfirmations),
  },
  team_size: {
    label: "Team size",
    description: "Members on the team at submission.",
    compute: (i) => String(i.teamSize),
  },
  demo_shipped: {
    label: "Demo shipped",
    description: "Whether the team submitted a public demo URL.",
    compute: (i) => (i.demoUrl ? "true" : "false"),
  },
} satisfies Record<string, StatDef>;

export type StatKey = keyof typeof STAT_CATALOG;
export const STAT_KEYS = Object.keys(STAT_CATALOG) as StatKey[];

export function isStatKey(k: string): k is StatKey {
  return k in STAT_CATALOG;
}

/** Computes "key=value" entries for the selected stats, in catalog order. */
export function computeStats(selected: string[], inputs: StatInputs): string[] {
  return STAT_KEYS.filter((k) => selected.includes(k)).flatMap((k) => {
    const v = (STAT_CATALOG[k] as StatDef).compute(inputs);
    return v === null ? [] : [`${k}=${v}`];
  });
}
