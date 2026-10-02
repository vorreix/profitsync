/**
 * The name of the ONE cash wallet every workspace always has. It is
 * auto-provisioned on first read and cannot be removed (it would just come
 * back); every other cash wallet is the user's and behaves like any account.
 * The same string is the predicate of the default-cash unique index (mig 0069),
 * and the server (api/_lib/wealth-accounts.ts) and the UI share it from here.
 */
export const DEFAULT_CASH_NAME = "Cash in Hand"

/** The permanent default wallet — never archivable. Extra cash wallets are. */
export function isDefaultCash(account: { type?: string | null; bank_name?: string | null } | null | undefined): boolean {
  return account?.type === "cash" && account.bank_name === DEFAULT_CASH_NAME
}
