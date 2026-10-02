// The repair half of scripts/audit-balances.mjs (MC-061): the ledger formula,
// the rules deciding what may be repaired, and the exact statements --apply
// runs. No DB connection here, so the rules are unit-tested
// (audit-balances-repair.test.ts) and the statements can be replayed inside a
// rolled-back transaction before anyone runs them for real.

export const ACTOR = "operator:audit-balances"
// The explanatory row a balance repair posts. Category "Adjustment" is what the
// app's own Balance Adjustment rows carry (api/_routes/wealth/accounts/[id].ts),
// so every reader already treats it as a system row; the description says why
// it exists. NEVER category "Opening Balance": the ledger formula keys on it.
export const RECONCILIATION_DESCRIPTION = "Ledger reconciliation"
export const RECONCILIATION_CATEGORY = "Adjustment"

// An account's Opening Balance row. Category OR description: both are written
// "Opening Balance" (api/_lib/wealth-accounts.ts, debts.ts) and either can be
// relabelled later (PATCH /api/transactions/:id, a category rename cascade) —
// missing it would count the opening twice, row + column fallback.
const IS_OPENING = `t.is_system and 'Opening Balance' in (t.category, t.description)`

// The ledger an account's stored balance should equal (rules in the header of
// audit-balances.mjs). A lateral over `wa`: an aggregate with no GROUP BY
// yields one row even for an account with no transactions, so the
// opening_balance fallback always applies.
export const LEDGER = `
  select
    coalesce(sum(case when t.type = 'incoming' then t.amount else -t.amount end)
      filter (where t.deleted_at is null or t.is_system), 0)
      + case when coalesce(bool_or(${IS_OPENING}), false) then 0 else wa.opening_balance end
      as expected,
    count(*) filter (where t.deleted_at is null) as live_rows,
    count(*) filter (where t.deleted_at is not null) as trashed_rows,
    bool_or(${IS_OPENING}) as has_opening
  from transactions t
  where t.wealth_account_id = wa.id`

const short = (id) => String(id).slice(0, 8)

/**
 * What --apply may write, from the audit's findings. Pure.
 *
 * A drifting account gets ONE system row for exactly its drift, in its own
 * currency, so stored == ledger without rewriting current_balance — unless a
 * finding the tool cannot explain touches it: then the drift may BE that
 * finding (a fee row that never posted, a transfer missing a leg) and papering
 * over it would hide the bug. Those are refused with their reasons.
 *
 * Transfer repairs, the only two that need no judgement:
 *   - markTrashed: a completed header still live while every row it owns is
 *     trashed (the 0071 backfill over already-trashed legacy transfers, MC-116)
 *     — the same statement as migration 0080.
 *   - deleteHeaders: a completed header with no rows at all (their rows were
 *     purged by the pre-fix purge), created before migration 0080 and linked to
 *     no reversal. A row-less header newer than that is a new bug: reported.
 * Everything else (one-sided trash, a header-less group, a missing leg or fee
 * row, a row in another currency) is reported and blocks its accounts — a
 * header that is not whole is never moved to Trash even when every row it has
 * left is: restoring it would re-apply one side only.
 *
 * Also refused: an account with no Opening Balance row but a non-zero
 * opening_balance column. The ledger then ASSUMES the column (legacy account,
 * purged row) — a guess the report may show but a write must not rest on.
 *
 * `only` limits the plan to one account (--apply <accountId>): its row, and
 * the header repairs on transfers it is a side of.
 */
export function repairPlan({ accounts, broken, trashMismatch, headerless, mismatched, only = null }) {
  const blocked = new Map()
  const block = (ids, why) => {
    for (const id of ids ?? []) if (id) blocked.set(id, [...(blocked.get(id) ?? []), why])
  }
  const inScope = (ids) => !only || (ids ?? []).includes(only)

  const deleteHeaders = []
  const notWhole = new Set()
  for (const h of broken) {
    if (h.rows === 0 && h.legacy && !h.linked) {
      if (inScope(h.accounts)) deleteHeaders.push(h.id)
    } else {
      notWhole.add(h.id)
      block(h.accounts, `transfer ${short(h.id)} is not whole (legs ${h.legs}, fee ${h.fee} vs fee rows ${h.fee_rows})`)
    }
  }
  const markTrashed = []
  for (const h of trashMismatch) {
    if (!h.all_trashed) block(h.accounts, `transfer ${short(h.id)} is partly in Trash`)
    else if (!notWhole.has(h.id) && inScope(h.accounts)) markTrashed.push(h.id)
  }
  for (const g of headerless) block(g.accounts, `transfer group ${short(g.id)} has no header`)
  for (const r of mismatched) block([r.account], `row ${short(r.id)} is in ${r.row_ccy}, not the account's currency`)

  const posts = []
  const refused = []
  for (const a of accounts) {
    if (!a.drifted || (only && a.id !== only)) continue
    const reasons = [
      ...(a.currency_code ? [] : ["the account has no currency"]),
      ...(!a.has_opening && Number(a.opening_balance) !== 0
        ? [`no Opening Balance row — the ledger assumes the opening_balance column (${a.opening_balance}); fix by hand`]
        : []),
      ...new Set(blocked.get(a.id) ?? []),
      ...(a.own_client ? [] : ["the workspace has no own client to post on"]),
    ]
    if (reasons.length) {
      refused.push({ account: a, reasons })
      continue
    }
    // drift = stored − ledger, exact numeric text: positive means the ledger is
    // short, so the row is incoming; never through a float.
    const negative = a.drift_exact.startsWith("-")
    posts.push({
      account: a,
      type: negative ? "outgoing" : "incoming",
      amount: negative ? a.drift_exact.slice(1) : a.drift_exact,
    })
  }
  return { posts, refused, markTrashed, deleteHeaders }
}

// ── The statements --apply runs, in ONE Serializable transaction ─────────────

// Aborts the whole transaction (division by zero) when a planned account's
// drift or currency changed since the plan was printed: what gets posted is
// exactly what was shown. $1 ids, $2 drifts (exact), $3 currencies.
export const GUARD_SQL = `
  select 1 / (case when count(*) = 0 then 1 else 0 end) as ok
  from unnest($1::uuid[], $2::numeric[], $3::text[]) p(id, drift, ccy)
  left join wealth_accounts wa on wa.id = p.id
  left join lateral (${LEDGER}) l on true
  where wa.id is null or wa.current_balance - l.expected <> p.drift or wa.currency_code is distinct from p.ccy`

// One system row per account for its drift (current_balance untouched — the
// row EXPLAINS the stored balance) plus its audit entry. $1 ids, $2 drifts,
// $3 currencies, $4 own-client ids, $5 actor.
export const POST_SQL = `
  with p as (
    select * from unnest($1::uuid[], $2::numeric[], $3::text[], $4::uuid[]) p(id, drift, ccy, client)
  ), ins as (
    insert into transactions (client_id, wealth_account_id, type, amount, currency_code, description, category, date, is_system, created_by, updated_by)
    select p.client, p.id, case when p.drift > 0 then 'incoming' else 'outgoing' end, abs(p.drift), p.ccy,
      '${RECONCILIATION_DESCRIPTION}', '${RECONCILIATION_CATEGORY}', current_date, true, $5, $5
    from p
    returning id, wealth_account_id
  ), log as (
    insert into audit_logs (organization_id, entity_type, entity_id, action, actor_user_id, changes)
    select wa.organization_id, 'transaction', ins.id, 'create', $5,
      jsonb_build_object('reason', 'ledger_reconciliation', 'drift', p.drift::text)
    from ins join p on p.id = ins.wealth_account_id join wealth_accounts wa on wa.id = ins.wealth_account_id
    returning 1
  )
  select (select count(*) from ins)::int as posted, (select count(*) from log)::int as logged`

// Migration 0080's statement, limited to the planned headers ($1): only a
// WHOLE transfer (two legs, fee rows = the header's fee) is moved to Trash.
export const MARK_TRASHED_SQL = `
  update transfers h set deleted_at = r.trashed_at
  from (
    select transfer_id, max(deleted_at) as trashed_at,
      coalesce(sum(amount) filter (where kind <> 'transfer' and type = 'outgoing'), 0) as fee_rows
    from transactions
    where transfer_id = any($1::uuid[])
    group by transfer_id
    having bool_and(deleted_at is not null) and count(*) filter (where kind = 'transfer') = 2
  ) r
  where h.id = r.transfer_id and h.status = 'completed' and h.deleted_at is null and r.fee_rows = h.source_fee_amount
  returning h.id`

// Every condition re-checked at write time. $1 ids, $2 cutoff (epoch seconds).
export const DELETE_HEADERS_SQL = `
  delete from transfers h
  where h.id = any($1::uuid[]) and h.status = 'completed'
    and not exists (select 1 from transactions t where t.transfer_id = h.id)
    and h.created_at < (to_timestamp($2::double precision) at time zone 'UTC')
    and h.reverses_transfer_id is null
    and not exists (select 1 from transfers r where r.reverses_transfer_id = h.id)
  returning h.id`

/** [sql, params] pairs for a plan, in order; empty when there is nothing to write. */
export function applyStatements(plan, cutoffSeconds) {
  const out = []
  if (plan.posts.length) {
    const ids = plan.posts.map((p) => p.account.id)
    const drifts = plan.posts.map((p) => p.account.drift_exact)
    const ccys = plan.posts.map((p) => p.account.currency_code)
    out.push([GUARD_SQL, [ids, drifts, ccys]])
    out.push([POST_SQL, [ids, drifts, ccys, plan.posts.map((p) => p.account.own_client), ACTOR]])
  }
  if (plan.markTrashed.length) out.push([MARK_TRASHED_SQL, [plan.markTrashed]])
  if (plan.deleteHeaders.length) out.push([DELETE_HEADERS_SQL, [plan.deleteHeaders, cutoffSeconds]])
  return out
}
