-- No ledger row or recurring rule without a currency (MC-118).
--
-- Every current writer stamps currency_code. The pre-multi-currency deployment
-- does not, and it keeps serving through the build window (vercel-build
-- migrates before the new code is promoted) and again after an instant
-- rollback. 0081 already fills a NULL on wealth_accounts; this does the same
-- for the rows written against them, with the rule 0069 backfilled by:
--
-- * a row on an account takes THAT ACCOUNT's currency — exactly what 0081's FK
--   (transactions_account_currency_fk) demands. If the account itself has no
--   currency (only possible for a workspace without a valid currency) the row
--   stays NULL: stamping anything else would fail that FK at COMMIT.
-- * a row with no account takes the workspace's
--   coalesce(reporting_currency, upper(currency)), when that is a valid code.
--
-- The old deployment inserts a debt's account, then its terms (whose trigger,
-- 0081, relabels the account to the debt's currency), then its rows — so the
-- rows read the debt's currency here, not the workspace's.
--
-- Re-runnable: the functions are OR REPLACE, the triggers are dropped first,
-- the backfills only match NULLs.
CREATE OR REPLACE FUNCTION transactions_fill_currency() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.currency_code IS NULL THEN
    IF NEW.wealth_account_id IS NOT NULL THEN
      NEW.currency_code := (SELECT wa.currency_code FROM wealth_accounts wa WHERE wa.id = NEW.wealth_account_id);
    ELSE
      NEW.currency_code := (
        SELECT c FROM (
          SELECT coalesce(o.reporting_currency, upper(o.currency)) AS c
          FROM clients cl JOIN organizations o ON o.id = cl.organization_id
          WHERE cl.id = NEW.client_id
        ) s
        WHERE c ~ '^[A-Z]{3}$'
      );
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "transactions_fill_currency" ON "transactions";
--> statement-breakpoint
CREATE TRIGGER "transactions_fill_currency" BEFORE INSERT ON "transactions"
FOR EACH ROW EXECUTE FUNCTION transactions_fill_currency();
--> statement-breakpoint
-- A rule's currency is its paying account's (a transfer rule's source, a debt
-- repayment's bank — which every current writer keeps in the debt's currency).
CREATE OR REPLACE FUNCTION recurring_rules_fill_currency() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.currency_code IS NULL THEN
    IF NEW.wealth_account_id IS NOT NULL THEN
      NEW.currency_code := (SELECT wa.currency_code FROM wealth_accounts wa WHERE wa.id = NEW.wealth_account_id);
    END IF;
    IF NEW.currency_code IS NULL THEN
      NEW.currency_code := (
        SELECT c FROM (
          SELECT coalesce(o.reporting_currency, upper(o.currency)) AS c
          FROM organizations o WHERE o.id = NEW.organization_id
        ) s
        WHERE c ~ '^[A-Z]{3}$'
      );
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "recurring_rules_fill_currency" ON "recurring_rules";
--> statement-breakpoint
CREATE TRIGGER "recurring_rules_fill_currency" BEFORE INSERT ON "recurring_rules"
FOR EACH ROW EXECUTE FUNCTION recurring_rules_fill_currency();
--> statement-breakpoint
-- After the triggers, so a row inserted meanwhile cannot slip between them.
-- Rows already written without a currency (the old deployment, or rows whose
-- account was later deleted): the same rule as the triggers.
UPDATE "transactions" t
SET "currency_code" = wa."currency_code"
FROM "wealth_accounts" wa
WHERE t."wealth_account_id" = wa."id"
  AND t."currency_code" IS NULL
  AND wa."currency_code" IS NOT NULL;
--> statement-breakpoint
UPDATE "transactions" t
SET "currency_code" = s."c"
FROM (
  SELECT cl."id", coalesce(o."reporting_currency", upper(o."currency")) AS "c"
  FROM "clients" cl JOIN "organizations" o ON o."id" = cl."organization_id"
) s
WHERE t."client_id" = s."id"
  AND t."wealth_account_id" IS NULL
  AND t."currency_code" IS NULL
  AND s."c" ~ '^[A-Z]{3}$';
--> statement-breakpoint
-- A rule whose account has a currency takes it; one with no account — or on an
-- account with none — takes the workspace's (a rule has no row-level FK).
UPDATE "recurring_rules" r
SET "currency_code" = s."c"
FROM (
  SELECT r2."id", coalesce(wa."currency_code", o."reporting_currency", upper(o."currency")) AS "c"
  FROM "recurring_rules" r2
  JOIN "organizations" o ON o."id" = r2."organization_id"
  LEFT JOIN "wealth_accounts" wa ON wa."id" = r2."wealth_account_id"
  WHERE r2."currency_code" IS NULL
) s
WHERE r."id" = s."id"
  AND r."currency_code" IS NULL
  AND s."c" ~ '^[A-Z]{3}$';
