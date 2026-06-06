CREATE TABLE "wealth_account_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wealth_account_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"file_name" text NOT NULL,
	"file_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"file_data" text NOT NULL,
	"display_name" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "wealth_accounts" ADD COLUMN "brand_domain" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "wealth_accounts" ADD COLUMN "logo_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "wealth_accounts" ADD COLUMN "logo_data" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "wealth_accounts" ADD COLUMN "country" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "wealth_accounts" ADD COLUMN "account_number" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "wealth_accounts" ADD COLUMN "routing_number" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "wealth_accounts" ADD COLUMN "swift" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "wealth_accounts" ADD COLUMN "address" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "wealth_accounts" ADD COLUMN "location" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "wealth_accounts" ADD COLUMN "note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "wealth_account_attachments" ADD CONSTRAINT "wealth_account_attachments_wealth_account_id_wealth_accounts_id_fk" FOREIGN KEY ("wealth_account_id") REFERENCES "public"."wealth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wealth_account_attachments_account_idx" ON "wealth_account_attachments" USING btree ("wealth_account_id");