CREATE TABLE "budget_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid,
	"amount" numeric(20, 2) DEFAULT '0' NOT NULL,
	"period" text NOT NULL,
	"action" text NOT NULL,
	"changed_by" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "budget_history" ADD CONSTRAINT "budget_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_history" ADD CONSTRAINT "budget_history_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_history_lookup_idx" ON "budget_history" USING btree ("organization_id","client_id","created_at");--> statement-breakpoint
-- Backfill: seed one "set" snapshot per existing budget so timelines aren't empty
-- on launch (uses each budget's current amount/period + original creator/timestamp).
INSERT INTO "budget_history" ("organization_id", "client_id", "amount", "period", "action", "changed_by", "created_at")
SELECT "organization_id", "client_id", "amount", "period", 'set', COALESCE("created_by", "updated_by"), COALESCE("created_at", now())
FROM "budgets";