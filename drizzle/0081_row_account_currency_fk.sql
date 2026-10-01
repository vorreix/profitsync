-- A ledger row is always in its account's currency — enforced by the database
-- (MC-057).
--
-- The account currency lock (src/lib/account-currency-lock.ts) is checked by
-- the PATCH and re-asserted in its UPDATE, but every money writer reads the
-- account's currency, awaits other work, and only then inserts. A currency
-- change committed in between let a USD leg land on what had just become an
-- EUR account. Application checks cannot close that window; a constraint does:
-- transactions(wealth_account_id, currency_code) must name an account that IS
-- in that currency.
--
-- * MATCH SIMPLE (the default, spelled out): a row with no account, or with a
--   NULL currency (legacy, pre-0069), is not checked. The exemption is the
--   ROW's only: an account whose currency_code is NULL matches no key, so it
--   accepts only NULL-currency rows. Several writers stamp a fallback code on
--   such an account (debt payments and disbursements, the recurring
--   materializer), so step 1 makes a NULL-currency account impossible first.
-- * DEFERRABLE INITIALLY DEFERRED: checked at COMMIT, so a deliberate relabel
--   that rewrites the account and its rows in ONE transaction passes whichever
--   it updates first — scripts/relabel-org-currency.mjs (one statement) and the
--   debt currency change (api/_routes/debts/[id].ts, one dbBatch). Every other
--   currency change (account PATCH, card correction, onboarding's untouched
--   cash) only runs on an account with no row at all, trashed included.
-- * ON UPDATE / ON DELETE NO ACTION: an account whose rows are still in the old
--   currency cannot change it (never CASCADE — that would relabel amounts
--   instead of refusing). Deleting an account still nulls its rows through the
--   existing single-column FK, which runs first; the deferred check then finds
--   nothing referencing the deleted key.
--
-- Postgres only checks the FK when the key columns change, so balance updates
-- and trash/restore of existing rows pay nothing.
--
-- Re-runnable: the functions are OR REPLACE, the triggers and the constraint
-- are dropped first, the index is IF NOT EXISTS, the backfill only matches NULLs.

-- 1. No account without a currency. Every current writer stamps one; the
--    pre-multi-currency deployment does not, and it keeps serving through the
--    build window (vercel-build migrates before the new code is promoted) and
--    again after an instant rollback (MC-118). It gets the workspace currency —
--    the rule 0069 backfilled with and POST /api/wealth/accounts writes.
--    A debt account is then corrected to its debt's currency by the
--    debt_details trigger below (that deployment inserts the terms AFTER the
--    account, so the account trigger cannot see them).
CREATE OR REPLACE FUNCTION wealth_accounts_fill_currency() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.currency_code IS NULL THEN
    NEW.currency_code := (
      SELECT c FROM (
        SELECT coalesce(o.reporting_currency, upper(o.currency)) AS c
        FROM organizations o WHERE o.id = NEW.organization_id
      ) s
      WHERE c ~ '^[A-Z]{3}$'
    );
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "wealth_accounts_fill_currency" ON "wealth_accounts";
--> statement-breakpoint
CREATE TRIGGER "wealth_accounts_fill_currency" BEFORE INSERT ON "wealth_accounts"
FOR EACH ROW EXECUTE FUNCTION wealth_accounts_fill_currency();
--> statement-breakpoint
-- The debt's terms name its currency (0076). Only while the account holds no
-- currency-stamped row: every current writer inserts the account already in
-- the debt's currency, so this only ever fires for the old deployment, whose
-- rows carry no currency.
CREATE OR REPLACE FUNCTION debt_details_account_currency() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF upper(NEW.currency) ~ '^[A-Z]{3}$' THEN
    UPDATE wealth_accounts wa SET currency_code = upper(NEW.currency)
    WHERE wa.id = NEW.wealth_account_id
      AND wa.currency_code IS DISTINCT FROM upper(NEW.currency)
      AND NOT EXISTS (
        SELECT 1 FROM transactions t
        WHERE t.wealth_account_id = wa.id AND t.currency_code IS NOT NULL
      );
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "debt_details_account_currency" ON "debt_details";
--> statement-breakpoint
CREATE TRIGGER "debt_details_account_currency" AFTER INSERT ON "debt_details"
FOR EACH ROW EXECUTE FUNCTION debt_details_account_currency();
--> statement-breakpoint
-- After the triggers, so an account inserted meanwhile cannot slip between them.
-- A debt account that already has its terms takes the debt's currency (0076).
UPDATE "wealth_accounts" wa
SET "currency_code" = s."c"
FROM (
  SELECT w."id", coalesce(
    (SELECT upper(dd."currency") FROM "debt_details" dd
     WHERE dd."wealth_account_id" = w."id" AND upper(dd."currency") ~ '^[A-Z]{3}$'),
    o."reporting_currency", upper(o."currency")) AS "c"
  FROM "wealth_accounts" w
  JOIN "organizations" o ON o."id" = w."organization_id"
  WHERE w."currency_code" IS NULL
) s
WHERE wa."id" = s."id"
  AND wa."currency_code" IS NULL
  AND s."c" ~ '^[A-Z]{3}$';
--> statement-breakpoint

-- 2. The FK target: a non-partial unique index on (id, currency_code). `id` is
-- already the primary key, so this can never reject a row.
CREATE UNIQUE INDEX IF NOT EXISTS "wealth_accounts_id_currency_unique" ON "wealth_accounts" ("id", "currency_code");
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_account_currency_fk";
--> statement-breakpoint
-- 3. NOT VALID: enforced on every new or changed row from here on, without
-- checking history yet — so the ADD can never fail on existing data.
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_currency_fk" FOREIGN KEY ("wealth_account_id", "currency_code") REFERENCES "wealth_accounts" ("id", "currency_code") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED NOT VALID;
--> statement-breakpoint
-- 4. History is validated only when it is clean (0 rows on the shared dev DB when
-- this was written). A database holding a row in another currency than its
-- account keeps the constraint NOT VALID — still enforced for every new write —
-- instead of failing the deploy; scripts/audit-balances.mjs lists those rows,
-- and once they are repaired `ALTER TABLE transactions VALIDATE CONSTRAINT
-- transactions_account_currency_fk` finishes the job.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "transactions" t
    WHERE t."wealth_account_id" IS NOT NULL
      AND t."currency_code" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "wealth_accounts" w
        WHERE w."id" = t."wealth_account_id" AND w."currency_code" = t."currency_code"
      )
  ) THEN
    ALTER TABLE "transactions" VALIDATE CONSTRAINT "transactions_account_currency_fk";
  ELSE
    RAISE WARNING 'transactions_account_currency_fk left NOT VALID: rows in another currency than their account exist (see scripts/audit-balances.mjs)';
  END IF;
END $$;
