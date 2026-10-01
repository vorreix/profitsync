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

import Decimal from "decimal.js"
import { and, eq, lte, sql } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { cards, recurringRules, transactions, wealthAccounts } from "../../src/lib/db/schema.js"
import { balanceDelta } from "../../src/lib/wealth-ledger.js"
import { occurrencesDue, ruleExhausted, todayIso, type Frequency, type FrequencyUnit } from "../../src/lib/recurring.js"
import { mirrorDebtSchedule, postDebtOccurrences, reloadRule } from "./recurring-debt.js"
import { ensureDefaultClient } from "./auth.js"
import { checkTransactionQuota } from "./quota.js"
import { logAudit } from "./audit.js"
import { createNotification } from "./notifications.js"
import { notifyIfBudgetExceeded } from "./notify-budget.js"
import { createTransfer } from "./wealth-accounts.js"
import { ensureHistoricalRates } from "./fx-rates.js"
import { moneyDecimals } from "../../src/lib/money.js"

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

      // A debt repayment splits into principal (a transfer) and interest/fees
      // (expenses) and has to write the allocation row that records the split,
      // so it runs through the debt engine rather than either branch below.
      // api/_lib/recurring-debt.ts explains why it cannot be a plain transfer.
      let debtFullyRepaid = false
      if (rule.kind === "debt") {
        if (due.length > 0) {
          const outcome = await postDebtOccurrences(orgId, rule, due)
          if (!outcome.ok) {
            await setRuleError(rule.id, outcome.body)
            result.skipped.push(rule.name)
            continue
          }
          result.created += outcome.created
          debtFullyRepaid = outcome.fullyRepaid
          if (outcome.created > 0 && rule.createdBy && rule.debtAccountId) {
            const recipient = rule.createdBy
            const debtId = rule.debtAccountId
            const count = outcome.created
            const cursor = nextCursor
            void createNotification({
              userId: recipient,
              organizationId: orgId,
              type: debtFullyRepaid ? "debt_repaid" : "debt_payment_posted",
              title: debtFullyRepaid ? "Debt repaid" : "Repayment posted",
              body: debtFullyRepaid
                ? `"${rule.name}" cleared the last of it. Nothing left to pay.`
                : count === 1
                  ? `"${rule.name}" was paid automatically.`
                  : `"${rule.name}" posted ${count} repayments.`,
              data: {
                i18nKey: debtFullyRepaid ? "types.debt_repaid.title" : "types.debt_payment_posted.title",
                i18nBodyKey: debtFullyRepaid ? "types.debt_repaid.body" : count === 1 ? "types.debt_payment_posted.body" : "types.debt_payment_posted.body_many",
                i18nParams: { name: rule.name, count },
              },
              link: `/debts/${debtId}`,
              dedupeKey: `debt_payment:${rule.id}:${cursor}`,
            }).catch(() => {})
          }
          // Another materializer owns the rest of this catch-up. Whatever this
          // run posted stands and has been announced, but the cursor stays put:
          // stepping over occurrences nobody has posted loses them, and the
          // other run may still die.
          if (outcome.hold) continue
        }
      } else if (due.length > 0) {
        // The source/target account(s) must still be active — materializing onto
        // an archived account would silently corrupt a balance nobody looks at. A
        // transfer (Space auto-save) needs BOTH the source and the destination.
        const isTransfer = rule.kind === "transfer"
        let transferCreatedCount = 0
        let regularCreatedCount = 0
        if (isTransfer && (!rule.wealthAccountId || !rule.toAccountId)) {
          await setRuleError(rule.id, { error: "Auto-save needs both a source account and a Space", code: "recurring_autosave_incomplete" })
          result.skipped.push(rule.name)
          continue
        }
        const accountIds = [rule.wealthAccountId, isTransfer ? rule.toAccountId : null].filter((x): x is string => !!x)
        let accountOk = true
        let sourceCurrency: string | null = null
        let destinationCurrency: string | null = null
        for (const acctId of accountIds) {
          const [account] = await db
            .select({ id: wealthAccounts.id, archivedAt: wealthAccounts.archivedAt, currencyCode: wealthAccounts.currencyCode })
            .from(wealthAccounts)
            .where(and(eq(wealthAccounts.id, acctId), eq(wealthAccounts.organizationId, orgId)))
          if (!account || account.archivedAt) { accountOk = false; break }
          if (acctId === rule.wealthAccountId) sourceCurrency = account.currencyCode
          else destinationCurrency = account.currencyCode
        }
        if (!accountOk) {
          await setRuleError(rule.id, { error: "Account is archived or missing — pick another account", code: "account_archived" })
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
            await setRuleError(rule.id, !card
              ? { error: "Card is missing — pick another card", code: "recurring_card_missing" }
              : card.status === "frozen"
                ? { error: "Card is frozen — unfreeze it or pick another card", code: "recurring_card_frozen" }
                : { error: "Card is closed — pick another card", code: "recurring_card_closed" })
            result.skipped.push(rule.name)
            continue
          }
        }

        const clientId = rule.clientId ?? (await ensureDefaultClient(orgId, rule.createdBy ?? "system"))
        if (!rule.currencyCode) {
          await setRuleError(rule.id, { error: "Currency is missing — edit and save this recurring rule", code: "recurring_currency_missing" })
          result.skipped.push(rule.name)
          continue
        }
        // Second guard behind the account currency lock (MC-011). The amount is
        // in the RULE's currency but moves the ACCOUNT's balance, so a mismatch
        // would book €50 as $50 on a USD account (an auto-save's source leg
        // too). Paused like the archived-account branch (cursor not advanced)
        // until the rule is edited onto an account in its currency. A legacy
        // account with no currency yet keeps the old behaviour.
        if (sourceCurrency && sourceCurrency !== rule.currencyCode) {
          await setRuleError(rule.id, {
            error: `This rule is in ${rule.currencyCode} but its account is in ${sourceCurrency} — edit the rule and pick an account in ${rule.currencyCode}`,
            code: "recurring_account_currency",
            currency: rule.currencyCode,
            account_currency: sourceCurrency,
          })
          result.skipped.push(rule.name)
          continue
        }

        // Plan quota: a blocked rule pauses (cursor NOT advanced) and surfaces
        // the reason, so occurrences materialize after an upgrade/cleanup.
        const quota = await checkTransactionQuota(orgId, clientId)
        if (!quota.allowed) {
          // The plan-limit body as a route sends it, so it reads the same way.
          await setRuleError(rule.id, { error: quota.reason, ...quota })
          result.skipped.push(rule.name)
          continue
        }

        // An auto-save that cannot post pauses the rule at THAT occurrence
        // (MC-071): moving on to the next date — and then advancing the cursor
        // past it and clearing `last_error` below — lost the occurrence
        // silently. Same contract as the archived-account and quota branches
        // and the debt branch's `hold`: whatever posted before it stands, the
        // cursor stays put, and the next run re-tries from there (the
        // per-date existence check skips what already posted).
        let blocked = false
        for (const dueDate of due) {
          if (isTransfer && rule.wealthAccountId && rule.toAccountId) {
            const [existingOccurrence] = await db
              .select({ id: transactions.id })
              .from(transactions)
              .where(and(eq(transactions.recurringRuleId, rule.id), eq(transactions.recurringDueDate, dueDate)))
              .limit(1)
            if (!existingOccurrence) {
              // Across currencies (MC-159) the rule holds what LEAVES, in its
              // own (the source's) currency; what arrives is that amount at the
              // occurrence date's rate — never a figure frozen when the rule was
              // made — and the transfer records it as a provider rate. No rate
              // for that date: the rule pauses at this occurrence like any other
              // refusal and re-tries on the next run.
              let destinationAmount: string | undefined
              const toCurrency: string = destinationCurrency ?? rule.currencyCode
              if (toCurrency !== rule.currencyCode) {
                const rate = await rateOnDate(rule.currencyCode, toCurrency, dueDate)
                if (!rate) {
                  await setRuleError(rule.id, {
                    error: `No ${rule.currencyCode} to ${toCurrency} exchange rate for ${dueDate} yet — this auto-save runs once there is one`,
                    code: "autosave_rate_unavailable",
                    from: rule.currencyCode,
                    to: toCurrency,
                  })
                  result.skipped.push(rule.name)
                  blocked = true
                  break
                }
                destinationAmount = autoSaveReceivedAmount(rule.amount, rate, toCurrency)
              }
              const transfer = await createTransfer(orgId, rule.createdBy ?? "system", {
                fromAccountId: rule.wealthAccountId,
                toAccountId: rule.toAccountId,
                amount: rule.amount,
                destinationAmount,
                rateSource: destinationAmount ? "provider" : undefined,
                date: dueDate,
                descriptions: { out: rule.name, in: rule.name },
                recurringRuleId: rule.id,
                recurringDueDate: dueDate,
                // Each side in the currency it was read in: an account whose
                // currency has since changed is refused by name instead of
                // booked in the wrong money.
                sourceCurrency: rule.currencyCode,
                destinationCurrency: toCurrency,
              })
              if (!transfer.ok) {
                // The transfer service's own refusal body: its code is translated already.
                await setRuleError(rule.id, typeof transfer.body.error === "string" ? { ...transfer.body, error: transfer.body.error } : { error: "Transfer could not be recorded" })
                result.skipped.push(rule.name)
                blocked = true
                break
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
        if (blocked) continue

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

      // Advance the cursor (never backwards) + auto-finish exhausted rules. A
      // debt repayment also retires when the debt reaches zero: leaving it
      // active would keep moving money into a settled loan every month, and the
      // balance would cross into credit where nothing reports it.
      await db
        .update(recurringRules)
        .set({
          nextDueAt: sql`GREATEST(${recurringRules.nextDueAt}, ${nextCursor})`,
          ...(ruleExhausted(nextCursor, rule.endDate) || debtFullyRepaid ? { active: false } : {}),
          lastError: "",
          updatedAt: new Date(),
        })
        .where(eq(recurringRules.id, rule.id))

      // Keep the debt's own schedule fields equal to the rule that drives them,
      // so the payoff estimate and the planner never describe a different
      // schedule from the one taking the money.
      if (rule.kind === "debt" && rule.debtAccountId) {
        const fresh = await reloadRule(rule.id)
        if (fresh) await mirrorDebtSchedule(rule.debtAccountId, fresh)
      }
    } catch (err) {
      // A thrown error's message is the driver's or the runtime's, never a
      // sentence written for the user — so it is coded for every reader,
      // English included, and kept in `error` only for the logs.
      await setRuleError(rule.id, { error: err instanceof Error ? err.message : "Materialization failed", code: "recurring_failed" })
      result.skipped.push(rule.name)
    }
  }

  return result
}

/**
 * What a cross-currency auto-save delivers (MC-159): the rule's source amount
 * at the rate, rounded half-up to the destination's writable decimals
 * (moneyDecimals: its minor unit, at most the ledger's 2 — whole yen). Pure; createTransfer then
 * validates it like any typed amount, so one that rounds to nothing is refused
 * with its own code instead of booking zero.
 */
export function autoSaveReceivedAmount(sourceAmount: Decimal.Value, rate: Decimal.Value, destinationCurrency: string): string {
  // The same scale createTransfer validates it against, by construction.
  const digits = moneyDecimals(destinationCurrency)
  return new Decimal(sourceAmount).times(rate).toDecimalPlaces(digits, Decimal.ROUND_HALF_UP).toFixed(digits)
}

/**
 * The rate an auto-save occurrence converts at: the stored rate for that day by
 * fx_rate_on — the one per-day definition every report converts a row with,
 * including how far a rate may be carried over a weekend — after making sure
 * that day has been fetched. Null when there is none: never 1, never a guess.
 */
async function rateOnDate(from: string, to: string, date: string): Promise<string | null> {
  await ensureHistoricalRates(from, to, date).catch(() => undefined)
  const { rows } = await db.execute(sql`select fx_rate_on(${from}, ${to}, ${date}::date)::text as rate`)
  return (rows as Array<{ rate: string | null }>)[0]?.rate ?? null
}

/**
 * Why a rule is paused, as a refusal body `{ error, code, ...params }` — the
 * same shape a route sends (MC-077). `last_error` used to hold the English
 * sentence alone, which /recurring, /recurring/:id and /debts/:id then showed
 * word for word to every reader; the code lets them say it in the reader's
 * language (`apiErrors.<code>`), and `error` keeps the English for logs and
 * builds that predate this. Readers only ever test it for emptiness, and every
 * place that clears it still writes "".
 */
export type RuleError = { error: string; code?: string; [param: string]: unknown }

async function setRuleError(ruleId: string, body: RuleError): Promise<void> {
  try {
    await db
      .update(recurringRules)
      .set({ lastError: JSON.stringify({ ...body, error: body.error.slice(0, 500) }), updatedAt: new Date() })
      .where(eq(recurringRules.id, ruleId))
  } catch {
    /* non-fatal */
  }
}
