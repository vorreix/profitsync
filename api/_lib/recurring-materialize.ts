// Turns due recurring rules into REAL transactions — the money path of the
// recurring-payments feature.
//
// Correctness model (Neon HTTP has no transactions, so each guarantee comes
// from a single-statement property):
//   • Idempotency: the unique index on (recurring_rule_id, recurring_due_date)
//     + `onConflictDoNothing().returning()` — concurrent/repeated catch-ups
//     can't double-insert an occurrence.
//   • Balances move ONLY for rows actually inserted (`returning()` is empty on
//     conflict), via a single relative UPDATE (`balance = balance + delta`).
//   • The cursor advances with a GREATEST guard so a stale concurrent run can
//     never move it backwards.
//
// Trigger: lazily from the transactions + wealth-accounts GETs (cheap indexed
// short-circuit when nothing is due), so lists and balances are correct before
// they render — no cron required.

import { and, eq, lte, sql } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { recurringRules, transactions, wealthAccounts } from "../../src/lib/db/schema.js"
import { balanceDelta } from "../../src/lib/wealth-ledger.js"
import { occurrencesDue, ruleExhausted, todayIso, type Frequency, type FrequencyUnit } from "../../src/lib/recurring.js"
import { ensureDefaultClient } from "./auth.js"
import { checkTransactionQuota } from "./quota.js"
import { logAudit } from "./audit.js"

export type MaterializeResult = { created: number; skipped: string[] }

/**
 * Materialize every due occurrence of the org's active rules. Non-fatal per
 * rule: one broken rule (archived account, quota, bad data) records
 * `last_error` and is skipped; the others still run.
 */
export async function materializeDueRecurring(orgId: string): Promise<MaterializeResult> {
  const today = todayIso()
  const dueRules = await db
    .select()
    .from(recurringRules)
    .where(and(eq(recurringRules.organizationId, orgId), eq(recurringRules.active, true), lte(recurringRules.nextDueAt, today)))

  const result: MaterializeResult = { created: 0, skipped: [] }
  if (dueRules.length === 0) return result

  for (const rule of dueRules) {
    try {
      const freq: Frequency = { unit: rule.frequencyUnit as FrequencyUnit, interval: rule.frequencyInterval }
      const { due, nextCursor } = occurrencesDue({
        anchor: rule.startDate,
        freq,
        cursor: rule.nextDueAt,
        until: today,
        end: rule.endDate,
      })

      if (due.length > 0) {
        // The source/target account must still be active — materializing onto an
        // archived account would silently corrupt a balance nobody looks at.
        let accountOk = true
        if (rule.wealthAccountId) {
          const [account] = await db
            .select({ id: wealthAccounts.id, archivedAt: wealthAccounts.archivedAt })
            .from(wealthAccounts)
            .where(and(eq(wealthAccounts.id, rule.wealthAccountId), eq(wealthAccounts.organizationId, orgId)))
          accountOk = !!account && !account.archivedAt
        }
        if (!accountOk) {
          await setRuleError(rule.id, "Account is archived or missing — pick another account")
          result.skipped.push(rule.name)
          continue
        }

        const clientId = rule.clientId ?? (await ensureDefaultClient(orgId, rule.createdBy ?? "system"))

        // Plan quota: a blocked rule pauses (cursor NOT advanced) and surfaces
        // the reason, so occurrences materialize after an upgrade/cleanup.
        const quota = await checkTransactionQuota(orgId, clientId)
        if (!quota.allowed) {
          await setRuleError(rule.id, quota.reason)
          result.skipped.push(rule.name)
          continue
        }

        for (const dueDate of due) {
          const inserted = await db
            .insert(transactions)
            .values({
              clientId,
              wealthAccountId: rule.wealthAccountId,
              type: rule.type,
              amount: rule.amount,
              description: rule.name,
              category: rule.category,
              date: dueDate,
              recurringRuleId: rule.id,
              recurringDueDate: dueDate,
              createdBy: rule.createdBy,
              updatedBy: rule.createdBy,
            })
            .onConflictDoNothing({ target: [transactions.recurringRuleId, transactions.recurringDueDate] })
            .returning({ id: transactions.id })

          if (inserted.length > 0) {
            result.created++
            if (rule.wealthAccountId) {
              const delta = balanceDelta(rule.type, rule.amount)
              await db
                .update(wealthAccounts)
                .set({
                  currentBalance: sql`${wealthAccounts.currentBalance} + ${String(delta)}::numeric`,
                  updatedAt: new Date(),
                })
                .where(eq(wealthAccounts.id, rule.wealthAccountId))
            }
            await logAudit({ orgId, entityType: "transaction", entityId: inserted[0].id, action: "create", actorId: rule.createdBy })
          }
        }
      }

      // Advance the cursor (never backwards) + auto-finish exhausted rules.
      await db
        .update(recurringRules)
        .set({
          nextDueAt: sql`GREATEST(${recurringRules.nextDueAt}, ${nextCursor})`,
          ...(ruleExhausted(nextCursor, rule.endDate) ? { active: false } : {}),
          lastError: "",
          updatedAt: new Date(),
        })
        .where(eq(recurringRules.id, rule.id))
    } catch (err) {
      await setRuleError(rule.id, err instanceof Error ? err.message : "Materialization failed")
      result.skipped.push(rule.name)
    }
  }

  return result
}

async function setRuleError(ruleId: string, message: string): Promise<void> {
  try {
    await db
      .update(recurringRules)
      .set({ lastError: message.slice(0, 500), updatedAt: new Date() })
      .where(eq(recurringRules.id, ruleId))
  } catch {
    /* non-fatal */
  }
}
