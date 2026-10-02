import { and, eq, isNull } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { organizations, wealthAccounts } from "../../src/lib/db/schema.js"
import { normalizeCurrencyCode } from "../../src/lib/money.js"

/** Currency authority for financial writes. Account currency always wins. */
export async function currencyForFinancialWrite(orgId: string, accountId?: string | null): Promise<string | null> {
  if (accountId) {
    const [account] = await db
      .select({ currencyCode: wealthAccounts.currencyCode })
      .from(wealthAccounts)
      .where(and(eq(wealthAccounts.id, accountId), eq(wealthAccounts.organizationId, orgId), isNull(wealthAccounts.archivedAt)))
      .limit(1)
    if (!account?.currencyCode) return null
    return normalizeCurrencyCode(account.currencyCode)
  }
  const [org] = await db
    .select({ reportingCurrency: organizations.reportingCurrency, currency: organizations.currency })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1)
  if (!org) return null
  return normalizeCurrencyCode(org.reportingCurrency ?? org.currency)
}
