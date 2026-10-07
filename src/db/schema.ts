import { sql } from "drizzle-orm";
import {
  boolean,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  bigint,
} from "drizzle-orm/pg-core";

const id = () => text("id").primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** A builder identity, anchored to a GitHub account. */
export const users = pgTable("users", {
  id: id(),
  githubId: bigint("github_id", { mode: "number" }).notNull().unique(),
  githubLogin: text("github_login").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: createdAt(),
});

/** Server-side sessions. Only a SHA-256 of the cookie token is stored. */
export const sessions = pgTable("sessions", {
  id: id(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** OAuth access token, kept server-side to call the GitHub API on the user's behalf. */
  githubAccessToken: text("github_access_token"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

/** One-time challenges a wallet must sign to be linked to a GitHub identity. */
export const walletChallenges = pgTable("wallet_challenges", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  address: text("address").notNull(),
  nonce: text("nonce").notNull().unique(),
  message: text("message").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/**
 * A wallet linked to a user. The signed message and signature are kept so the
 * link can be re-verified by anyone (they are included in exported evidence).
 */
export const wallets = pgTable(
  "wallets",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    message: text("message").notNull(),
    signature: text("signature").notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  // An address can be actively linked to at most one identity at a time.
  (t) => [uniqueIndex("wallets_address_active").on(t.address).where(sql`revoked_at is null`)],
);

export const events = pgTable("events", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  submissionDeadline: timestamp("submission_deadline", { withTimezone: true }).notNull(),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: createdAt(),
});

/** Per-event staff roles. Reviewers decide on individual contributions. */
export const eventStaff = pgTable(
  "event_staff",
  {
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["organizer", "reviewer"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.userId, t.role] })],
);

export const registrations = pgTable(
  "registrations",
  {
    id: id(),
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("registrations_event_user").on(t.eventId, t.userId)],
);

export const teams = pgTable("teams", {
  id: id(),
  eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  joinCode: text("join_code").notNull().unique(),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: createdAt(),
});

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.userId] }),
    // A builder belongs to at most one team per event.
    uniqueIndex("team_members_event_user").on(t.eventId, t.userId),
  ],
);

/**
 * A repository registered by a team, with the baseline commit captured from
 * GitHub at registration time. Work at or before the baseline is pre-existing.
 */
export const repositories = pgTable("repositories", {
  id: id(),
  teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  githubRepoId: bigint("github_repo_id", { mode: "number" }).notNull(),
  defaultBranch: text("default_branch").notNull(),
  repoCreatedAt: timestamp("repo_created_at", { withTimezone: true }).notNull(),
  /** null when the repository had no commits at registration. */
  baselineSha: text("baseline_sha"),
  baselineCommittedAt: timestamp("baseline_committed_at", { withTimezone: true }),
  baselineCapturedAt: timestamp("baseline_captured_at", { withTimezone: true }).notNull(),
  /** True when the baseline was captured after the event had already started. */
  capturedAfterStart: boolean("captured_after_start").notNull(),
  createdAt: createdAt(),
});

export const submissions = pgTable("submissions", {
  id: id(),
  teamId: text("team_id").notNull().unique().references(() => teams.id, { onDelete: "cascade" }),
  eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  productName: text("product_name").notNull(),
  summary: text("summary").notNull(),
  demoUrl: text("demo_url"),
  /** Head of the default branch captured from GitHub when the submission was made. */
  finalSha: text("final_sha"),
  submittedBy: text("submitted_by").notNull().references(() => users.id),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
});

export const CONTRIBUTION_CATEGORIES = [
  "engineering",
  "design",
  "product",
  "research",
  "content",
  "community",
  "business",
  "other",
] as const;
export type ContributionCategory = (typeof CONTRIBUTION_CATEGORIES)[number];

export const CONTRIBUTION_STATUSES = [
  "draft",
  "submitted",
  "changes_requested",
  "approved",
  "rejected",
] as const;
export type ContributionStatus = (typeof CONTRIBUTION_STATUSES)[number];

/** One builder's own claim about what they did on a submission. */
export const contributions = pgTable(
  "contributions",
  {
    id: id(),
    submissionId: text("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    category: text("category", { enum: CONTRIBUTION_CATEGORIES }).notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    status: text("status", { enum: CONTRIBUTION_STATUSES }).notNull().default("draft"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("contributions_submission_user").on(t.submissionId, t.userId)],
);

export const EVIDENCE_KINDS = [
  "commit",
  "pull_request",
  "design_file",
  "document",
  "video",
  "deployment",
  "link",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/**
 * A piece of evidence attached to a contribution. `verification` records what
 * the platform itself checked; everything else is judged by a human reviewer.
 */
export const evidence = pgTable("evidence", {
  id: id(),
  contributionId: text("contribution_id").notNull().references(() => contributions.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: EVIDENCE_KINDS }).notNull(),
  url: text("url").notNull(),
  description: text("description").notNull(),
  /** For commit evidence: the commit SHA. */
  ref: text("ref"),
  verification: text("verification", {
    enum: ["unverified", "github_author_verified", "github_check_failed"],
  })
    .notNull()
    .default("unverified"),
  verificationDetail: jsonb("verification_detail"),
  createdAt: createdAt(),
});

/** A teammate's corroboration of someone else's contribution claim. */
export const confirmations = pgTable(
  "confirmations",
  {
    contributionId: text("contribution_id").notNull().references(() => contributions.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    statement: text("statement").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.contributionId, t.userId] })],
);

export const reviews = pgTable("reviews", {
  id: id(),
  contributionId: text("contribution_id").notNull().references(() => contributions.id, { onDelete: "cascade" }),
  reviewerId: text("reviewer_id").notNull().references(() => users.id),
  decision: text("decision", { enum: ["approved", "rejected", "changes_requested"] }).notNull(),
  rationale: text("rationale").notNull(),
  /** Keys of stats the reviewer chose to put onchain (see src/lib/proof/stats.ts). */
  selectedStats: jsonb("selected_stats").$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
});

export const PROOF_STATUSES = ["pending", "sent", "confirmed", "failed"] as const;

/** A proof issued (or being issued) as a Solana Attestation Service attestation. */
export const proofs = pgTable("proofs", {
  id: id(),
  contributionId: text("contribution_id").notNull().unique().references(() => contributions.id),
  userId: text("user_id").notNull().references(() => users.id),
  reviewId: text("review_id").notNull().references(() => reviews.id),
  walletAddress: text("wallet_address").notNull(),
  cluster: text("cluster").notNull(),
  programAddress: text("program_address").notNull(),
  credentialAddress: text("credential_address").notNull(),
  schemaAddress: text("schema_address").notNull(),
  attestationAddress: text("attestation_address").notNull().unique(),
  nonce: text("nonce").notNull(),
  /** The values written onchain, exactly as serialized. */
  onchainData: jsonb("onchain_data").$type<Record<string, unknown>>().notNull(),
  bundle: jsonb("bundle").$type<Record<string, unknown>>().notNull(),
  bundleHash: text("bundle_hash").notNull(),
  status: text("status", { enum: PROOF_STATUSES }).notNull().default("pending"),
  txSignature: text("tx_signature"),
  error: text("error"),
  createdAt: createdAt(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
});

export type OpportunityCriteria = {
  /** Proofs must come from this event (when set). */
  eventId?: string | null;
  /** At least one qualifying proof must be in one of these categories (when non-empty). */
  categories?: string[];
  /** Minimum number of qualifying, independently verified proofs. */
  minProofs: number;
};

export const opportunities = pgTable("opportunities", {
  id: id(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  criteria: jsonb("criteria").$type<OpportunityCriteria>().notNull(),
  createdBy: text("created_by").notNull().references(() => users.id),
  closesAt: timestamp("closes_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const applications = pgTable(
  "applications",
  {
    id: id(),
    opportunityId: text("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    note: text("note").notNull().default(""),
    /** Attestation addresses that were verified onchain when the application was made. */
    verifiedAttestations: jsonb("verified_attestations").$type<string[]>().notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("applications_opportunity_user").on(t.opportunityId, t.userId)],
);

