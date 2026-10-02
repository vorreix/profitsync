import { randomUUID } from "node:crypto"
import Decimal from "decimal.js"
import { and, count, eq, isNull, notInArray, sql, type SQL } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { clients, transactions, wealthAccounts } from "../../src/lib/db/schema.js"
import { ensureDefaultClient, isPersonalAccount, type OrgAuth } from "./auth.js"
import { getOrgPlan } from "./quota.js"
import { cleanTransactionTags } from "../../src/lib/transaction-tags.js"
import { PREMIUM_TAGS_PER_TX } from "../../src/lib/tags.js"
import { amountExceedsLimit, moneyRefusal } from "../../src/lib/money.js"
import { refundShapeValid } from "../../src/lib/tx-classify.js"
import { USER_KINDS } from "./tx-sql.js"
import { attributeCard } from "./cards.js"
import { splitCurrencyRefusal } from "./currency-guards.js"

// The ONE write path of a "split" transaction — one logical entry (same client /
// type / category / description / date) paid from one OR several accounts,
// every account-leg its own `transactions` row sharing a `group_id`. Both
// POST /api/transactions/group (create) and PUT /api/transactions/group/:groupId
// (replace, MC-046) validate and post through here, so an edit can never accept
// what a create refuses.

type AllocationInput = { wealth_account_id?: string; account_id?: string; card_id?: string | null; amount?: number | string }

export type GroupBody = {
  client_id?: string
  type?: string
  kind?: string
  description?: string
  category?: string
  tags?: unknown
  date?: string
  allocations?: AllocationInput[]
}

/** The split being replaced: its live leg ids, and what it says for every field the edit leaves out. */
export type Replacing = { ids: string[]; clientId: string; kind: string; tags: string[]; description: string; category: string; date: string }

export type GroupLeg = { id: string; accountId: string; cardId: string | null; amount: number; currencyCode: string | null }
export type PreparedGroup = {
  clientId: string
  type: string
  kind: string
  description: string
  category: string
  tags: string[]
  date: string
  legs: GroupLeg[]
}
type Refusal = { ok: false; status: number; body: Record<string, unknown> }

/** Validate a split body against the org and resolve every leg — reads only, writes nothing. */
export async function prepareGroup(ctx: OrgAuth, body: GroupBody, replacing?: Replacing): Promise<{ ok: true; group: PreparedGroup } | Refusal> {
  const { userId, orgId } = ctx
  const refuse = (status: number, refusal: Record<string, unknown>): Refusal => ({ ok: false, status, body: refusal })
  const { client_id, type, description, category, tags, date, allocations, kind: rawKind } = body
  // Group-level metadata, like description/category: every leg carries it. An
  // edit that sends no tags keeps the split's own (the client page's dialog
  // has no tag field — re-posting it used to wipe them).
  const cleanTags = tags === undefined && replacing ? replacing.tags : cleanTransactionTags(tags)

  if (!type || !["incoming", "outgoing"].includes(type)) return refuse(400, { error: "type must be incoming or outgoing" })
  // 'standard' (default) or 'refund' (money back for an earlier expense — nets
  // against expense in reporting, never income). Transfers never come from here.
  // An edit that names no kind keeps the split's own while it still fits.
  const kind = rawKind ?? (replacing && refundShapeValid(type, replacing.kind) ? replacing.kind : "standard")
  if (!(USER_KINDS as readonly string[]).includes(kind)) return refuse(400, { error: "kind must be standard or refund" })
  if (!refundShapeValid(type, kind)) return refuse(400, { error: "A refund must be incoming" })
  if (!Array.isArray(allocations) || allocations.length === 0) return refuse(400, { error: "allocations is required" })

  const rawLegs = allocations
    .map((a) => ({ accountId: a.wealth_account_id ?? a.account_id ?? "", cardId: a.card_id ?? null, amount: Number(a.amount) }))
    .filter((a) => (a.accountId || a.cardId) && !isNaN(a.amount) && a.amount > 0)
  if (rawLegs.length === 0) return refuse(400, { error: "At least one allocation with an account and a positive amount is required" })
  if (rawLegs.some((leg) => amountExceedsLimit(leg.amount))) return refuse(400, { error: "Amount is too large" })

  // Resolve which card paid each leg and therefore which account the money
  // lands on (api/_lib/cards.ts attributeCard — one rule for every write path).
  const legs: GroupLeg[] = []
  for (const leg of rawLegs) {
    const attributed = await attributeCard(orgId, { cardId: leg.cardId, wealthAccountId: leg.accountId || null })
    if (!attributed.ok) return refuse(400, { error: attributed.error })
    if (!attributed.accountId) return refuse(400, { error: "Select an active bank or cash account" })
    legs.push({ id: randomUUID(), accountId: attributed.accountId, cardId: attributed.cardId, amount: leg.amount, currencyCode: null })
  }

  // Validate every referenced account is an active, org-scoped account.
  const orgAccounts = await db
    .select()
    .from(wealthAccounts)
    .where(and(eq(wealthAccounts.organizationId, orgId), isNull(wealthAccounts.archivedAt)))
  const byId = new Map(orgAccounts.map((a) => [a.id, a]))
  for (const leg of legs) {
    const account = byId.get(leg.accountId)
    if (!account) return refuse(400, { error: "Select an active bank or cash account" })
    // A Space is a savings bucket — money only ever TRANSFERS in/out of it.
    if (account.type === "space") return refuse(400, { error: "You can't record a transaction on a Space — move money in or out with a transfer instead." })
    // A debt's principal and interest have to be split, which only the debt's
    // own payment route does — a raw transaction here would blur them.
    if (account.type === "loan" || account.type === "receivable") return refuse(400, { error: "Record a payment from the debt's page instead — that keeps principal and interest apart." })
    leg.currencyCode = account.currencyCode
  }
  // One purchase, one currency — the API is the trust boundary, not the
  // picker. The split EDIT validates here too, so an edit can't mix currencies.
  const currencyRefusal = splitCurrencyRefusal(legs.map((leg) => leg.currencyCode))
  if (currencyRefusal) return refuse(currencyRefusal.status, currencyRefusal.body)
  // Every leg to that one currency's decimals: the row would round 1.235 while
  // the balance shift adds it unrounded (MC-047), and ¥ has none.
  const badAmount = moneyRefusal(legs[0].currencyCode, ...legs.map((leg) => leg.amount))
  if (badAmount) return refuse(400, badAmount)

  // Resolve the anchoring client (personal orgs use their hidden default client).
  let clientId: string
  if (isPersonalAccount(ctx)) {
    clientId = await ensureDefaultClient(orgId, userId)
  } else {
    const wanted = client_id ?? replacing?.clientId
    if (!wanted) return refuse(400, { error: "client_id is required" })
    const [client] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, wanted), eq(clients.organizationId, orgId), isNull(clients.deletedAt)))
    if (!client) return refuse(403, { error: "Forbidden" })
    clientId = wanted
  }

  // Quota: the whole group must fit under the per-client transaction limit.
  const { planKey, limits } = await getOrgPlan(orgId)
  // Per-plan tag ceiling (free = 1, paid = 3). Every leg shares the group's tags,
  // so one check on the deduped set covers the whole split. An edit keeps an
  // existing over-limit set (grandfathered, like PATCH) — only ADDING is blocked.
  if (cleanTags.length > limits.tagsPerTransaction && cleanTags.length > (replacing?.tags.length ?? 0)) {
    return refuse(402, {
      allowed: false,
      reason:
        planKey === "free"
          ? `Free plan allows ${limits.tagsPerTransaction} tag${limits.tagsPerTransaction === 1 ? "" : "s"} per transaction. Upgrade to Premium for up to ${PREMIUM_TAGS_PER_TX}.`
          : `This plan allows ${limits.tagsPerTransaction} tags per transaction.`,
      limit: limits.tagsPerTransaction,
      current: cleanTags.length,
      upgradeHint: planKey === "free",
    })
  }
  if (planKey === "free") {
    // The legs being replaced are about to go — they don't count against the edit.
    const [{ current }] = await db
      .select({ current: count() })
      .from(transactions)
      .where(and(
        eq(transactions.clientId, clientId), isNull(transactions.deletedAt),
        ...(replacing?.ids.length ? [notInArray(transactions.id, replacing.ids)] : []),
      ))
    if (current + legs.length > limits.transactionsPerClient) {
      return refuse(402, {
        allowed: false,
        reason: `Free plan is limited to ${limits.transactionsPerClient} transactions per client. Upgrade to Premium.`,
        limit: limits.transactionsPerClient,
        current,
        upgradeHint: true,
      })
    }
  }

  return {
    ok: true,
    group: {
      clientId,
      type,
      kind,
      description: description ?? replacing?.description ?? "",
      category: category ?? replacing?.category ?? "",
      tags: cleanTags,
      date: date ?? replacing?.date ?? new Date().toISOString().split("T")[0],
      legs,
    },
  }
}

/** Net balance change per account (incoming +, outgoing −): two legs on one account collapse into one shift. Exact decimals. */
export function legShifts(type: string, legs: readonly { accountId: string; amount: number | string }[]): Map<string, Decimal> {
  const shifts = new Map<string, Decimal>()
  for (const leg of legs) {
    const delta = new Decimal(leg.amount).times(type === "incoming" ? 1 : -1)
    shifts.set(leg.accountId, (shifts.get(leg.accountId) ?? new Decimal(0)).plus(delta))
  }
  return shifts
}

/**
 * The statements that post a prepared group, for ONE dbBatch: the legs (one
 * multi-row INSERT, returning them), then one relative balance UPDATE per
 * account. Only a real multi-leg split gets a group_id; a single account stays
 * NULL so the rest of the app treats it as an ordinary transaction.
 *
 * created_at is stamped a millisecond apart: inside one batch `now()` is the
 * same for every leg, and the list opens a split by its EARLIEST leg (ties on
 * a random id) — the leg its attachments live on must be that one.
 */
export function postGroupStatements(group: PreparedGroup, userId: string, opts: { recurringRuleId?: string | null } = {}) {
  const groupId = group.legs.length > 1 ? randomUUID() : null
  const base = Date.now()
  const insert = db
    .insert(transactions)
    .values(group.legs.map((leg, i) => ({
      id: leg.id,
      clientId: group.clientId,
      wealthAccountId: leg.accountId,
      cardId: leg.cardId,
      groupId,
      kind: group.kind,
      type: group.type,
      amount: String(leg.amount),
      currencyCode: leg.currencyCode,
      description: group.description,
      category: group.category,
      tags: group.tags,
      date: group.date,
      recurringRuleId: opts.recurringRuleId ?? null,
      // isSystem is server-only: user-created split legs are never system rows.
      createdBy: userId,
      updatedBy: userId,
      createdAt: new Date(base + i),
      updatedAt: new Date(base + i),
    })))
    .returning()
  // Accounts are locked in ONE global order (by id) by every split write, so two
  // concurrent splits over A and B in opposite orders queue instead of deadlocking.
  const shifts = [...legShifts(group.type, group.legs)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([accountId, shift]) =>
    db
      .update(wealthAccounts)
      .set({ currentBalance: sql`${wealthAccounts.currentBalance}::numeric + ${shift.toFixed()}::numeric`, updatedBy: userId, updatedAt: new Date() })
      .where(eq(wealthAccounts.id, accountId)),
  )
  return { groupId, insert, shifts }
}

/**
 * Hard-delete the legs a split edit replaces and take their balance effect
 * back out — CLAIM-FIRST, in ONE statement: the reversal is summed from the
 * rows the DELETE actually removed, never from the list read before, and the
 * statement divides by zero (failing the whole batch it runs in) unless it
 * removed EVERY one of them. So a double-submitted save, a stale tab or a
 * delete racing the edit finds the legs already gone and rolls back — nothing
 * is reversed twice and no second copy of the new legs lands. Transfer-owned
 * and system rows never match (they move only through their own services).
 */
export function claimReplacedLegsSql(ids: string[], userId: string) {
  const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)
  return sql`
    with gone as (
      delete from transactions
      where id in (${idList}) and deleted_at is null and transfer_id is null and not is_system and kind <> 'transfer'
      returning wealth_account_id, type, amount
    ), shifts as (
      select wealth_account_id, sum(case when type = 'incoming' then amount else -amount end) as applied
      from gone
      where wealth_account_id is not null
      group by wealth_account_id
    ), reversed as (
      update wealth_accounts wa
      set current_balance = wa.current_balance - shifts.applied, updated_by = ${userId}, updated_at = now()
      from shifts
      where wa.id = shifts.wealth_account_id
    )
    select 1 / ((select count(*) from gone) = ${ids.length}::int)::int as claimed`
}

/**
 * The first statements of a split EDIT's batch — every lock it will need,
 * taken before it writes anything:
 * 1. the legs being replaced, FOR UPDATE: an attachment upload holds the FK's
 *    KEY SHARE on its leg, so one already in flight commits first and is moved
 *    with the rest, and a later one waits and then fails its FK instead of
 *    being cascaded away silently with the old leg;
 * 2. every account the edit moves (the old legs' — read under that lock, so a
 *    concurrent re-point can't slip past — and the new legs'), in id order:
 *    the same order postGroupStatements updates them in, so concurrent split
 *    writes over the same accounts queue instead of deadlocking. NO KEY UPDATE
 *    doesn't block a plain insert's FK check, but does block a currency change.
 */
export function lockReplacingSql(oldIds: string[], newAccountIds: string[]): SQL[] {
  const list = (ids: string[]) => sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)
  return [
    sql`select id from transactions where id in (${list(oldIds)}) order by id for update`,
    sql`select id from wealth_accounts
      where id in (${list(newAccountIds)}) or id in (select wealth_account_id from transactions where id in (${list(oldIds)}))
      order by id for no key update of wealth_accounts`,
  ]
}

/** The first Postgres error in a driver's cause chain matching `code` (and `constraint`, when named). */
function pgErrorIs(err: unknown, code: string, constraint?: string): boolean {
  let e: unknown = err
  for (let i = 0; i < 4 && e && typeof e === "object"; i++) {
    const o = e as { code?: unknown; constraint?: unknown; message?: unknown; cause?: unknown }
    if (o.code === code && (!constraint || o.constraint === constraint || (typeof o.message === "string" && o.message.includes(constraint)))) return true
    e = o.cause
  }
  return false
}

/**
 * True when a split write lost a race and the whole batch rolled back:
 * claimReplacedLegsSql's guard (22012 — the legs changed or went), or a leg's
 * account changing currency between the read and the commit (the deferred
 * transactions_account_currency_fk, mig 0081). Either way nothing was written
 * and the screen acted on a stale copy — the caller answers 409
 * `transaction_changed`, a stale refusal the client reloads on.
 */
export function groupWriteWentStale(err: unknown): boolean {
  return pgErrorIs(err, "22012") || pgErrorIs(err, "23503", "transactions_account_currency_fk")
}
