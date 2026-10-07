ALTER TABLE "events" ADD COLUMN "max_team_size" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "chain" text DEFAULT 'solana' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "prizes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "website_url" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proofs" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proofs" ADD COLUMN "revoked_by" text;--> statement-breakpoint
ALTER TABLE "proofs" ADD COLUMN "revoke_reason" text;--> statement-breakpoint
ALTER TABLE "proofs" ADD COLUMN "revoke_tx_signature" text;--> statement-breakpoint
ALTER TABLE "proofs" ADD CONSTRAINT "proofs_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;