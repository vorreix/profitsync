-- ONE recurring repayment per debt, enforced by the database.
--
-- debt_details.payment_amount / payment_frequency / next_due_date MIRROR
-- exactly one rule, and the planner, the payoff estimate and the month's
-- obligations all read that mirror. Two rules make every one of them fiction —
-- and the way it happens is not obvious: the application checked for a sibling
-- and then wrote, so two links arriving together both saw an empty debt.
--
-- A partial index, because almost every rule has no debt at all. Same shape as
-- the one-overall-budget rule in 0065.
CREATE UNIQUE INDEX IF NOT EXISTS "recurring_rules_one_per_debt_idx"
  ON "recurring_rules" ("debt_account_id")
  WHERE "debt_account_id" IS NOT NULL;
