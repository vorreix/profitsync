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
import { cards, recurringRules, transactions, wealthAccounts } from "../../src/lib/db/schema.js"
import { balanceDelta } from "../../src/lib/wealth-ledger.js"
import { occurrencesDue, ruleExhausted, todayIso, type Frequency, type FrequencyUnit } from "../../src/lib/recurring.js"
import { ensureDefaultClient } from "./auth.js"
import { checkTransactionQuota } from "./quota.js"
import { logAudit } from "./audit.js"
import { createNotification } from "./notifications.js"
import { notifyIfBudgetExceeded } from "./notify-budget.js"
import { createTransfer } from "./wealth-accounts.js"

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
        // The source/target account(s) must still be active — materializing onto
        // an archived account would silently corrupt a balance nobody looks at. A
        // transfer (Space auto-save) needs BOTH the source and the destination.
        const isTransfer = rule.kind === "transfer"
        let transferCreatedCount = 0
        let regularCreatedCount = 0
        if (isTransfer && (!rule.wealthAccountId || !rule.toAccountId)) {
          await setRuleError(rule.id, "Auto-save needs both a source account and a Space")
          result.skipped.push(rule.name)
          continue
        }
        const accountIds = [rule.wealthAccountId, isTransfer ? rule.toAccountId : null].filter((x): x is string => !!x)
        let accountOk = true
        for (const acctId of accountIds) {
          const [account] = await db
            .select({ id: wealthAccounts.id, archivedAt: wealthAccounts.archivedAt })
            .from(wealthAccounts)
            .where(and(eq(wealthAccounts.id, acctId), eq(wealthAccounts.organizationId, orgId)))
          if (!account || account.archivedAt) { accountOk = false; break }
        }
        if (!accountOk) {
          await setRuleError(rule.id, "Account is archived or missing — pick another account")
          result.skipped.push(rule.name)
          continue
        }
        // A rule that pays with a card pauses while the card can't take new
        // purchases (frozen — e.g. lost — or closed): the occurrence is NOT
        // created and the cursor stays put, so unfreezing catches up. Same
        // contract as the archived-account branch above.
        if (rule.cardId) {
          const [card] = await db
            .select({ status: cards.status, accountId: cards.accountId })
            .from(cards)
            .where(and(eq(cards.id, rule.cardId), eq(cards.organizationId, orgId)))
          if (!card || card.status !== "active" || card.accountId !== rule.wealthAccountId) {
            await setRuleError(rule.id, !card ? "Card is missing — pick another card" : card.status === "frozen" ? "Card is frozen — unfreeze it or pick another card" : "Card is closed — pick another card")
            result.skipped.push(rule.name)
            continue
          }
        }

        const clientId = rule.clientId ?? (await ensureDefaultClient(orgId, rule.createdBy ?? "system"))
        if (!rule.currencyCode) {
          await setRuleError(rule.id, "Currency is missing — edit and save this recurring rule")
          result.skipped.push(rule.name)
          continue
        }

        // Plan quota: a blocked rule pauses (cursor NOT advanced) and surfaces
        // the reason, so occurrences materialize after an upgrade/cleanup.
        const quota = await checkTransactionQuota(orgId, clientId)
        if (!quota.allowed) {
          await setRuleError(rule.id, quota.reason)
          result.skipped.push(rule.name)
          continue
        }

        for (const dueDate of due) {
          if (isTransfer && rule.wealthAccountId && rule.toAccountId) {
            const [existingOccurrence] = await db
              .select({ id: transactions.id })
              .from(transactions)
              .where(and(eq(transactions.recurringRuleId, rule.id), eq(transactions.recurringDueDate, dueDate)))
              .limit(1)
            if (!existingOccurrence) {
              const transfer = await createTransfer(orgId, rule.createdBy ?? "system", {
                fromAccountId: rule.wealthAccountId,
                toAccountId: rule.toAccountId,
                amount: rule.amount,
                date: dueDate,
                descriptions: { out: rule.name, in: rule.name },
                recurringRuleId: rule.id,
                recurringDueDate: dueDate,
              })
              if (!transfer.ok) {
                await setRuleError(rule.id, typeof transfer.body.error === "string" ? transfer.body.error : "Transfer could not be recorded")
                result.skipped.push(rule.name)
                continue
              }
              result.created++
              transferCreatedCount++
            }
            continue
          }

          const inserted = await db
            .insert(transactions)
            .values({
              clientId,
              wealthAccountId: rule.wealthAccountId,
              // Attribution follows the rule: the card that pays each occurrence.
              cardId: rule.cardId,
              type: rule.type,
              amount: rule.amount,
              currencyCode: rule.currencyCode,
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
            regularCreatedCount++
            if (rule.wealthAccountId) {
              const delta = balanceDelta(rule.type, rule.amount)
              await db
                .update(wealthAccounts)
                .set({
                  // toFixed(2) — the delta derives from a 2-decimal amount; never let float
                  // noise (e.g. "0.30000000000000004") reach the numeric cast.
                  currentBalance: sql`${wealthAccounts.currentBalance} + ${delta.toFixed(2)}::numeric`,
                  updatedAt: new Date(),
                })
                .where(eq(wealthAccounts.id, rule.wealthAccountId))
            }
            await logAudit({ orgId, entityType: "transaction", entityId: inserted[0].id, action: "create", actorId: rule.createdBy })
          }
        }

        // Personal "auto-saved to your Space" notification — best-effort, once per
        // batch, only when at least one auto-save actually posted. Off the response
        // path (void) so it never blocks or fails materialization.
        if (isTransfer && transferCreatedCount > 0 && rule.createdBy && rule.toAccountId) {
          const toAccountId = rule.toAccountId
          const recipient = rule.createdBy
          const cursor = nextCursor
          void (async () => {
            const [space] = await db
              .select({ name: wealthAccounts.nickname })
              .from(wealthAccounts)
              .where(eq(wealthAccounts.id, toAccountId))
            await createNotification({
              userId: recipient,
              organizationId: orgId,
              type: "space_autosaved",
              title: "Auto-saved to your Space",
              body: `Money moved into ${space?.name ?? "your Space"}`,
              data: {
                i18nKey: "types.space_autosaved.title",
                i18nBodyKey: "types.space_autosaved.body",
                i18nParams: { space: space?.name ?? "" },
              },
              link: `/spaces/${toAccountId}`,
              dedupeKey: `space_autosave:${rule.id}:${cursor}`,
            })
          })().catch(() => {})
        }

        // A materialized recurring expense is real spend, so it can breach a budget
        // exactly like a manual one. Evaluated once per rule per batch, off the
        // response path so alerting can never fail materialization.
        if (!isTransfer && regularCreatedCount > 0 && rule.type === "outgoing") {
          void notifyIfBudgetExceeded(orgId, clientId, rule.createdBy ?? "system", { category: rule.category }).catch(() => {})
        }

        // Regular recurring rules tell their creator what posted — best-effort,
        // once per rule per batch (count carries how many occurrences landed).
        if (!isTransfer && regularCreatedCount > 0 && rule.createdBy) {
          void createNotification({
            userId: rule.createdBy,
            organizationId: orgId,
            type: "recurring_posted",
            title: "Recurring transaction posted",
            body:
              regularCreatedCount === 1
                ? `"${rule.name}" was added automatically.`
                : `"${rule.name}" added ${regularCreatedCount} transactions.`,
            data: {
              i18nKey: "types.recurring_posted.title",
              i18nBodyKey: regularCreatedCount === 1 ? "types.recurring_posted.body" : "types.recurring_posted.body_many",
              i18nParams: { name: rule.name, count: regularCreatedCount },
            },
            // The rule's own page — it lists exactly the rows this notification
            // is about.
            link: `/recurring/${rule.id}`,
            dedupeKey: `recurring_posted:${rule.id}:${nextCursor}`,
          }).catch(() => {})
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
