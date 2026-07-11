ALTER TABLE "transactions" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "transactions_tags_idx" ON "transactions" USING gin ("tags");