import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { clients, transactions, wealthAccounts } from "../../../src/lib/db/schema.js"
import { canDelete, canWrite, requireAuth } from "../../_lib/auth.js"
import { diffFields, logAudit } from "../../_lib/audit.js"
import { checkTransactionTagQuota } from "../../_lib/quota.js"
import { appliedSql, balanceShiftCte } from "../../_lib/tx-legs.js"
import { amountExceedsLimit, moneyRefusal } from "../../../src/lib/money.js"
import { cleanTransactionTags } from "../../../src/lib/transaction-tags.js"
import { notifyIfBudgetExceeded } from "../../_lib/notify-budget.js"
import { refundShapeValid } from "../../../src/lib/tx-classify.js"
import { reportingAmountSql, USER_KINDS } from "../../_lib/tx-sql.js"
import { groupMoneySql } from "../../_lib/tx-group-sql.js"
import { ensureRatesForOrg, reportingCurrencyFor } from "../../_lib/fx-rates.js"
import { attributeCard } from "../../_lib/cards.js"
import { currencyForFinancialWrite } from "../../_lib/transaction-currency.js"
import { currencyChangeRefusal } from "../../_lib/currency-guards.js"
import { setTransferTrashed } from "../../_lib/wealth-accounts.js"
import { setRowsTrashed } from "../../_lib/tx-trash.js"
import { DEBT_ACCOUNT_TYPES } from "../../_lib/debts.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx
  const { id } = req.query as { id: string }

  // Verify ownership via client.organization_id
  const [row] = await db
    .select({ clientOrgId: clients.organizationId })
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .where(eq(transactions.id, id))

  if (!row || row.clientOrgId !== orgId) return res.status(404).json({ error: "Not found" })

  if (req.method === "GET") {
    // Enrich exactly like the list row (join client + wealth account, count
    // attachments) so a deep link / back-nav fetch shows real names instead of
    // raw FK UUIDs in the detail modal. Money exactly like the list row too:
    // native `amount` in its `currency_code`, plus `reporting_amount`.
    const reporting = await reportingCurrencyFor(orgId)
    // File missing rates first, as the list GET does: a deep link fires this
    // alongside the list, and must not answer "no rate" for a row the list
    // then shows converted.
    await ensureRatesForOrg(orgId, reporting).catch(() => undefined)
    const [tx] = await db
      .select({
        id: transactions.id,
        clientId: transactions.clientId,
        clientName: clients.name,
        wealthAccountId: transactions.wealthAccountId,
        wealthAccountName: wealthAccounts.nickname,
        wealthAccountBankName: wealthAccounts.bankName,
        wealthAccountType: wealthAccounts.type,
        wealthAccountIcon: wealthAccounts.icon,
        cardId: transactions.cardId,
        groupId: transactions.groupId,
        kind: transactions.kind,
        type: transactions.type,
        amount: transactions.amount,
        currencyCode: transactions.currencyCode,
        reportingAmount: reportingAmountSql(reporting),
        description: transactions.description,
        category: transactions.category,
        tags: transactions.tags,
        date: transactions.date,
        isSystem: transactions.isSystem,
        recurringRuleId: transactions.recurringRuleId,
        createdAt: transactions.createdAt,
        updatedAt: transactions.updatedAt,
        attachmentCount: sql<number>`(select count(*)::int from transaction_attachments where transaction_id = ${transactions.id})`,
        // Transfer counterpart (the other leg's account) → drives the Space badge.
        counterpartAccountId: sql<string | null>`(select t2.wealth_account_id::text from transactions t2 where t2.group_id = ${transactions.groupId} and t2.id <> ${transactions.id} and ${transactions.kind} = 'transfer' limit 1)`,
        counterpartType: sql<string | null>`(select wa.type from transactions t2 join wealth_accounts wa on wa.id = t2.wealth_account_id where t2.group_id = ${transactions.groupId} and t2.id <> ${transactions.id} and ${transactions.kind} = 'transfer' limit 1)`,
      })
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .leftJoin(wealthAccounts, eq(transactions.wealthAccountId, wealthAccounts.id))
      // Org scope is redundant with the ownership check above (client_id is
      // immutable), but re-asserting it keeps this enrichment query self-defending.
      .where(and(eq(transactions.id, id), eq(clients.organizationId, orgId)))
    if (!tx) return res.status(404).json({ error: "Not found" })

    // For a split (group), surface the group totals the modal needs to show the
    // breakdown — leg/account counts and the group's money, computed by the
    // SAME expressions as the list row (api/_lib/tx-group-sql.ts): a native sum
    // only when the legs share a currency, else converted — never €50 + ₹1,000
    // added as 1,050 under one leg's symbol. Same scope as the list too: the
    // global list never shows transfer legs, so a transfer's fee row (or a debt
    // payment's interest) groups without them, and a transfer leg — listed only
    // flat, on its account — stands alone.
    if (tx.groupId && tx.kind !== "transfer") {
      const [agg] = await db
        .select({
          legCount: sql<number>`count(*)::int`,
          accountCount: sql<number>`count(distinct ${transactions.wealthAccountId})::int`,
          ...groupMoneySql(reporting),
        })
        .from(transactions)
        .where(and(eq(transactions.groupId, tx.groupId), isNull(transactions.deletedAt), ne(transactions.kind, "transfer")))
      if (agg && agg.legCount > 0) return res.json(serialize({ ...tx, ...agg }))
    }
    return res.json(serialize({ ...tx, legCount: 1, accountCount: 1 }))
  }

  if (req.method === "PATCH") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    type PatchBody = {
      type?: string; amount?: number | null; description?: string; category?: string; tags?: unknown; date?: string; wealth_account_id?: string | null; card_id?: string | null; kind?: string
    }
    const { description, category, tags } = req.body as PatchBody
    // The money fields are `let`: a money-locked row (debt, system, transfer)
    // drops them below once they are proven unchanged, so a relabel writes
    // labels and nothing else.
    let { type, amount, date, wealth_account_id, card_id, kind } = req.body as PatchBody
    if (type !== undefined && !["incoming", "outgoing"].includes(type)) {
      return res.status(400).json({ error: "type must be incoming or outgoing" })
    }
    // kind may flip standard <-> refund on a user row; transfer legs are never
    // edited here (they'd desync from their counterpart) and never become one.
    if (kind !== undefined && !(USER_KINDS as readonly string[]).includes(kind)) {
      return res.status(400).json({ error: "kind must be standard or refund" })
    }
    // null is not "unchanged": it would pass the currency-change check below as
    // an amount restated, and then reach the UPDATE as the text 'null'.
    if (amount === null || (amount !== undefined && !Number.isFinite(Number(amount)))) return res.status(400).json({ error: "amount must be a number" })
    if (amount !== undefined && amountExceedsLimit(amount)) return res.status(400).json({ error: "Amount is too large" })
    // A trashed row is not editable: its balance effect was reversed when it
    // was trashed, so moving the live balance for it here (and again on
    // restore) would count the edit twice.
    const [before] = await db.select().from(transactions).where(and(eq(transactions.id, id), isNull(transactions.deletedAt)))
    if (!before) return res.status(404).json({ error: "Not found" })
    // Rows whose MONEY is owned elsewhere may be relabelled (description,
    // category, tags) but never moved here:
    // - A DEBT REPAYMENT is one group that mixes a principal transfer with
    //   interest and fee expenses, and a row on the debt itself (its system
    //   Opening Balance included) IS the debt's balance: moving either off the
    //   loan erases debt without the engine. Money changes on the debt's page.
    // - Opening Balance / Balance Adjustment DEFINE the account's balance (see
    //   wealth-ledger reversesOnTrash); re-pricing one as if it were income or
    //   an expense moves money the account never had.
    // - Every row a logical transfer owns — both legs AND its fee rows: kind,
    //   direction, amount, date, account and card change only through the
    //   transfer service (reverse and re-create), or the rows desync from each
    //   other and from the header's stored facts. (kind === 'transfer' keeps
    //   legacy header-less legs under the same rule.)
    // Compared by VALUE, not presence: the edit dialogs resend every field
    // unchanged, and a category fix on any of these must still save.
    const lock = (await touchesDebtAccount(before))
      ? { error: "Edit this payment from the debt's page — it keeps principal and interest apart.", code: "debt_group" }
      : before.isSystem
        ? { error: "This entry sets the account's balance — change it from the account's page.", code: "system_row" }
        : before.transferId || before.kind === "transfer"
          ? { error: "A transfer's amount, date, direction or account can't be edited row by row. Reverse the transfer and record it again.", code: "transfer_mutation_requires_transfer_service" }
          : null
    if (lock) {
      const moneyChanged =
        (kind !== undefined && kind !== before.kind) ||
        (type !== undefined && type !== before.type) ||
        (amount !== undefined && Number(amount) !== Number(before.amount)) ||
        (date !== undefined && date !== before.date) ||
        (wealth_account_id !== undefined && wealth_account_id !== before.wealthAccountId) ||
        (card_id !== undefined && (card_id ?? null) !== before.cardId)
      if (moneyChanged) return res.status(409).json(lock)
      kind = type = date = wealth_account_id = card_id = undefined
      amount = undefined
    }
    // The (card, account) pair moves together (api/_lib/cards.ts attributeCard):
    // a card named → its own account; an account named without a card → that
    // account's credit card (if it is one) or no card at all. Only re-resolved
    // when one of them CHANGES: the dialogs resend both unchanged, and a card
    // closed with its archived account must not block a category fix.
    let nextCardId: string | null | undefined
    if ((card_id !== undefined && (card_id ?? null) !== before.cardId) || (wealth_account_id !== undefined && wealth_account_id !== before.wealthAccountId)) {
      const attributed = await attributeCard(orgId, {
        cardId: card_id === undefined ? (wealth_account_id !== undefined ? null : before.cardId) : card_id,
        // A card named on its own moves the row to that card's account.
        wealthAccountId: wealth_account_id !== undefined ? wealth_account_id : card_id ? undefined : before.wealthAccountId,
      })
      if (!attributed.ok) return res.status(400).json({ error: attributed.error })
      wealth_account_id = attributed.accountId
      nextCardId = attributed.cardId
    }
    const nextKind = kind ?? before.kind
    const nextType = type ?? before.type
    if (!refundShapeValid(nextType, nextKind)) return res.status(400).json({ error: "A refund must be incoming" })
    // Per-plan tag ceiling. Only gate when tags are actually being changed, and
    // grandfather an existing over-limit set (previousCount) so editing anything
    // else on a legacy transaction never trips it — only *adding* tags is blocked.
    let cleanedTags: string[] | undefined
    if (tags !== undefined) {
      cleanedTags = cleanTransactionTags(tags)
      const previousCount = Array.isArray(before?.tags) ? before.tags.length : 0
      const tagQuota = await checkTransactionTagQuota(orgId, cleanedTags.length, { previousCount })
      if (!tagQuota.allowed) return res.status(402).json(tagQuota)
    }
    const nextAccountId = wealth_account_id !== undefined ? wealth_account_id : before.wealthAccountId
    const moving = nextAccountId !== before.wealthAccountId
    // A row that stays on its account keeps its own currency — the account may
    // since have been archived (the edit dialogs resend its id unchanged), and
    // that is no reason to refuse a category fix. Only a MOVE, or a legacy row
    // with no stamped currency, reads the account.
    let nextCurrencyCode = moving ? null : before.currencyCode
    if (!nextCurrencyCode) {
      if (nextAccountId) {
        const [account] = await db
          .select({ currencyCode: wealthAccounts.currencyCode, type: wealthAccounts.type, archivedAt: wealthAccounts.archivedAt })
          .from(wealthAccounts)
          .where(and(eq(wealthAccounts.id, nextAccountId), eq(wealthAccounts.organizationId, orgId)))
        if (moving) {
          // The same targets POST and /group refuse, with the same 400 — bad
          // input, not a conflict with the row's state.
          if (!account || account.archivedAt) return res.status(400).json({ error: "Select an active bank or cash account" })
          if (account.type === "space") {
            return res.status(400).json({ error: "You can't record a transaction on a Space — move money in or out with a transfer instead.", code: "space_requires_transfer" })
          }
          if ((DEBT_ACCOUNT_TYPES as readonly string[]).includes(account.type)) {
            return res.status(400).json({ error: "Record a payment from the debt's page instead — that keeps principal and interest apart.", code: "debt_group" })
          }
        }
        nextCurrencyCode = account?.currencyCode ?? null
        if (!nextCurrencyCode) return res.status(409).json({ error: "Account currency migration is incomplete", code: "currency_missing" })
      } else {
        // No account: the row keeps the currency it was recorded in — a later
        // workspace currency change is no reason to relabel ₹50,000 as
        // $50,000. Only a legacy row with none falls back to the workspace's.
        nextCurrencyCode = before.currencyCode ?? (await currencyForFinancialWrite(orgId))
        if (!nextCurrencyCode) return res.status(409).json({ error: "Organization currency migration is incomplete", code: "currency_missing" })
      }
    }
    // Moving to an account in another currency keeps the number and changes
    // what it means (€50 → ₹50), so the same request must restate the amount.
    const currencyRefusal = currencyChangeRefusal(before.currencyCode, nextCurrencyCode, amount !== undefined)
    if (currencyRefusal) return res.status(409).json(currencyRefusal)
    // To the decimals of the currency the row ends up in — only when the amount
    // is restated: the dialogs resend it unchanged, and a legacy ¥1,000.50 row
    // must still take a category fix (MC-031).
    if (amount !== undefined && (Number(amount) !== Number(before.amount) || nextCurrencyCode !== before.currencyCode)) {
      const badAmount = moneyRefusal(nextCurrencyCode, amount)
      if (badAmount) return res.status(400).json(badAmount)
    }
    // Claim-first, pinned to the snapshot the balance math below reads: the
    // UPDATE only lands on a row that is still live AND still has the account,
    // direction and amount `before` saw. A DELETE racing this edit can't leave
    // it moving a trashed row's balance, and a double-submitted or retried save
    // (both reading 10, both writing 15) can't reverse 10 twice — the second
    // finds 15 and is refused instead of drifting the account.
    const claimed = db.$with("claimed").as(
      db
        .update(transactions)
        .set({
          ...(wealth_account_id !== undefined ? { wealthAccountId: wealth_account_id } : {}),
          currencyCode: nextCurrencyCode,
          ...(nextCardId !== undefined ? { cardId: nextCardId } : {}),
          ...(kind !== undefined ? { kind } : {}),
          ...(type !== undefined ? { type } : {}),
          ...(amount !== undefined ? { amount: String(amount) } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(category !== undefined ? { category } : {}),
          ...(cleanedTags !== undefined ? { tags: cleanedTags } : {}),
          ...(date !== undefined ? { date } : {}),
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(and(
          eq(transactions.id, id), isNull(transactions.deletedAt),
          eq(transactions.type, before.type),
          eq(transactions.amount, before.amount),
          before.wealthAccountId ? eq(transactions.wealthAccountId, before.wealthAccountId) : isNull(transactions.wealthAccountId),
        ))
        .returning(),
    )
    // …and the balances move in the SAME statement, from the row it claimed
    // (api/_lib/tx-legs.ts): take back what `before` applied — the WHERE pins
    // the claimed row to exactly that account, direction and amount — and
    // apply what the row says now. Separate UPDATEs left the old account
    // reversed and the new one never credited when the second failed (MC-059).
    // A relabel (and every edit of a money-locked row) moves no money.
    const beforeAccount = sql`${before.wealthAccountId}::uuid`
    const moneyMoved = sql`(wealth_account_id is distinct from ${beforeAccount} or type <> ${before.type} or amount <> ${before.amount}::numeric)`
    const moves = sql`select ${beforeAccount} as wealth_account_id, -${appliedSql(before.type, before.amount)} as delta from claimed where ${moneyMoved}
      union all
      select wealth_account_id, ${appliedSql(sql.raw("type"), sql.raw("amount"))} from claimed where ${moneyMoved}`
    const [updated] = await db.with(claimed, balanceShiftCte(moves, userId)).select().from(claimed)
    if (!updated) {
      return res.status(409).json({ error: "This transaction was changed or deleted while you were editing it. Reload and try again.", code: "transaction_changed" })
    }
    const changes = diffFields(
      before as Record<string, unknown>,
      updated as Record<string, unknown>,
      ["type", "kind", "amount", "description", "category", "tags", "date", "wealthAccountId", "cardId"],
    )
    if (Object.keys(changes).length) await logAudit({ orgId, entityType: "transaction", entityId: id, action: "update", actorId: userId, changes })
    // An edit can push a budget over just as a create can (raising the amount,
    // moving the date into the current window, or flipping income -> expense).
    // Fire-and-forget so alerting can never fail the write.
    if (updated.type === "outgoing" || before.type === "outgoing") {
      void notifyIfBudgetExceeded(orgId, updated.clientId, userId, { category: updated.category, date: updated.date }).catch(() => {})
    }
    return res.json(serialize(updated))
  }

  if (req.method === "DELETE") {
    if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })
    // Soft-delete: the transaction moves to Trash (restorable) rather than vanishing.
    // An already-trashed row is Not found — a replayed DELETE must not reverse
    // its balance a second time.
    const [before] = await db.select().from(transactions).where(and(eq(transactions.id, id), isNull(transactions.deletedAt)))
    if (!before) return res.status(404).json({ error: "Not found" })
    // An Opening Balance / Balance Adjustment DEFINES the balance: trashing it
    // never moved the balance, and purging it later left a balance no row
    // explains (MC-054). Refused like PATCH — setRowsTrashed skips it anyway;
    // this says why instead of a 404.
    if (before.isSystem) {
      return res.status(409).json({ error: "This entry sets the account's balance — change it from the account's page.", code: "system_row" })
    }
    if (before.transferId) {
      // A transfer's FEE row is never trashed on its own — the header still
      // records the fee, so a later Reverse would refund it twice — and it
      // never silently takes its transfer along either: the list shows it as a
      // lone expense, and the split-edit path (DELETE then POST /group) would
      // trash the whole transfer to "replace" a fee. The transfer is deleted
      // from one of its legs.
      if (before.kind !== "transfer") {
        return res.status(409).json({ error: "A transfer fee belongs to its transfer — delete the transfer itself to remove it.", code: "transfer_mutation_requires_transfer_service" })
      }
      // A LEG is the transfer: trash the WHOLE transfer (legs, fee rows, every
      // balance) in one database function, never one row. Legacy legs without
      // a header (ambiguous groups the 0071 backfill left alone) fall through
      // to the group path below, which trashes both legs.
      const result = await setTransferTrashed(orgId, userId, before.transferId, false)
      if (!result.ok) return res.status(result.status).json(result.body)
      return res.status(204).end()
    }

    // A split transaction is one logical entry, so deleting any leg deletes the
    // whole group and reverses each leg's balance. The legs share one client, so
    // the ownership check above covers them all.
    const legIds = before.groupId
      ? (await db
          .select({ id: transactions.id })
          .from(transactions)
          .where(and(eq(transactions.groupId, before.groupId), isNull(transactions.deletedAt)))).map((leg) => leg.id)
      : [id]
    // Claim-first: only the rows this call actually flipped move a balance
    // (system balance-defining rows flip without moving it — reversesOnTrash).
    const trashed = await setRowsTrashed(legIds, userId, false)
    if (trashed.length === 0) return res.status(404).json({ error: "Not found" })

    for (const legId of trashed) {
      await logAudit({ orgId, entityType: "transaction", entityId: legId, action: "delete", actorId: userId })
    }
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}

/** True when this row — or any leg of its ledger group — sits on a loan or receivable account. */
async function touchesDebtAccount(row: { id: string; groupId: string | null }): Promise<boolean> {
  const [hit] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .innerJoin(wealthAccounts, eq(wealthAccounts.id, transactions.wealthAccountId))
    .where(and(row.groupId ? eq(transactions.groupId, row.groupId) : eq(transactions.id, row.id), inArray(wealthAccounts.type, [...DEBT_ACCOUNT_TYPES])))
    .limit(1)
  return !!hit
}
