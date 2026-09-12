// What needs your attention, right now.
//
// The model behind the banner carousel in the app shell. Pure — plain rows in,
// alert descriptors out — so every rule is unit-tested (alerts.test.ts) without
// a database, like the recurring and credit-card math it composes.
// `api/_lib/alerts.ts` supplies the rows; `src/components/alerts/` renders them.
//
// Three decisions shape everything else:
//
//  1. AN ALERT IS A STATE, NOT AN EVENT. Nothing here reads the notifications
//     table. A notification is an immutable log row — "this happened" — so a
//     banner built on one keeps saying "card payment overdue" after the card is
//     paid, until someone marks it read. Every item below is re-derived from
//     current data on each request and disappears the moment it stops being
//     true. Even the two that look like events ("salary credited", "rent
//     posted") are read back out of the ledger over a short window, so trashing
//     that transaction takes the banner with it.
//
//  2. DATES ARE UTC ISO STRINGS. The same convention as src/lib/recurring.ts
//     and src/lib/credit-card.ts, which this builds on. The app has one notion
//     of "today"; a second one here would make the banner disagree with the
//     screen it links to.
//
//  3. THE BASELINE IS AS-OF-TODAY, NOT `current_balance`. A transaction posts
//     its balance delta the moment it is created, with no date condition
//     (api/_routes/transactions.ts), so a row dated three weeks out is ALREADY
//     inside `current_balance`. Adding future charges to that number
//     double-counts them — which is how a projection ends up announcing a
//     shortfall that cannot happen. The server hands us a balance with those
//     rows removed and replays them as dated events instead.

import { autopayAmount, autopayEligible, expiryEndIso, expiryLabel } from "./cards.js"
import { cardDebt, creditUsage } from "./credit-card.js"
import { occurrencesDue, type Frequency } from "./recurring.js"

export type AlertSeverity = "danger" | "warning" | "info" | "success" | "promo"

export type AlertKind =
  | "card_payment_overdue"
  | "card_autopay_failed"
  | "charge_shortfall"
  | "card_expired"
  | "card_payment_due_soon"
  | "card_expiring"
  | "card_utilization_high"
  | "recurring_paused"
  | "card_autopay_scheduled"
  | "recurring_upcoming"
  | "recurring_posted"
  | "income_received"
  /** The admin-controlled referral message — client-side, never from the server. */
  | "referral"

/**
 * One banner slide. `key` addresses `alerts.<key>.title` / `.body`, mirroring
 * how a notification renders (src/components/notifications/notification-ui.tsx).
 *
 * The copy is deliberately NOT reused from `notifications.types.*` even where
 * the subject matches. Those strings are notification-shaped — full sentences
 * sized for a two-line row — and two of them cannot be translated correctly in
 * a banner: `card_payment_due_soon.body` hard-codes "({{days}} day(s))" with no
 * i18next plural form, which Arabic's six plural categories have no way into,
 * and `card_autopay_failed.body` interpolates a server-built English `{{reason}}`
 * into an otherwise translated sentence.
 */
export type Alert = {
  /** Stable across loads for the same situation, so a dismissal sticks. */
  id: string
  kind: AlertKind
  severity: AlertSeverity
  key: string
  params: Record<string, string | number>
  /** Amount params to render in the org's currency rather than as bare numbers. */
  money?: Record<string, number>
  /** Where tapping the slide goes. */
  link?: string
  /** When it happens or happened — orders items within a severity. */
  at?: string
  /**
   * Which way `params.days` points. Explicit rather than inferred: a shortfall
   * on a charge landing TOMORROW is a danger too, and reading the tense off the
   * severity turned that into "1 day ago".
   */
  tense?: "past" | "future"
  /**
   * Can this be waved away?
   *
   * Not a function of severity — of whether there is anything to DO right now.
   * An overdue payment, a shortfall, an expired card and a paused rule all
   * have an action behind them, so they clear by being FIXED and nothing else;
   * that is the whole point of deriving them fresh. A card expiring next month
   * has no action today, and nagging about it on every visit for a month is
   * how someone learns to stop reading the rail.
   */
  dismissible: boolean
}

/** How far ahead to look for charges that might not go through. */
export const HORIZON_DAYS = 14
/** A statement due within this many days is worth raising. */
export const DUE_SOON_DAYS = 3
/** A recurring charge landing within this many days is worth mentioning. */
export const UPCOMING_DAYS = 3
/** How long a posted transaction stays worth mentioning. */
export const POSTED_WINDOW_DAYS = 2
/** Utilisation at or above this is worth raising. */
export const UTILIZATION_ALERT = 0.9
/**
 * Nobody swipes through more than a handful. Past this the carousel stops being
 * a summary and becomes a list nobody reads; the overflow lives on the screens
 * the slides link to.
 */
export const MAX_ALERTS = 6

const SEVERITY_RANK: Record<AlertSeverity, number> = { danger: 0, warning: 1, info: 2, success: 3, promo: 4 }
export const severityRank = (s: AlertSeverity): number => SEVERITY_RANK[s]

const round2 = (n: number): number => Math.round(n * 100) / 100

/** Whole days from `from` to `to`, both UTC ISO dates. Negative = in the past. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

// ── Input rows ───────────────────────────────────────────────────────────────
// Deliberately narrow: only what an alert needs, already converted out of the
// numeric strings Drizzle returns.

export type AlertAccount = {
  id: string
  name: string
  type: "bank" | "cash" | "space" | "credit_card"
  /** AS OF TODAY — see decision 3 in the header. Not the raw column. */
  balanceToday: number
  creditLimit: number | null
  archived: boolean
}

export type AlertCard = {
  id: string
  /** "Federal Visa •••• 1234" — built server-side by cardLabel(). */
  label: string
  kind: "debit" | "credit"
  status: "active" | "frozen" | "closed"
  autopay: boolean
  expiryMonth: number | null
  expiryYear: number | null
  /** The ledger account this card IS (credit) or posts to (debit). */
  accountId: string
  creditLimit: number | null
  currentBalance: number
  /** Credit only: the account the statement is paid from. */
  fundingAccountId: string | null
  /** When autopay was switched on. Statements due on or before it are never autopaid. */
  autopaySince: string | null
  /** The newest closed statement, with autopay's own bookkeeping on it. */
  statement: AlertStatement | null
}

export type AlertStatement = {
  id: string
  dueDate: string
  /** Statement balance minus payments after the close. Clamped against the card's real debt before use. */
  remaining: number
  /** null | processing | paid | failed | skipped — autopay's claim state machine. */
  autopayStatus: string | null
  /** Set when autopay deferred for a reason it could record (a quota block). */
  autopayError: string | null
  /** When the claim was made — a `processing` claim older than STALE_CLAIM_MS crashed. */
  autopayAt: number | null
}

/**
 * A `processing` claim with no transfer group, older than this, is a crash
 * between the claim and the batch. The engine only flips it to `failed` on its
 * next run (api/_lib/card-autopay.ts reconcileStaleClaims), which a read-only
 * route cannot trigger — so this classifies it.
 */
export const STALE_CLAIM_MS = 10 * 60 * 1000

export type AutopayOutlook = "pending" | "failed" | "none"

/**
 * Is autopay going to deal with this statement, did it try and lose, or is it
 * not autopay's problem?
 *
 * This is the difference between two very different sentences, and getting it
 * wrong writes a false one. Autopay only ever runs inside `syncCards`, which a
 * read-only alerts route must not call — so an overdue statement on an autopay
 * card usually means autopay has not had its turn yet, NOT that it failed.
 * Blaming it then would be an accusation the data does not support.
 *
 * Failure is only claimed where the engine actually recorded one: a `failed`
 * status, a deferral it wrote a reason for, or a claim that crashed mid-flight.
 */
export function autopayOutlook(card: AlertCard, statement: AlertStatement, nowMs: number): AutopayOutlook {
  const st = statement.autopayStatus
  if (st === "failed") return "failed"
  if (st === null && statement.autopayError) return "failed" // deferred, reason recorded
  if (st === "processing") {
    return statement.autopayAt !== null && nowMs - statement.autopayAt > STALE_CLAIM_MS ? "failed" : "pending"
  }
  // Everything else is the engine's own eligibility rule, reused verbatim so
  // the banner can never disagree with what autopay will actually do — it is
  // what knows that a statement due before autopay was switched on is never
  // going to be paid by it.
  return autopayEligible(
    { autopay: card.autopay, autopay_since: card.autopaySince, funding_account_id: card.fundingAccountId, status: card.status },
    { id: statement.id, due_date: statement.dueDate, remaining: statement.remaining, autopay_status: statement.autopayStatus },
  )
    ? "pending"
    : "none"
}

export type AlertRule = {
  id: string
  name: string
  type: "incoming" | "outgoing"
  kind: "standard" | "transfer"
  amount: number
  /** The account the money leaves (or arrives in, for an incoming rule). */
  accountId: string | null
  /** Transfer rules only: where the money lands. */
  toAccountId: string | null
  cardId: string | null
  anchor: string
  freq: Frequency
  /** next_due_at — the first occurrence not yet materialized. */
  cursor: string
  end: string | null
  active: boolean
  /** Why the last materialization skipped this rule. Empty = healthy. */
  lastError: string
}

/** A recurring transaction that actually landed, grouped by rule and day. */
export type AlertPosted = {
  ruleId: string
  ruleName: string
  type: "incoming" | "outgoing"
  amount: number
  date: string
  count: number
}

// ── The forward projection ───────────────────────────────────────────────────

export type ProjectionSource = { kind: "recurring" | "autopay" | "scheduled"; id: string; name: string }

export type ProjectionEvent = {
  date: string
  accountId: string
  /** Signed change to that account's balance. */
  delta: number
  source: ProjectionSource
}

export type Shortfall = {
  accountId: string
  date: string
  /** How much is missing when the charge lands, as a positive number. */
  short: number
  /** The charge that trips it. */
  amount: number
  source: ProjectionSource
}

/**
 * Every occurrence of every rule between `today` and `until`, as signed account
 * movements.
 *
 * The card-funded case is the one worth stating: the schema guarantees a rule's
 * `accountId` IS the card's liability account when `cardId` is set, so the
 * charge never touches a bank on the day it lands — it grows the card's debt,
 * and the bank is only touched later by the statement payment. Projecting it
 * against a bank would invent a shortfall that cannot happen.
 */
export function upcomingEvents(rules: AlertRule[], today: string, until: string, alreadyPosted?: ReadonlySet<string>): ProjectionEvent[] {
  const events: ProjectionEvent[] = []
  for (const rule of rules) {
    if (!rule.active || !rule.accountId || rule.amount <= 0) continue
    // A rule the materializer is already refusing to run will not produce these
    // charges. It gets `recurring_paused` instead of a phantom projection.
    if (rule.lastError) continue
    const { due } = occurrencesDue({
      anchor: rule.anchor,
      freq: rule.freq,
      // Clamp the cursor forward. `next_due_at` only advances when one of the
      // money-materialising GETs runs, so on a workspace nobody has opened for
      // a while it sits months in the past — and a daily rule would then spend
      // its whole occurrence budget on dates before today and vanish from the
      // projection entirely.
      cursor: rule.cursor > today ? rule.cursor : today,
      until,
      end: rule.end,
      // A daily rule across the horizon is the worst case; the cap is a
      // backstop against a malformed frequency, not a product limit.
      cap: HORIZON_DAYS + 2,
    })
    const source: ProjectionSource = { kind: "recurring", id: rule.id, name: rule.name }
    for (const date of due) {
      if (date < today) continue
      // An occurrence that already posted is inside `current_balance` — a
      // materialising GET may have run between this query and the balance read.
      // Projecting it again charges the same money twice.
      if (alreadyPosted?.has(`${rule.id}:${date}`)) continue
      const outgoing = rule.type === "outgoing"
      events.push({ date, accountId: rule.accountId, delta: outgoing ? -rule.amount : rule.amount, source })
      // An auto-save moves money: the receiving Space gains it the same day.
      if (rule.kind === "transfer" && rule.toAccountId) {
        events.push({ date, accountId: rule.toAccountId, delta: rule.amount, source })
      }
    }
  }
  return events
}

/**
 * Autopay as a future debit. When it is on, the funding bank is debited for the
 * statement on its due date — a charge like any other, and the one most easily
 * forgotten when working out whether the money will be there.
 *
 * A frozen card still owes its statement, so it stays in the projection; only a
 * closed card (or one with no funding account) drops out.
 */
export function autopayEvents(cards: AlertCard[], today: string, until: string, nowMs = Date.now()): ProjectionEvent[] {
  const events: ProjectionEvent[] = []
  for (const card of cards) {
    if (card.kind !== "credit" || !card.fundingAccountId) continue
    const s = card.statement
    if (!s) continue
    if (s.dueDate < today || s.dueDate > until) continue
    // Only a statement autopay will actually pay is a future debit. One due
    // before autopay was switched on never will be, and projecting it would
    // take money out of the bank that is never leaving it.
    if (autopayOutlook(card, s, nowMs) !== "pending") continue
    const owed = autopayAmount(s.remaining, cardDebt(card.currentBalance))
    if (owed <= 0) continue
    const source: ProjectionSource = { kind: "autopay", id: card.id, name: card.label }
    events.push({ date: s.dueDate, accountId: card.fundingAccountId, delta: -owed, source })
    events.push({ date: s.dueDate, accountId: card.accountId, delta: owed, source })
  }
  return events
}

/**
 * Walk each account's balance forward and report the first charge it cannot
 * cover.
 *
 * Only the FIRST per account: once an account is short, every later charge is
 * short too, and six slides saying so is noise. The earliest is also the only
 * one still worth acting on.
 *
 * Same-day ordering puts credits before debits. That is a real choice — a
 * salary and a rent payment dated the same day could settle either way, and
 * telling someone they are about to be overdrawn on the day their pay lands is
 * the more annoying way to be wrong.
 */
export function projectShortfalls(input: { accounts: AlertAccount[]; events: ProjectionEvent[] }): Shortfall[] {
  const byId = new Map(input.accounts.map((a) => [a.id, a]))
  const balance = new Map(input.accounts.map((a) => [a.id, a.balanceToday]))
  const hit = new Map<string, Shortfall>()

  const ordered = [...input.events].sort((a, b) => (a.date === b.date ? b.delta - a.delta : a.date < b.date ? -1 : 1))

  for (const e of ordered) {
    const account = byId.get(e.accountId)
    if (!account || account.archived) continue
    const next = round2((balance.get(e.accountId) ?? 0) + e.delta)
    balance.set(e.accountId, next)
    if (e.delta >= 0 || hit.has(e.accountId)) continue

    const room = headroom(account, next)
    if (room === null || room >= 0) continue
    hit.set(e.accountId, { accountId: e.accountId, date: e.date, short: round2(-room), amount: round2(-e.delta), source: e.source })
  }
  return [...hit.values()]
}

/**
 * How much room is left before an account runs out, negative once it has run
 * out. For a credit card that is the credit still available, not the balance —
 * a card is *meant* to be negative and its floor is the limit. With no usable
 * limit recorded there is no floor to hit, so nothing can be said.
 *
 * This deliberately does NOT use `availableCredit()`, which clamps at zero so
 * an over-limit card reads as "0 available". That is the right answer to show
 * someone and the wrong one to project with: clamped, the number can never go
 * negative and a card overrun could never be detected at all.
 */
function headroom(account: AlertAccount, balance: number): number | null {
  if (account.type !== "credit_card") return balance
  const limit = account.creditLimit
  if (limit === null || limit <= 0) return null
  return round2(limit + balance)
}

// ── Builders: current state → alerts ─────────────────────────────────────────

const cardLink = (id: string) => `/wealth/cards/${id}`

/**
 * Credit-card alerts. Within one card the statement produces at most ONE item:
 * a card that is overdue does not also say "due soon", and one whose autopay
 * will handle it does not get nagged to pay it by hand.
 */
export function cardAlerts(cards: AlertCard[], today: string, nowMs = Date.now()): Alert[] {
  const out: Alert[] = []
  for (const card of cards) {
    if (card.status === "closed") continue
    const link = cardLink(card.id)
    const s = card.statement

    // What the statement can actually still demand. A refund landing after the
    // close moves the card's balance but is deliberately NOT counted as a
    // payment (src/lib/credit-card.ts), so `remaining` can outlive the debt —
    // and a banner that demands money already back in the account is the worst
    // kind of wrong. This is the same clamp the autopay engine applies before
    // moving anything.
    const owed = s ? autopayAmount(s.remaining, cardDebt(card.currentBalance)) : 0

    if (card.kind === "credit" && s && owed > 0) {
      const days = daysBetween(today, s.dueDate)
      const outlook = autopayOutlook(card, s, nowMs)
      const base = { card: card.label, date: s.dueDate }
      if (outlook === "failed") {
        out.push({ id: `card_autopay_failed:${s.id}`, kind: "card_autopay_failed", severity: "danger", key: "card_autopay_failed", params: { ...base, days: Math.abs(days) }, money: { amount: owed }, link, at: s.dueDate, tense: "past", dismissible: false })
      } else if (outlook === "pending") {
        // Autopay owns this one. Saying "pay your card" next to a payment the
        // app is about to make itself is how a banner teaches people to ignore
        // it.
        out.push({ id: `card_autopay:${s.id}`, kind: "card_autopay_scheduled", severity: "info", key: "card_autopay_scheduled", params: { ...base, days }, money: { amount: owed }, link, at: s.dueDate, tense: "future", dismissible: true })
      } else if (days < 0) {
        out.push({ id: `card_overdue:${s.id}`, kind: "card_payment_overdue", severity: "danger", key: "card_payment_overdue", params: { ...base, days: -days }, money: { amount: owed }, link, at: s.dueDate, tense: "past", dismissible: false })
      } else if (days <= DUE_SOON_DAYS) {
        out.push({ id: `card_due:${s.id}`, kind: "card_payment_due_soon", severity: "warning", key: "card_payment_due_soon", params: { ...base, days }, money: { amount: owed }, link, at: s.dueDate, tense: "future", dismissible: false })
      }
    }

    if (card.expiryMonth && card.expiryYear) {
      // A card is good through the LAST day of its expiry month.
      const end = expiryEndIso(card.expiryMonth, card.expiryYear)
      const days = daysBetween(today, end)
      const expiry = expiryLabel(card.expiryMonth, card.expiryYear)
      if (days < 0) {
        out.push({ id: `card_expired:${card.id}`, kind: "card_expired", severity: "danger", key: "card_expired", params: { card: card.label, expiry }, link, at: end, dismissible: false })
      } else if (days <= 30) {
        // Closable, unlike every other warning: there is nothing to DO about a
        // card expiring next month except wait for the replacement to arrive.
        // Snoozing is 7 days and the id carries the expiry, so it comes back a
        // few times as the date nears and disappears for good once the new
        // card's dates are saved.
        out.push({ id: `card_expiring:${card.id}:${expiry}`, kind: "card_expiring", severity: "warning", key: "card_expiring", params: { card: card.label, expiry, days }, link, at: end, dismissible: true })
      }
    }

    if (card.kind === "credit" && card.status === "active") {
      const usage = creditUsage(card.creditLimit, card.currentBalance)
      if (usage.utilization !== null && usage.available !== null && usage.utilization >= UTILIZATION_ALERT) {
        out.push({
          id: `card_util:${card.id}`,
          kind: "card_utilization_high",
          severity: "warning",
          key: "card_utilization_high",
          params: { card: card.label, pct: Math.round(usage.utilization * 100) },
          money: { available: usage.available },
          link,
          dismissible: false,
        })
      }
    }
  }
  return out
}

/** A charge the account will not cover — the "you won't have enough" case. */
export function shortfallAlerts(shortfalls: Shortfall[], accounts: AlertAccount[], today: string): Alert[] {
  const name = new Map(accounts.map((a) => [a.id, a.name]))
  return shortfalls.map((s) => {
    const days = daysBetween(today, s.date)
    return {
      id: `shortfall:${s.accountId}:${s.date}:${s.source.id}`,
      kind: "charge_shortfall" as const,
      // Today or tomorrow there is nothing left to arrange; further out there is.
      severity: days <= 1 ? ("danger" as const) : ("warning" as const),
      key: "charge_shortfall",
      params: { name: s.source.name, account: name.get(s.accountId) ?? "", date: s.date, days },
      money: { amount: s.amount, short: s.short },
      tense: "future",
      // Symmetrical with autopay → its card: a recurring charge opens the rule
      // that will make it (`scheduled` has no page of its own).
      link: s.source.kind === "autopay" ? cardLink(s.source.id) : s.source.kind === "recurring" ? `/recurring/${s.source.id}` : "/recurring",
      at: s.date,
      dismissible: false,
    }
  })
}

/**
 * Recurring alerts: what is about to happen, and what silently is not.
 *
 * `recurring_paused` never interpolates the stored reason. `last_error` is free
 * text written in English by the server; dropping it into an Arabic or Tamil
 * sentence would leave an untranslated clause inside a translated one. The rule
 * screen shows the reason in full — the banner's job is to say that a payment
 * everyone assumes is running is not.
 */
export function recurringAlerts(rules: AlertRule[], events: ProjectionEvent[], covered: Set<string>, today: string): Alert[] {
  const out: Alert[] = []
  for (const rule of rules) {
    if (!rule.active) continue
    if (rule.lastError) {
      out.push({ id: `recurring_paused:${rule.id}`, kind: "recurring_paused", severity: "warning", key: "recurring_paused", params: { name: rule.name }, link: `/recurring/${rule.id}`, dismissible: false })
    }
  }

  // The soonest upcoming occurrence per rule, when nothing is wrong with it —
  // a rule already flagged as short says the more important thing instead.
  const soonest = new Map<string, ProjectionEvent>()
  for (const e of events) {
    if (e.source.kind !== "recurring" || e.delta >= 0) continue
    if (covered.has(e.source.id)) continue
    const days = daysBetween(today, e.date)
    if (days < 0 || days > UPCOMING_DAYS) continue
    const prev = soonest.get(e.source.id)
    if (!prev || e.date < prev.date) soonest.set(e.source.id, e)
  }
  for (const e of soonest.values()) {
    out.push({
      id: `recurring_upcoming:${e.source.id}:${e.date}`,
      kind: "recurring_upcoming",
      severity: "info",
      key: "recurring_upcoming",
      params: { name: e.source.name, date: e.date, days: daysBetween(today, e.date) },
      money: { amount: -e.delta },
      tense: "future",
      link: `/recurring/${e.source.id}`,
      at: e.date,
      dismissible: true,
    })
  }
  return out
}

/**
 * What landed on its own in the last couple of days. Incoming gets its own
 * wording: "your salary arrived" is the good news people actually want, and
 * calling it "a recurring transaction posted" buries it.
 */
export function postedAlerts(posted: AlertPosted[], today: string): Alert[] {
  return posted
    .filter((p) => daysBetween(p.date, today) <= POSTED_WINDOW_DAYS && p.date <= today)
    .map((p) => ({
      id: `posted:${p.ruleId}:${p.date}`,
      kind: (p.type === "incoming" ? "income_received" : "recurring_posted") as AlertKind,
      severity: "success" as const,
      key: p.type === "incoming" ? "income_received" : "recurring_posted",
      params: { name: p.ruleName, date: p.date, count: p.count },
      money: { amount: p.amount },
      link: "/transactions",
      at: p.date,
      dismissible: true,
    }))
}

/**
 * Order the finished list: worst first, then soonest, then stable by id so a
 * refetch never reshuffles slides under a thumb.
 */
export function orderAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort((a, b) => {
    const s = severityRank(a.severity) - severityRank(b.severity)
    if (s !== 0) return s
    const at = (a.at ?? "9999-12-31").localeCompare(b.at ?? "9999-12-31")
    if (at !== 0) return at
    return a.id.localeCompare(b.id)
  })
}

/** Everything, composed: rows in, the finished ordered slide list out. */
export function buildAlerts(input: {
  today: string
  accounts: AlertAccount[]
  cards: AlertCard[]
  rules: AlertRule[]
  posted: AlertPosted[]
  /** Transactions dated after today, already removed from `balanceToday`. */
  scheduled?: ProjectionEvent[]
  /** `${ruleId}:${date}` for occurrences that have already materialized. */
  alreadyPosted?: ReadonlySet<string>
  max?: number
  nowMs?: number
}): Alert[] {
  const nowMs = input.nowMs ?? Date.now()
  const until = isoAddDays(input.today, HORIZON_DAYS)
  const events = [
    ...upcomingEvents(input.rules, input.today, until, input.alreadyPosted),
    ...autopayEvents(input.cards, input.today, until, nowMs),
    // Already-dated rows are bounded to the horizon like everything else. The
    // BASELINE still has all of them removed — money sitting in an account for
    // a payment dated next year is not money you have today — but a charge
    // beyond the horizon is not something to warn about now.
    ...(input.scheduled ?? []).filter((e) => e.date >= input.today && e.date <= until),
  ]
  const shortfalls = projectShortfalls({ accounts: input.accounts, events })

  // Anything landing on an account that goes short is already spoken for by a
  // shortfall slide. Keying this off the recorded hits alone would leave the
  // LARGER later charge on the same account showing a calm "coming up" — the
  // walk stops at the first hit per account, so the rent behind the £15
  // subscription would look fine.
  const short = new Set(shortfalls.map((s) => s.accountId))
  const covered = new Set(events.filter((e) => short.has(e.accountId)).map((e) => e.source.id))

  const alerts = [
    ...cardAlerts(input.cards, input.today, nowMs),
    ...shortfallAlerts(shortfalls, input.accounts, input.today),
    ...recurringAlerts(input.rules, events, covered, input.today),
    ...postedAlerts(input.posted, input.today),
  ]
  return orderAlerts(alerts).slice(0, input.max ?? MAX_ALERTS)
}

/** `date` + `n` days, as a UTC ISO date. */
export function isoAddDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}
