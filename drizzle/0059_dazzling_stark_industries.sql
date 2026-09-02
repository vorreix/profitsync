CREATE TABLE "budget_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_id" uuid NOT NULL,
	"envelope_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"planned_amount" numeric(20, 2) DEFAULT '0' NOT NULL,
	"authored_amount" numeric(20, 2) DEFAULT '0' NOT NULL,
	"authored_cadence" text DEFAULT 'period' NOT NULL,
	"rollover_in" numeric(20, 2) DEFAULT '0' NOT NULL,
	"source" text DEFAULT 'copy' NOT NULL,
	"contribution_status" text,
	"contribution_confirmed_at" timestamp,
	"contribution_confirmed_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"updated_by" text,
	CONSTRAINT "budget_allocations_contribution_check" CHECK (contribution_status is null or contribution_status in ('planned','confirmed','missed','skipped'))
);
--> statement-breakpoint
CREATE TABLE "budget_commitments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"envelope_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"due_date" date,
	"recurring_rule_id" uuid,
	"first_due_date" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"needs_attention" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "budget_commitments_kind_check" CHECK (kind in ('one_time','recurring')),
	CONSTRAINT "budget_commitments_status_check" CHECK (status in ('active','paused','completed','cancelled')),
	CONSTRAINT "budget_commitments_discriminant_check" CHECK ((kind = 'one_time' and due_date is not null and recurring_rule_id is null) or (kind = 'recurring' and recurring_rule_id is not null)),
	CONSTRAINT "budget_commitments_attention_check" CHECK (needs_attention = false or kind = 'recurring')
);
--> statement-breakpoint
CREATE TABLE "budget_envelopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"section" text NOT NULL,
	"name" text NOT NULL,
	"target_amount" numeric(20, 2) DEFAULT '0' NOT NULL,
	"target_cadence" text DEFAULT 'period' NOT NULL,
	"match_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_catch_all" boolean DEFAULT false NOT NULL,
	"funding_mode" text,
	"wealth_account_id" uuid,
	"auto_fund" boolean DEFAULT false NOT NULL,
	"goal_amount" numeric(20, 2),
	"target_date" date,
	"carry_policy" text DEFAULT 'none' NOT NULL,
	"carry_cap" numeric(20, 2),
	"priority" text DEFAULT 'important' NOT NULL,
	"reimbursable" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "budget_envelopes_section_check" CHECK (section in ('income','commitment','flexible','savings','debt')),
	CONSTRAINT "budget_envelopes_target_cadence_check" CHECK (target_cadence in ('period','month','week','day')),
	CONSTRAINT "budget_envelopes_carry_check" CHECK (carry_policy in ('none','surplus','deficit','both')),
	CONSTRAINT "budget_envelopes_priority_check" CHECK (priority in ('essential','important','optional')),
	CONSTRAINT "budget_envelopes_status_check" CHECK (status in ('active','paused','removed')),
	CONSTRAINT "budget_envelopes_funding_mode_check" CHECK (funding_mode is null or funding_mode in ('virtual','space_backed')),
	CONSTRAINT "budget_envelopes_funding_section_check" CHECK (funding_mode is null or section = 'savings'),
	CONSTRAINT "budget_envelopes_auto_fund_section_check" CHECK (auto_fund = false or section = 'savings'),
	CONSTRAINT "budget_envelopes_space_backed_check" CHECK (funding_mode <> 'space_backed' or wealth_account_id is not null)
);
--> statement-breakpoint
CREATE TABLE "budget_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_id" uuid,
	"period_id" uuid,
	"envelope_id" uuid,
	"related_envelope_id" uuid,
	"action" text NOT NULL,
	"amount" numeric(20, 2),
	"previous_amount" numeric(20, 2),
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_exclusions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"excluded_by" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "budget_fund_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"envelope_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"period_id" uuid,
	"kind" text NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"source" text NOT NULL,
	"transaction_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"actor_user_id" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "budget_fund_entries_kind_check" CHECK (kind in ('contribution','withdrawal','adjustment')),
	CONSTRAINT "budget_fund_entries_source_check" CHECK (source in ('confirmed','auto_fund','manual','conversion')),
	CONSTRAINT "budget_fund_entries_positive_check" CHECK (kind = 'adjustment' or amount > 0)
);
--> statement-breakpoint
CREATE TABLE "budget_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commitment_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"due_date" date NOT NULL,
	"status" text NOT NULL,
	"rescheduled_to" date,
	"settled_transaction_id" uuid,
	"settled_amount" numeric(20, 2),
	"settled_at" timestamp,
	"actor_user_id" text,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "budget_occurrences_status_check" CHECK (status in ('settled','cancelled','skipped','rescheduled')),
	CONSTRAINT "budget_occurrences_reschedule_check" CHECK ((status = 'rescheduled') = (rescheduled_to is not null)),
	CONSTRAINT "budget_occurrences_reschedule_moves_check" CHECK (rescheduled_to is null or rescheduled_to <> due_date)
);
--> statement-breakpoint
CREATE TABLE "budget_period_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"supersedes_id" uuid,
	"restated_reason" text,
	"restated_by" text,
	"drift" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"caused_by_transaction_id" uuid,
	"currency" text NOT NULL,
	"payload" jsonb NOT NULL,
	"engine_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "budget_period_snapshots_reason_check" CHECK (restated_reason is null or restated_reason in ('transaction_edited','transaction_deleted','transaction_restored','backdated_transaction','settlement_received','manual'))
);
--> statement-breakpoint
CREATE TABLE "budget_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"start" date NOT NULL,
	"end_exclusive" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"funding_base" numeric(20, 2) DEFAULT '0' NOT NULL,
	"funding_base_source" text DEFAULT 'expected_income' NOT NULL,
	"funding_base_anchor_date" date NOT NULL,
	"funding_base_as_of" timestamp,
	"funding_base_computed_at" timestamp DEFAULT now(),
	"is_partial" boolean DEFAULT false NOT NULL,
	"closed_at" timestamp,
	"closed_by" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "budget_periods_range_check" CHECK (end_exclusive > start),
	CONSTRAINT "budget_periods_status_check" CHECK (status in ('open','closed')),
	CONSTRAINT "budget_periods_source_check" CHECK (funding_base_source in ('expected_income','reconstructed_at_boundary','snapshot_at_open')),
	CONSTRAINT "budget_periods_as_of_check" CHECK ((funding_base_source = 'snapshot_at_open') = (funding_base_as_of is not null))
);
--> statement-breakpoint
CREATE TABLE "budget_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"cadence" text DEFAULT 'monthly' NOT NULL,
	"anchor_day" integer,
	"week_start_day" integer DEFAULT 1 NOT NULL,
	"custom_days" integer,
	"custom_start" date,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"income_mode" text DEFAULT 'expected' NOT NULL,
	"expected_income" numeric(20, 2),
	"included_account_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"excluded_category_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"currency" text NOT NULL,
	"next_period_seed" text DEFAULT 'copy' NOT NULL,
	"paused_at" timestamp,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "budget_plans_cadence_check" CHECK (cadence in ('monthly','weekly','payday','custom')),
	CONSTRAINT "budget_plans_status_check" CHECK (status in ('active','paused','archived')),
	CONSTRAINT "budget_plans_income_mode_check" CHECK (income_mode in ('expected','available')),
	CONSTRAINT "budget_plans_seed_check" CHECK (next_period_seed in ('copy','fresh','suggest')),
	CONSTRAINT "budget_plans_anchor_check" CHECK (anchor_day is null or (anchor_day between 1 and 31)),
	CONSTRAINT "budget_plans_custom_days_check" CHECK (custom_days is null or (custom_days between 1 and 400)),
	CONSTRAINT "budget_plans_week_start_check" CHECK (week_start_day between 1 and 7)
);
--> statement-breakpoint
ALTER TABLE "budget_allocations" ADD CONSTRAINT "budget_allocations_period_id_budget_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."budget_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_allocations" ADD CONSTRAINT "budget_allocations_envelope_id_budget_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."budget_envelopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_allocations" ADD CONSTRAINT "budget_allocations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_commitments" ADD CONSTRAINT "budget_commitments_plan_id_budget_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."budget_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_commitments" ADD CONSTRAINT "budget_commitments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_commitments" ADD CONSTRAINT "budget_commitments_envelope_id_budget_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."budget_envelopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_envelopes" ADD CONSTRAINT "budget_envelopes_plan_id_budget_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."budget_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_envelopes" ADD CONSTRAINT "budget_envelopes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_envelopes" ADD CONSTRAINT "budget_envelopes_wealth_account_id_wealth_accounts_id_fk" FOREIGN KEY ("wealth_account_id") REFERENCES "public"."wealth_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_events" ADD CONSTRAINT "budget_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_exclusions" ADD CONSTRAINT "budget_exclusions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_exclusions" ADD CONSTRAINT "budget_exclusions_plan_id_budget_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."budget_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_exclusions" ADD CONSTRAINT "budget_exclusions_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_fund_entries" ADD CONSTRAINT "budget_fund_entries_envelope_id_budget_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."budget_envelopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_fund_entries" ADD CONSTRAINT "budget_fund_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_fund_entries" ADD CONSTRAINT "budget_fund_entries_period_id_budget_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."budget_periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_occurrences" ADD CONSTRAINT "budget_occurrences_commitment_id_budget_commitments_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "public"."budget_commitments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_occurrences" ADD CONSTRAINT "budget_occurrences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_period_snapshots" ADD CONSTRAINT "budget_period_snapshots_period_id_budget_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."budget_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_period_snapshots" ADD CONSTRAINT "budget_period_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_periods" ADD CONSTRAINT "budget_periods_plan_id_budget_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."budget_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_periods" ADD CONSTRAINT "budget_periods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_plans" ADD CONSTRAINT "budget_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_allocations_period_envelope_unique" ON "budget_allocations" USING btree ("period_id","envelope_id");--> statement-breakpoint
CREATE INDEX "budget_allocations_org_period_idx" ON "budget_allocations" USING btree ("organization_id","period_id");--> statement-breakpoint
CREATE INDEX "budget_allocations_awaiting_idx" ON "budget_allocations" USING btree ("organization_id") WHERE contribution_status = 'planned';--> statement-breakpoint
CREATE INDEX "budget_commitments_envelope_idx" ON "budget_commitments" USING btree ("organization_id","envelope_id","status");--> statement-breakpoint
CREATE INDEX "budget_commitments_due_idx" ON "budget_commitments" USING btree ("plan_id","due_date");--> statement-breakpoint
CREATE INDEX "budget_commitments_plan_kind_idx" ON "budget_commitments" USING btree ("plan_id","status","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_commitments_rule_unique" ON "budget_commitments" USING btree ("plan_id","recurring_rule_id") WHERE recurring_rule_id is not null;--> statement-breakpoint
CREATE INDEX "budget_envelopes_plan_idx" ON "budget_envelopes" USING btree ("plan_id","section","status");--> statement-breakpoint
CREATE INDEX "budget_envelopes_org_idx" ON "budget_envelopes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "budget_envelopes_match_keys_idx" ON "budget_envelopes" USING gin ("match_keys");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_envelopes_plan_name_unique" ON "budget_envelopes" USING btree ("plan_id",lower("name")) WHERE status <> 'removed';--> statement-breakpoint
CREATE UNIQUE INDEX "budget_envelopes_catch_all_unique" ON "budget_envelopes" USING btree ("plan_id") WHERE is_catch_all and status = 'active';--> statement-breakpoint
CREATE INDEX "budget_events_envelope_idx" ON "budget_events" USING btree ("organization_id","envelope_id","created_at");--> statement-breakpoint
CREATE INDEX "budget_events_period_idx" ON "budget_events" USING btree ("organization_id","period_id","created_at");--> statement-breakpoint
CREATE INDEX "budget_events_funding_idx" ON "budget_events" USING btree ("period_id") WHERE action = 'funding_adjusted';--> statement-breakpoint
CREATE UNIQUE INDEX "budget_exclusions_plan_tx_unique" ON "budget_exclusions" USING btree ("plan_id","transaction_id");--> statement-breakpoint
CREATE INDEX "budget_exclusions_org_idx" ON "budget_exclusions" USING btree ("organization_id","plan_id");--> statement-breakpoint
CREATE INDEX "budget_fund_entries_ledger_idx" ON "budget_fund_entries" USING btree ("organization_id","envelope_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_fund_entries_once_per_period_idx" ON "budget_fund_entries" USING btree ("envelope_id","period_id") WHERE source in ('confirmed','auto_fund');--> statement-breakpoint
CREATE UNIQUE INDEX "budget_occurrences_commitment_due_unique" ON "budget_occurrences" USING btree ("commitment_id","due_date");--> statement-breakpoint
CREATE INDEX "budget_occurrences_org_due_idx" ON "budget_occurrences" USING btree ("organization_id","due_date");--> statement-breakpoint
CREATE INDEX "budget_occurrences_settled_tx_idx" ON "budget_occurrences" USING btree ("settled_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_period_snapshots_version_unique" ON "budget_period_snapshots" USING btree ("period_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_period_snapshots_current_unique" ON "budget_period_snapshots" USING btree ("period_id") WHERE is_current;--> statement-breakpoint
CREATE INDEX "budget_period_snapshots_org_idx" ON "budget_period_snapshots" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_periods_plan_start_unique" ON "budget_periods" USING btree ("plan_id","start");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_periods_one_open_idx" ON "budget_periods" USING btree ("plan_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "budget_periods_lookup_idx" ON "budget_periods" USING btree ("plan_id","status","start");--> statement-breakpoint
CREATE INDEX "budget_plans_org_idx" ON "budget_plans" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_plans_one_live_idx" ON "budget_plans" USING btree ("organization_id") WHERE status <> 'archived';