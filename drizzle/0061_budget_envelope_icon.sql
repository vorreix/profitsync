-- Budget v2 · a per-envelope icon.
--
-- Empty string means "derive from the section", so every existing envelope keeps
-- a sensible glyph with no backfill and no nullable column to guard against.
ALTER TABLE "budget_envelopes" ADD COLUMN IF NOT EXISTS "icon" text DEFAULT '' NOT NULL;
