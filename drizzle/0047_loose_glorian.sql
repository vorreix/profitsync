CREATE TABLE "push_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"outcome" text NOT NULL,
	"subscriptions" integer DEFAULT 0 NOT NULL,
	"ok" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"pruned" integer DEFAULT 0 NOT NULL,
	"errors" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "push_events_created_idx" ON "push_events" USING btree ("created_at");