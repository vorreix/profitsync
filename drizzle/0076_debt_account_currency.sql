-- Debts meet multi-currency.
--
-- Debts & Loans (0066) and the multi-currency foundation (0069) were built on
-- separate branches. A debt carries its currency in `debt_details.currency`;
-- the ledger's authority is `wealth_accounts.currency_code`, snapshotted onto
-- every transaction. 0069's backfill stamped every existing account — debts
-- included — with the ORGANIZATION currency, and debts created afterwards by
-- the pre-merge code wrote no currency at all. So a USD loan in an INR
-- workspace reads as an INR loan to every currency-aware screen.
--
-- Amounts are never touched: they were always entered in the debt's own
-- currency; only the label was wrong. Every statement is guarded so a second
-- run changes nothing.

-- 1. The debt account wears the debt's currency.
UPDATE "wealth_accounts" wa
SET "currency_code" = upper(dd."currency")
FROM "debt_details" dd
WHERE dd."wealth_account_id" = wa."id"
  AND upper(dd."currency") ~ '^[A-Z]{3}$'
  AND wa."currency_code" IS DISTINCT FROM upper(dd."currency");--> statement-breakpoint

-- 2. Every row ON a debt account follows it (opening balances, adjustments,
--    the debt side of disbursements and repayments).
UPDATE "transactions" t
SET "currency_code" = wa."currency_code"
FROM "wealth_accounts" wa
WHERE t."wealth_account_id" = wa."id"
  AND wa."type" IN ('loan', 'receivable')
  AND wa."currency_code" IS NOT NULL
  AND t."currency_code" IS DISTINCT FROM wa."currency_code";--> statement-breakpoint

-- 3. Rows written without a snapshot since 0069 (the paying side of debt
--    repayments, among others) take their own account's currency — the same
--    rule 0069 applied to history.
UPDATE "transactions" t
SET "currency_code" = upper(wa."currency_code")
FROM "wealth_accounts" wa
WHERE t."wealth_account_id" = wa."id"
  AND wa."currency_code" IS NOT NULL
  AND t."currency_code" IS NULL;--> statement-breakpoint

-- 4. Recurring rules likewise (debt repayment rules created without one).
UPDATE "recurring_rules" r
SET "currency_code" = upper(wa."currency_code")
FROM "wealth_accounts" wa
WHERE r."wealth_account_id" = wa."id"
  AND wa."currency_code" IS NOT NULL
  AND r."currency_code" IS NULL;--> statement-breakpoint

-- 5. A debt repayment or disbursement is never a plain logical transfer. The
--    0071 backfill now skips those groups; a database that ran the earlier
--    version after debts existed may have given their principal legs a header,
--    which would let a transfer-level trash split the repayment from its
--    interest. Detach the legs, then drop the headers nothing points at that
--    were made for such groups (the transfer service never creates one there).
UPDATE "transactions" t
SET "transfer_id" = NULL
WHERE t."transfer_id" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "transactions" o
    JOIN "wealth_accounts" ow ON ow."id" = o."wealth_account_id"
    WHERE o."group_id" = t."group_id" AND ow."type" IN ('loan', 'receivable')
  );--> statement-breakpoint
DELETE FROM "transfers" x
WHERE NOT EXISTS (SELECT 1 FROM "transactions" t WHERE t."transfer_id" = x."id")
  AND (
    EXISTS (SELECT 1 FROM "wealth_accounts" wa WHERE wa."id" IN (x."source_account_id", x."destination_account_id") AND wa."type" IN ('loan', 'receivable'))
  );
