ALTER TABLE "opportunities" ADD COLUMN "kind" text DEFAULT 'hackathon' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "demo" boolean DEFAULT false NOT NULL;