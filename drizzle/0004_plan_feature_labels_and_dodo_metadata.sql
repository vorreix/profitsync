ALTER TABLE "plans" ADD COLUMN "feature_labels" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "dodo_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;