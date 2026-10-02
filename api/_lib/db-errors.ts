// Recognising database errors a route can answer as a refusal instead of a 500.
//
// Drizzle wraps the driver's error (DrizzleQueryError → NeonDbError), so the
// SQLSTATE and constraint name sit somewhere down the `cause` chain.

type PgLike = { code?: unknown; constraint?: unknown; cause?: unknown }

function pgErrors(err: unknown): PgLike[] {
  const out: PgLike[] = []
  let cur: unknown = err
  for (let i = 0; cur && typeof cur === "object" && i < 5; i++) {
    out.push(cur as PgLike)
    cur = (cur as PgLike).cause
  }
  return out
}

/**
 * A write lost a race with an account currency change: migration 0081's
 * deferred FK rejected a row whose currency no longer matches its account.
 * Nothing was written (the whole statement or batch rolled back), so the
 * caller only has to reopen the form — the same situation as
 * `source_currency_mismatch`.
 */
export function isRowCurrencyFkViolation(err: unknown): boolean {
  return pgErrors(err).some((e) => e.code === "23503" && e.constraint === "transactions_account_currency_fk")
}
