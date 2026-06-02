ALTER TABLE "client_attachments" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "client_attachments" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "client_attachments" ADD COLUMN "category" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "client_attachments" ADD COLUMN "updated_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "quotation_attachments" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "quotation_attachments" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "quotation_attachments" ADD COLUMN "category" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotation_attachments" ADD COLUMN "updated_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "transaction_attachments" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "transaction_attachments" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction_attachments" ADD COLUMN "category" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction_attachments" ADD COLUMN "updated_at" timestamp DEFAULT now();