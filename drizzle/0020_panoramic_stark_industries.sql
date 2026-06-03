CREATE TABLE "payout_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"method" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "referral_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "referral_codes_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "referral_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "referral_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"reward_type" text DEFAULT 'percent' NOT NULL,
	"reward_percent" numeric(5, 2) DEFAULT '25' NOT NULL,
	"reward_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"reward_currency" text DEFAULT 'USD' NOT NULL,
	"holding_days" integer DEFAULT 14 NOT NULL,
	"min_payout" numeric(12, 2) DEFAULT '0' NOT NULL,
	"banner_enabled" boolean DEFAULT false NOT NULL,
	"banner_text" text DEFAULT '' NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_user_id" text NOT NULL,
	"referred_user_id" text NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'signed_up' NOT NULL,
	"organization_id" uuid,
	"reward_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"reward_currency" text DEFAULT 'USD' NOT NULL,
	"reward_type" text,
	"reward_percent" numeric(5, 2),
	"qualifying_at" timestamp,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "referrals_referred_user_id_unique" UNIQUE("referred_user_id")
);
--> statement-breakpoint
CREATE INDEX "payout_requests_user_idx" ON "payout_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "referrals_referrer_idx" ON "referrals" USING btree ("referrer_user_id");