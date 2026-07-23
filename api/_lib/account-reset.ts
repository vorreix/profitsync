import { eq } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import {
  auditLogs,
  budgetHistory,
  budgets,
  categories,
  clients,
  quotations,
  recurringRules,
  tags,
  userProfiles,
  wealthAccounts,
} from "../../src/lib/db/schema.js"
import { ensureDefaultClient } from "./auth.js"

export type ResetDataResult = { organizationId: string }

/**
 * Factory-reset ONE organization's financial data back to a clean first-use
 * state — WITHOUT touching auth/session. Unlike teardownOrganization (which
 * deletes the org and cancels Dodo billing), this KEEPS the org, its
 * membership, its subscription/billing, the AI credit balance, and the user's
 * Clerk account + profile identity. It just empties the money.
 *
 * Deletes (all org-scoped):
 *  - `clients` — no org FK cascade, so deleting it here cascades its
 *    `transactions` + transaction/client attachments (this also clears Trash,
 *    which is just rows with `deleted_at` set).
 *  - `quotations` — same (cascades quotation attachments + pdfs).
 *  - `wealth_accounts` (+ their attachments), `recurring_rules`, `budgets` +
 *    `budget_history`, `categories`, `tags`, and the `audit_logs` history.
 *
 * Preserves: `subscriptions` / `invoices` / billing attempts, `ai_*` credits,
 * the `organizations` row + `organization_members`, and `user_profiles`
 * identity fields.
 *
 * Afterward it re-seeds the invariant "own"/anchor client (transactions FK to
 * it) and clears `onboarded_at` so the user lands on onboarding again; the Cash
 * account and default categories re-provision lazily on next access, and
 * onboarding re-seeds currency/wealth.
 *
 * Idempotent and safe to retry: every step is a scoped delete or an upsert.
 */
export async function resetOrgData(orgId: string, userId: string): Promise<ResetDataResult> {
  // Order: clients/quotations first (their cascades remove transactions +
  // attachments), then the remaining org-scoped tables.
  await db.delete(clients).where(eq(clients.organizationId, orgId))
  await db.delete(quotations).where(eq(quotations.organizationId, orgId))
  await db.delete(recurringRules).where(eq(recurringRules.organizationId, orgId))
  await db.delete(budgetHistory).where(eq(budgetHistory.organizationId, orgId))
  await db.delete(budgets).where(eq(budgets.organizationId, orgId))
  await db.delete(wealthAccounts).where(eq(wealthAccounts.organizationId, orgId))
  await db.delete(categories).where(eq(categories.organizationId, orgId))
  await db.delete(tags).where(eq(tags.organizationId, orgId))
  await db.delete(auditLogs).where(eq(auditLogs.organizationId, orgId))

  // Re-seed the anchor client so the workspace is immediately usable again.
  await ensureDefaultClient(orgId, userId)

  // Clean first-use state: re-trigger onboarding and reset the dashboard layout.
  await db
    .update(userProfiles)
    .set({ onboardedAt: null, dashboardLayout: {}, updatedAt: new Date() })
    .where(eq(userProfiles.id, userId))

  return { organizationId: orgId }
}
