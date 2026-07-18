-- Demote duplicate personal orgs BEFORE the unique index below can trip on them.
-- Duplicates come from the ensurePersonalOrg boot race (two parallel first-visit
-- calls both inserted). Keep the org the user's profile currently points at
-- (else the oldest); the rest become ordinary orgs — no data is deleted.
WITH ranked AS (
  SELECT o.id, row_number() OVER (
    PARTITION BY o.owner_user_id
    ORDER BY (up.current_organization_id IS NOT DISTINCT FROM o.id) DESC, o.created_at ASC, o.id ASC
  ) AS rn
  FROM organizations o
  LEFT JOIN user_profiles up ON up.id = o.owner_user_id
  WHERE o.is_personal = true
)
UPDATE organizations SET is_personal = false, name = 'Personal (duplicate)', updated_at = now()
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);--> statement-breakpoint
CREATE INDEX "clients_org_deleted_idx" ON "clients" USING btree ("organization_id","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_one_personal_idx" ON "organizations" USING btree ("owner_user_id") WHERE is_personal = true;--> statement-breakpoint
CREATE INDEX "quotations_org_deleted_idx" ON "quotations" USING btree ("organization_id","deleted_at");
