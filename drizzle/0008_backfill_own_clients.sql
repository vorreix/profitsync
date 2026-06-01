-- Hand-authored data backfill: every workspace gets exactly one "own" client.
--
-- Idempotent:
--   * the UPDATE re-marks the personal default client (no-op if already true)
--   * the INSERT only adds an own client to business orgs that lack one

-- Personal workspaces: promote the single default client to the own/internal client.
UPDATE "clients" SET "is_own" = true
WHERE "id" IN (
  SELECT DISTINCT ON (c."organization_id") c."id"
  FROM "clients" c
  JOIN "organizations" o ON o."id" = c."organization_id"
  WHERE o."is_personal" = true AND c."deleted_at" IS NULL
  ORDER BY c."organization_id", c."created_at" ASC, c."id" ASC
);
--> statement-breakpoint

-- Business workspaces: create an own/internal client (named after the company)
-- for any org that doesn't already have one.
INSERT INTO "clients" ("user_id", "organization_id", "name", "status", "is_own")
SELECT o."owner_user_id", o."id", COALESCE(NULLIF(TRIM(o."name"), ''), 'My Company'), 'active', true
FROM "organizations" o
WHERE o."is_personal" = false
  AND NOT EXISTS (
    SELECT 1 FROM "clients" c
    WHERE c."organization_id" = o."id" AND c."is_own" = true AND c."deleted_at" IS NULL
  );
