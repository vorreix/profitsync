-- Idempotent by design: shared non-prod databases (dev/preview) were touched by
-- `drizzle-kit push` while the tags feature was being tested from its original
-- WIP branch (PR #106), so the column/index can pre-exist WITHOUT a journal
-- record. IF NOT EXISTS lets this migration no-op there while still recording
-- itself in drizzle.__drizzle_migrations; on clean databases (prod) it applies
-- normally.
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_tags_idx" ON "transactions" USING gin ("tags");
