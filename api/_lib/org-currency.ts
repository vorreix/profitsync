// The workspace currency, written in ONE place.
//
// It lives in two columns (docs/multi-currency/ARCHITECTURE.md): every report
// converts into `reporting_currency`, while the legacy `currency` is still read
// by native clients and older code paths. Writing one without the other is how
// MC-001/MC-033 happened — onboarding and the admin edit set only `currency`,
// `coalesce(reporting_currency, currency)` kept preferring the stale one, and a
// workspace that chose ₹ was shown $ everywhere while its AI prompt said INR.
// So every writer goes through setOrgCurrency and both columns move together.
//
// It never touches what the money is IN: accounts, rows, rules, budgets and
// quotations keep their own currency and are converted for display. A
// workspace whose rows carry the WRONG label is repaired by the operator
// script scripts/relabel-org-currency.mjs, never as a side effect of this.
//
// NOTE: relative imports keep the .js extension (unbundled ESM on @vercel/node).
import { eq } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { auditLogs, organizations } from "../../src/lib/db/schema.js"
import { isCurrencyCode, normalizeCurrencyCode } from "../../src/lib/money.js"

type OrgRow = typeof organizations.$inferSelect
type OrgPatch = Partial<typeof organizations.$inferInsert>
type Change = { from: string | null; to: string }

/** A request's currency as a known, upper-case code — or null (answer 400 `invalid_currency`). */
export function parseOrgCurrency(input: unknown): string | null {
  return isCurrencyCode(input) ? normalizeCurrencyCode(input) : null
}

/**
 * What moving a workspace to `next` changes — empty means write nothing. The
 * reporting currency is compared by its EFFECTIVE value (a NULL column reports
 * in `currency`), so re-saving the currency the workspace already reports in is
 * a no-op: an admin rename re-sends the pre-filled code, and must not quietly
 * overwrite a drifted legacy column — that drift is how the operator audit
 * (`reporting_currency is distinct from currency`) finds a workspace to repair
 * with scripts/relabel-org-currency.mjs. A drifted legacy column that a REAL
 * change rewrites is recorded too.
 */
export function orgCurrencyChanges(before: { currency: string; reportingCurrency: string | null }, next: string): Record<string, Change> {
  const changes: Record<string, Change> = {}
  const reporting = before.reportingCurrency ?? before.currency
  if (reporting.toUpperCase() === next) return changes
  changes.reporting_currency = { from: reporting, to: next }
  if (before.currency !== next && before.currency !== reporting) changes.currency = { from: before.currency, to: next }
  return changes
}

/**
 * Set the workspace currency — both columns, in the same UPDATE as any other
 * organization fields passed in `also` — and audit who changed it from what.
 * When the workspace already reports in `code`, only `also` is written.
 * `code` must already be valid (parseOrgCurrency); an unknown one throws.
 * Returns the updated row, or undefined when the organization does not exist.
 */
export async function setOrgCurrency(
  orgId: string,
  code: string,
  opts: { actorId?: string | null; also?: OrgPatch } = {},
): Promise<OrgRow | undefined> {
  const next = normalizeCurrencyCode(code)
  const [before] = await db
    .select({ currency: organizations.currency, reportingCurrency: organizations.reportingCurrency })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1)
  if (!before) return undefined
  const changes = orgCurrencyChanges(before, next)
  const moving = Object.keys(changes).length > 0
  const [row] = await db
    .update(organizations)
    .set({ ...opts.also, ...(moving ? { currency: next, reportingCurrency: next } : {}), updatedAt: new Date() })
    .where(eq(organizations.id, orgId))
    .returning()
  if (row && moving) {
    // Inserted directly: logAudit's AuditEntity has no "organization" and
    // /api/audit serves no org history yet — this row answers "who switched
    // every report to INR, and when". Auditing never breaks the write.
    try {
      await db.insert(auditLogs).values({ organizationId: orgId, entityType: "organization", entityId: orgId, action: "update", actorUserId: opts.actorId ?? null, changes })
    } catch {
      /* non-fatal */
    }
  }
  return row
}
