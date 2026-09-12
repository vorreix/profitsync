import { describe, expect, it } from "vitest"
import {
  autopayEvents,
  buildAlerts,
  cardAlerts,
  daysBetween,
  isoAddDays,
  orderAlerts,
  postedAlerts,
  projectShortfalls,
  recurringAlerts,
  shortfallAlerts,
  upcomingEvents,
  type AlertAccount,
  type AlertCard,
  type AlertPosted,
  type AlertRule,
  type AlertStatement,
} from "./alerts"

const TODAY = "2026-03-10"

const account = (over: Partial<AlertAccount> & { id: string }): AlertAccount => ({
  name: over.id, type: "bank", balanceToday: 1000, creditLimit: null, archived: false, currency: null, ...over,
})
const card = (over: Partial<AlertCard> & { id: string }): AlertCard => ({
  label: `Card ${over.id}`, kind: "credit", status: "active", autopay: false,
  expiryMonth: 12, expiryYear: 2030, accountId: `acct_${over.id}`, creditLimit: 2000,
  currentBalance: -100, fundingAccountId: "bank", autopaySince: null, statement: null, currency: null, ...over,
})
/** A filed statement with autopay's bookkeeping untouched. */
const stmt = (over: Partial<AlertStatement> = {}): AlertStatement => ({
  id: "s1", dueDate: "2026-03-15", remaining: 500, autopayStatus: null, autopayError: null, autopayAt: null, ...over,
})
const rule = (over: Partial<AlertRule> & { id: string }): AlertRule => ({
  name: over.id, type: "outgoing", kind: "standard", amount: 100, accountId: "bank",
  toAccountId: null, cardId: null, anchor: "2026-01-15", freq: { unit: "month", interval: 1 },
  cursor: "2026-03-15", end: null, active: true, lastError: "", currency: null, ...over,
})

describe("upcomingEvents", () => {
  it("charges a card-funded rule to the CARD, never to a bank", () => {
    // The schema guarantees accountId is the card's liability account when
    // cardId is set. Projecting it against a bank would invent a shortfall
    // that cannot happen — the bank is only touched by the statement payment.
    const events = upcomingEvents([rule({ id: "netflix", cardId: "c1", accountId: "acct_c1" })], TODAY, "2026-03-24")
    expect(events).toHaveLength(1)
    expect(events[0].accountId).toBe("acct_c1")
    expect(events[0].delta).toBe(-100)
  })

  it("gives an auto-save transfer both of its legs", () => {
    const events = upcomingEvents([rule({ id: "save", kind: "transfer", toAccountId: "space" })], TODAY, "2026-03-24")
    expect(events.map((e) => [e.accountId, e.delta])).toEqual([["bank", -100], ["space", 100]])
  })

  it("credits an incoming rule", () => {
    const events = upcomingEvents([rule({ id: "salary", type: "incoming", amount: 3000 })], TODAY, "2026-03-24")
    expect(events[0].delta).toBe(3000)
  })

  it("says nothing about a rule the materializer is already refusing to run", () => {
    // It produces recurring_paused instead — projecting charges that will not
    // happen would make the shortfall maths wrong in the safe direction and the
    // "coming up" slide wrong in the unsafe one.
    expect(upcomingEvents([rule({ id: "blocked", lastError: "account archived" })], TODAY, "2026-03-24")).toEqual([])
  })

  it("skips a cursor left in the past", () => {
    // next_due_at only advances when a money-materialising GET runs, so it sits
    // in the past routinely. That is catch-up, not forecast.
    const events = upcomingEvents([rule({ id: "old", cursor: "2026-02-15" })], TODAY, "2026-03-24")
    expect(events.every((e) => e.date >= TODAY)).toBe(true)
  })

  it("enumerates every occurrence of a frequent rule inside the window", () => {
    const events = upcomingEvents(
      [rule({ id: "daily", freq: { unit: "day", interval: 1 }, anchor: "2026-03-01", cursor: TODAY })],
      TODAY,
      "2026-03-14",
    )
    expect(events).toHaveLength(5) // 10th..14th inclusive
  })

  it("stops at the rule's end date", () => {
    const events = upcomingEvents(
      [rule({ id: "ending", freq: { unit: "day", interval: 1 }, anchor: "2026-03-01", cursor: TODAY, end: "2026-03-11" })],
      TODAY,
      "2026-03-24",
    )
    expect(events.map((e) => e.date)).toEqual(["2026-03-10", "2026-03-11"])
  })

  it("still finds a daily rule whose cursor is months stale", () => {
    // next_due_at only advances when a money-materialising GET runs, so on a
    // workspace nobody has opened it sits far in the past. Enumerating from
    // there would spend the whole occurrence budget on dates before today and
    // drop the rule out of the projection entirely.
    const events = upcomingEvents(
      [rule({ id: "coffee", freq: { unit: "day", interval: 1 }, anchor: "2025-01-01", cursor: "2025-06-01" })],
      TODAY,
      "2026-03-14",
    )
    expect(events.map((e) => e.date)).toEqual(["2026-03-10", "2026-03-11", "2026-03-12", "2026-03-13", "2026-03-14"])
  })

  it("does not charge an occurrence that already posted", () => {
    // A materialising GET can run between this query and the balance read, so
    // today's charge may already be inside current_balance.
    const r = rule({ id: "rent", anchor: "2026-01-10", cursor: TODAY })
    expect(upcomingEvents([r], TODAY, "2026-03-24")).toHaveLength(1)
    expect(upcomingEvents([r], TODAY, "2026-03-24", new Set([`rent:${TODAY}`]))).toEqual([])
  })

  it("ignores inactive rules and zero amounts", () => {
    expect(upcomingEvents([rule({ id: "off", active: false }), rule({ id: "free", amount: 0 })], TODAY, "2026-03-24")).toEqual([])
  })
})

describe("autopayEvents", () => {
  // currentBalance covers the statement, so autopay's clamp is a no-op here.
  const withStatement = card({ id: "c1", autopay: true, currentBalance: -500, statement: stmt({ dueDate: "2026-03-15" }) })

  it("debits the funding bank and credits the card on the due date", () => {
    const events = autopayEvents([withStatement], TODAY, "2026-03-24")
    expect(events).toEqual([
      // `currency` is the card account's native currency — null on this legacy
      // fixture, which is exactly what the renderer falls back on.
      { date: "2026-03-15", accountId: "bank", delta: -500, source: { kind: "autopay", id: "c1", name: "Card c1", currency: null } },
      { date: "2026-03-15", accountId: "acct_c1", delta: 500, source: { kind: "autopay", id: "c1", name: "Card c1", currency: null } },
    ])
  })

  it("still projects a FROZEN card — it owes the statement either way", () => {
    expect(autopayEvents([{ ...withStatement, status: "frozen" }], TODAY, "2026-03-24")).toHaveLength(2)
  })

  it("projects only what autopay will actually pay, clamped to the real debt", () => {
    // A post-close refund left the card owing less than the statement says.
    const events = autopayEvents([{ ...withStatement, currentBalance: -120 }], TODAY, "2026-03-24")
    expect(events.map((e) => e.delta)).toEqual([-120, 120])
    // Switched on after this statement was due: autopay is never paying it, so
    // taking the money out of the bank in the projection would be fiction.
    expect(autopayEvents([{ ...withStatement, autopaySince: "2026-03-20" }], TODAY, "2026-03-24")).toEqual([])
  })

  it("drops a closed card, autopay off, no funding account, and a settled statement", () => {
    expect(autopayEvents([{ ...withStatement, status: "closed" }], TODAY, "2026-03-24")).toEqual([])
    expect(autopayEvents([{ ...withStatement, autopay: false }], TODAY, "2026-03-24")).toEqual([])
    expect(autopayEvents([{ ...withStatement, fundingAccountId: null }], TODAY, "2026-03-24")).toEqual([])
    expect(autopayEvents([{ ...withStatement, statement: stmt({ dueDate: "2026-03-15", remaining: 0 }) }], TODAY, "2026-03-24")).toEqual([])
  })
})

describe("projectShortfalls", () => {
  const src = { kind: "recurring" as const, id: "r1", name: "Rent" }

  it("flags a charge the balance cannot cover", () => {
    const hits = projectShortfalls({
      accounts: [account({ id: "bank", balanceToday: 400 })],
      events: [{ date: "2026-03-12", accountId: "bank", delta: -500, source: src }],
    })
    expect(hits).toEqual([{ accountId: "bank", date: "2026-03-12", short: 100, amount: 500, source: src }])
  })

  it("lets a same-day credit cover a same-day debit", () => {
    // Pay and rent on the same date could settle either way; warning someone
    // they are overdrawn on the day their salary lands is the worse mistake.
    const hits = projectShortfalls({
      accounts: [account({ id: "bank", balanceToday: 100 })],
      events: [
        { date: "2026-03-12", accountId: "bank", delta: -500, source: src },
        { date: "2026-03-12", accountId: "bank", delta: 3000, source: { kind: "recurring", id: "r2", name: "Salary" } },
      ],
    })
    expect(hits).toEqual([])
  })

  it("reports only the FIRST shortfall per account", () => {
    const hits = projectShortfalls({
      accounts: [account({ id: "bank", balanceToday: 100 })],
      events: [
        { date: "2026-03-12", accountId: "bank", delta: -500, source: src },
        { date: "2026-03-13", accountId: "bank", delta: -500, source: { kind: "recurring", id: "r2", name: "Gym" } },
      ],
    })
    expect(hits).toHaveLength(1)
    expect(hits[0].date).toBe("2026-03-12")
  })

  it("measures a credit card against its LIMIT, not against zero", () => {
    // A card is meant to be negative. Its floor is the limit.
    const cardAcct = account({ id: "acct_c1", type: "credit_card", balanceToday: -1800, creditLimit: 2000 })
    expect(projectShortfalls({ accounts: [cardAcct], events: [{ date: "2026-03-12", accountId: "acct_c1", delta: -100, source: src }] })).toEqual([])
    const over = projectShortfalls({ accounts: [cardAcct], events: [{ date: "2026-03-12", accountId: "acct_c1", delta: -300, source: src }] })
    expect(over[0].short).toBe(100)
  })

  it("says nothing about a card with no limit recorded — there is no floor to hit", () => {
    const cardAcct = account({ id: "acct_c1", type: "credit_card", balanceToday: -9000, creditLimit: null })
    expect(projectShortfalls({ accounts: [cardAcct], events: [{ date: "2026-03-12", accountId: "acct_c1", delta: -500, source: src }] })).toEqual([])
  })

  it("ignores archived and unknown accounts", () => {
    expect(projectShortfalls({
      accounts: [account({ id: "bank", balanceToday: 0, archived: true })],
      events: [{ date: "2026-03-12", accountId: "bank", delta: -500, source: src }, { date: "2026-03-12", accountId: "ghost", delta: -500, source: src }],
    })).toEqual([])
  })

  it("does not double-count a transaction already dated in the future", () => {
    // current_balance takes a transaction's delta at CREATE time with no date
    // condition, so a row dated three weeks out is already inside it. The
    // server hands us a balance with those removed and replays them as events;
    // the net effect must be the same balance on the day.
    const scheduled = { date: "2026-03-20", accountId: "bank", delta: -900, source: { kind: "scheduled" as const, id: "t1", name: "Tax" } }
    const hits = projectShortfalls({ accounts: [account({ id: "bank", balanceToday: 1000 })], events: [scheduled] })
    expect(hits).toEqual([])
    const tight = projectShortfalls({ accounts: [account({ id: "bank", balanceToday: 800 })], events: [scheduled] })
    expect(tight[0].short).toBe(100)
  })
})

describe("cardAlerts", () => {
  it("does NOT accuse autopay of failing just because the statement is overdue", () => {
    // Autopay only ever runs inside syncCards, which a read-only alerts route
    // must not call — so an overdue statement on an autopay card usually means
    // autopay has not had its turn, not that it lost it. Blaming it here would
    // be an accusation the data does not support.
    const [a] = cardAlerts([card({ id: "c1", autopay: true, statement: stmt({ dueDate: "2026-03-01" }) })], TODAY)
    expect(a.kind).toBe("card_autopay_scheduled")
  })

  it("blames autopay only where the engine recorded a failure", () => {
    const overdue = (st: Partial<Parameters<typeof stmt>[0]>) =>
      cardAlerts([card({ id: "c1", autopay: true, statement: stmt({ dueDate: "2026-03-01", ...st }) })], TODAY)[0]
    expect(overdue({ autopayStatus: "failed" }).kind).toBe("card_autopay_failed")
    // A deferral it could write a reason for (the quota block).
    expect(overdue({ autopayStatus: null, autopayError: "transaction quota reached" }).kind).toBe("card_autopay_failed")
    // A claim that crashed between the UPDATE and the batch. Only the engine's
    // next run flips it to 'failed', and a read-only route cannot trigger one.
    const stale = Date.parse("2026-03-10T12:00:00Z")
    expect(cardAlerts([card({ id: "c1", autopay: true, statement: stmt({ dueDate: "2026-03-01", autopayStatus: "processing", autopayAt: stale - 60 * 60 * 1000 }) })], TODAY, stale)[0].kind).toBe("card_autopay_failed")
    // …but a fresh claim is simply in flight.
    expect(cardAlerts([card({ id: "c1", autopay: true, statement: stmt({ dueDate: "2026-03-01", autopayStatus: "processing", autopayAt: stale - 1000 }) })], TODAY, stale)[0].kind).toBe("card_autopay_scheduled")
  })

  it("nags to pay by hand a statement autopay was switched on too late to cover", () => {
    // autopayEligible refuses any statement due on or before autopay_since, so
    // this one is never getting paid automatically — promising otherwise would
    // leave the user waiting for a payment that never comes.
    const [a] = cardAlerts([card({ id: "c1", autopay: true, autopaySince: "2026-03-05", statement: stmt({ dueDate: "2026-03-01" }) })], TODAY)
    expect(a.kind).toBe("card_payment_overdue")
    expect(a.severity).toBe("danger")
    expect(a.params.days).toBe(9)
  })

  it("never demands more than the card actually owes", () => {
    // A refund after the close moves the balance but is deliberately not
    // counted as a payment, so `remaining` can outlive the debt.
    const alerts = cardAlerts([card({ id: "c1", currentBalance: -120, expiryMonth: null, expiryYear: null, statement: stmt({ dueDate: "2026-03-01", remaining: 500 }) })], TODAY)
    expect(alerts[0].money?.amount).toBe(120)
    // And with the debt gone entirely, there is nothing left to say.
    expect(cardAlerts([card({ id: "c1", currentBalance: 0, expiryMonth: null, expiryYear: null, statement: stmt({ dueDate: "2026-03-01", remaining: 500 }) })], TODAY)).toEqual([])
  })

  it("points a missed deadline backwards", () => {
    const [a] = cardAlerts([card({ id: "c1", statement: stmt({ dueDate: "2026-03-01" }) })], TODAY)
    expect(a.tense).toBe("past")
    expect(a.params.days).toBe(9)
    const [soon] = cardAlerts([card({ id: "c1", statement: stmt({ dueDate: "2026-03-13" }) })], TODAY)
    expect(soon.tense).toBe("future")
  })

  it("calls it overdue when there is no autopay to blame", () =>{
    const [a] = cardAlerts([card({ id: "c1", statement: stmt({ dueDate: "2026-03-01" }) })], TODAY)
    expect(a.kind).toBe("card_payment_overdue")
  })

  it("does not nag a card whose autopay will handle it", () => {
    const [a] = cardAlerts([card({ id: "c1", autopay: true, statement: stmt({ dueDate: "2026-03-12" }) })], TODAY)
    expect(a.kind).toBe("card_autopay_scheduled")
    expect(a.severity).toBe("info")
    expect(a.dismissible).toBe(true)
  })

  it("warns about a statement due soon, and stays quiet about one that is not", () => {
    expect(cardAlerts([card({ id: "c1", statement: stmt({ id: "s1", dueDate: "2026-03-13", remaining: 500 }) })], TODAY)[0].kind).toBe("card_payment_due_soon")
    expect(cardAlerts([card({ id: "c1", statement: stmt({ id: "s1", dueDate: "2026-03-20", remaining: 500 }) })], TODAY)).toEqual([])
  })

  it("says nothing about a statement already settled", () => {
    expect(cardAlerts([card({ id: "c1", statement: stmt({ id: "s1", dueDate: "2026-03-01", remaining: 0 }) })], TODAY)).toEqual([])
  })

  it("lets an expiring card be waved away, but never an expired one", () => {
    // Nothing to do about next month's expiry but wait for the new card; an
    // EXPIRED card is actively breaking payments and has an action behind it.
    const soon = cardAlerts([card({ id: "c1", expiryMonth: 3, expiryYear: 2026 })], "2026-03-20")[0]
    expect(soon.kind).toBe("card_expiring")
    expect(soon.dismissible).toBe(true)
    const gone = cardAlerts([card({ id: "c1", expiryMonth: 3, expiryYear: 2026 })], "2026-04-01")[0]
    expect(gone.kind).toBe("card_expired")
    expect(gone.dismissible).toBe(false)
  })

  it("never lets an actionable item be waved away", () => {
    const overdue = cardAlerts([card({ id: "c1", expiryMonth: null, expiryYear: null, currentBalance: -500, statement: stmt({ dueDate: "2026-03-01" }) })], TODAY)[0]
    expect(overdue.dismissible).toBe(false)
    const util = cardAlerts([card({ id: "c2", expiryMonth: null, expiryYear: null, creditLimit: 1000, currentBalance: -950 })], TODAY)[0]
    expect(util.dismissible).toBe(false)
  })

  it("treats a card as valid through the LAST day of its expiry month", () =>{
    // 03/2026 is good on the 31st and expired on April 1st.
    expect(cardAlerts([card({ id: "c1", expiryMonth: 3, expiryYear: 2026 })], "2026-03-31")[0].kind).toBe("card_expiring")
    expect(cardAlerts([card({ id: "c1", expiryMonth: 3, expiryYear: 2026 })], "2026-04-01")[0].kind).toBe("card_expired")
  })

  it("ignores a closed card entirely", () => {
    expect(cardAlerts([card({ id: "c1", status: "closed", expiryMonth: 1, expiryYear: 2020, statement: stmt({ id: "s", dueDate: "2020-01-01", remaining: 99 }) })], TODAY)).toEqual([])
  })

  it("raises high utilisation with the credit left", () => {
    const alerts = cardAlerts([card({ id: "c1", creditLimit: 1000, currentBalance: -950, expiryMonth: null, expiryYear: null })], TODAY)
    const util = alerts.find((a) => a.kind === "card_utilization_high")!
    expect(util.params.pct).toBe(95)
    expect(util.money?.available).toBe(50)
  })

  it("cannot report utilisation for a card with no limit", () => {
    expect(cardAlerts([card({ id: "c1", creditLimit: null, currentBalance: -5000, expiryMonth: null, expiryYear: null })], TODAY)).toEqual([])
  })
})

describe("shortfallAlerts", () => {
  const hit = (date: string) => ({ accountId: "bank", date, short: 100, amount: 500, source: { kind: "recurring" as const, id: "r1", name: "Rent" } })

  it("is a danger today and tomorrow, a warning after that", () => {
    expect(shortfallAlerts([hit(TODAY)], [account({ id: "bank", name: "Federal" })], TODAY)[0].severity).toBe("danger")
    expect(shortfallAlerts([hit("2026-03-11")], [account({ id: "bank" })], TODAY)[0].severity).toBe("danger")
    expect(shortfallAlerts([hit("2026-03-12")], [account({ id: "bank" })], TODAY)[0].severity).toBe("warning")
  })

  it("points its day count FORWARD even at danger severity", () => {
    // A charge tomorrow the account cannot cover is a danger, and it is still
    // in the future — reading the tense off the tier printed "1 day ago".
    const [a] = shortfallAlerts([hit("2026-03-11")], [account({ id: "bank" })], TODAY)
    expect(a.severity).toBe("danger")
    expect(a.tense).toBe("future")
    expect(a.params.days).toBe(1)
  })

  it("names the account the money is short in", () =>{
    const [a] = shortfallAlerts([hit("2026-03-12")], [account({ id: "bank", name: "Federal Savings" })], TODAY)
    expect(a.params.account).toBe("Federal Savings")
    expect(a.money).toEqual({ amount: 500, short: 100 })
  })

  it("links an autopay shortfall to the card and a recurring one to its rule", () => {
    const auto = { ...hit("2026-03-12"), source: { kind: "autopay" as const, id: "c1", name: "Visa" } }
    expect(shortfallAlerts([auto], [account({ id: "bank" })], TODAY)[0].link).toBe("/wealth/cards/c1")
    expect(shortfallAlerts([hit("2026-03-12")], [account({ id: "bank" })], TODAY)[0].link).toBe("/recurring/r1")
  })
})

describe("recurringAlerts", () => {
  it("raises a rule that is silently not running", () => {
    const [a] = recurringAlerts([rule({ id: "rent", lastError: "wealth account archived" })], [], new Set(), TODAY)
    expect(a.kind).toBe("recurring_paused")
    expect(a.severity).toBe("warning")
    // The stored reason is English server text — it never reaches a translated
    // sentence. The rules screen shows it in full.
    expect(JSON.stringify(a.params)).not.toContain("archived")
  })

  it("mentions a charge landing within the next few days", () => {
    const events = upcomingEvents([rule({ id: "rent", anchor: "2026-01-12", cursor: "2026-03-01" })], TODAY, "2026-03-24")
    const [a] = recurringAlerts([], events, new Set(), TODAY)
    expect(a.kind).toBe("recurring_upcoming")
    expect(a.params.days).toBe(2)
    expect(a.money?.amount).toBe(100)
  })

  it("stays quiet about a charge that already has a shortfall slide", () => {
    const events = upcomingEvents([rule({ id: "rent", anchor: "2026-01-12", cursor: "2026-03-01" })], TODAY, "2026-03-24")
    expect(events.some((e) => e.date === "2026-03-12")).toBe(true) // the slide would exist
    expect(recurringAlerts([], events, new Set(["rent"]), TODAY)).toEqual([])
  })

  it("mentions a frequent rule once, at its soonest occurrence", () => {
    const events = upcomingEvents([rule({ id: "daily", freq: { unit: "day", interval: 1 }, anchor: "2026-03-01", cursor: TODAY })], TODAY, "2026-03-24")
    const alerts = recurringAlerts([], events, new Set(), TODAY)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].at).toBe(TODAY)
  })

  it("ignores incoming rules — money arriving is not a heads-up", () => {
    const events = upcomingEvents([rule({ id: "salary", type: "incoming", cursor: "2026-03-12" })], TODAY, "2026-03-24")
    expect(recurringAlerts([], events, new Set(), TODAY)).toEqual([])
  })
})

describe("postedAlerts", () => {
  const posted = (over: Partial<AlertPosted>): AlertPosted => ({ ruleId: "r1", ruleName: "Salary", type: "incoming", amount: 3000, date: TODAY, count: 1, currency: null, ...over })

  it("gives incoming money its own wording", () => {
    expect(postedAlerts([posted({})], TODAY)[0].kind).toBe("income_received")
    expect(postedAlerts([posted({ type: "outgoing", ruleName: "Rent" })], TODAY)[0].kind).toBe("recurring_posted")
  })

  it("forgets anything older than the window, and anything dated ahead", () => {
    expect(postedAlerts([posted({ date: "2026-03-01" })], TODAY)).toEqual([])
    expect(postedAlerts([posted({ date: "2026-03-20" })], TODAY)).toEqual([])
    expect(postedAlerts([posted({ date: "2026-03-08" })], TODAY)).toHaveLength(1)
  })

  it("is dismissible — there is nothing to fix", () => {
    expect(postedAlerts([posted({})], TODAY)[0].dismissible).toBe(true)
  })
})

describe("alert money is labelled with the ACCOUNT's currency, never converted", () => {
  // A workspace reporting in EUR with an INR bank account: the shortfall is on
  // the INR account, so its figures are rupees. The banner formats with
  // `alert.currency` and only falls back to the org currency for a legacy row.
  it("a shortfall on an INR account is labelled INR", () => {
    const accounts = [account({ id: "inr", balanceToday: 50, currency: "INR" })]
    const events = upcomingEvents([rule({ id: "rent", accountId: "inr", amount: 500, cursor: "2026-03-12" })], TODAY, "2026-03-24")
    const [a] = shortfallAlerts(projectShortfalls({ accounts, events }), accounts, TODAY)
    expect(a.currency).toBe("INR")
    expect(a.money).toEqual({ amount: 500, short: 450 })
  })

  it("a card alert carries its liability account's currency", () => {
    const [a] = cardAlerts([card({ id: "c1", currency: "INR", currentBalance: -500, statement: stmt({ dueDate: "2026-03-01" }) })], TODAY)
    expect(a.kind).toBe("card_payment_overdue")
    expect(a.currency).toBe("INR")
  })

  it("an upcoming charge and a posted row carry their rule's account currency", () => {
    // Anchored on the 12th so the occurrence lands INSIDE the 3-day upcoming
    // window (a rule anchored on the 15th is projected but not yet "coming up").
    const events = upcomingEvents([rule({ id: "netflix", currency: "INR", anchor: "2026-01-12", cursor: "2026-03-12" })], TODAY, "2026-03-24")
    const [up] = recurringAlerts([], events, new Set(), TODAY)
    expect(up.currency).toBe("INR")
    const [posted] = postedAlerts([{ ruleId: "r1", ruleName: "Salary", type: "incoming", amount: 3000, date: TODAY, count: 1, currency: "INR" }], TODAY)
    expect(posted.currency).toBe("INR")
  })

  it("a legacy account with no tag leaves the currency null for the renderer's fallback", () => {
    const [a] = cardAlerts([card({ id: "c2", currentBalance: -500, statement: stmt({ dueDate: "2026-03-01" }) })], TODAY)
    expect(a.currency).toBeNull()
  })
})

describe("orderAlerts", () => {
  it("puts the worst first, then the soonest, then a stable tiebreak", () => {
    const mk = (id: string, severity: "danger" | "warning" | "info", at?: string) =>
      ({ id, kind: "card_expiring" as const, severity, key: "k", params: {}, at, dismissible: false })
    const ordered = orderAlerts([mk("c", "info", "2026-03-11"), mk("b", "danger", "2026-03-20"), mk("a", "danger", "2026-03-12"), mk("d", "warning")])
    expect(ordered.map((a) => a.id)).toEqual(["a", "b", "d", "c"])
  })

  it("does not reshuffle equal items between refetches", () => {
    const mk = (id: string) => ({ id, kind: "card_expiring" as const, severity: "warning" as const, key: "k", params: {}, dismissible: false })
    const once = orderAlerts([mk("z"), mk("a"), mk("m")]).map((a) => a.id)
    expect(orderAlerts([mk("m"), mk("z"), mk("a")]).map((a) => a.id)).toEqual(once)
  })
})

describe("buildAlerts", () => {
  it("composes the whole picture and caps it", () => {
    const alerts = buildAlerts({
      today: TODAY,
      accounts: [account({ id: "bank", name: "Federal", balanceToday: 200 }), account({ id: "acct_c1", type: "credit_card", balanceToday: -1900, creditLimit: 2000 })],
      cards: [card({ id: "c1", statement: stmt({ id: "s1", dueDate: "2026-03-01", remaining: 500 }), currentBalance: -1900, expiryMonth: 3, expiryYear: 2026 })],
      rules: [rule({ id: "rent", amount: 900, anchor: "2026-01-12", cursor: "2026-03-01" })],
      posted: [{ ruleId: "sal", ruleName: "Salary", type: "incoming", amount: 3000, date: TODAY, count: 1, currency: null }],
    })
    const kinds = alerts.map((a) => a.kind)
    expect(kinds[0]).toBe("card_payment_overdue") // danger leads
    expect(kinds).toContain("charge_shortfall")
    expect(kinds).toContain("income_received")
    // The rent has a shortfall slide, so it does not also get a "coming up" one.
    expect(kinds).not.toContain("recurring_upcoming")
    expect(alerts.length).toBeLessThanOrEqual(6)
  })

  it("is empty for a workspace where nothing is wrong", () => {
    expect(buildAlerts({
      today: TODAY,
      accounts: [account({ id: "bank", balanceToday: 100_000 })],
      cards: [card({ id: "c1", expiryMonth: 12, expiryYear: 2032, currentBalance: 0, statement: null })],
      rules: [rule({ id: "rent", cursor: "2026-06-15" })],
      posted: [],
    })).toEqual([])
  })

  it("does not warn about a charge beyond the horizon, but still discounts it from today", () => {
    // The baseline has ALL future-dated rows removed — money earmarked for a
    // payment dated next year is not money you have today — but a charge that
    // far out is not something to raise now.
    const farOff = { date: "2027-01-01", accountId: "bank", delta: -5000, source: { kind: "scheduled" as const, id: "t1", name: "Tax" } }
    const alerts = buildAlerts({ today: TODAY, accounts: [account({ id: "bank", balanceToday: -4000 })], cards: [], rules: [], posted: [], scheduled: [farOff] })
    expect(alerts).toEqual([])
  })

  it("does not call the bigger later charge on a short account 'coming up'", () => {
    // The walk stops at the first hit per account, so keying the suppression
    // off the recorded shortfall alone would leave the rent showing calm blue
    // behind a £15 subscription that tripped it.
    const alerts = buildAlerts({
      today: TODAY,
      accounts: [account({ id: "bank", name: "Federal", balanceToday: 10 })],
      cards: [],
      rules: [
        rule({ id: "netflix", amount: 15, anchor: "2026-01-11", cursor: "2026-03-01" }),
        rule({ id: "rent", amount: 900, anchor: "2026-01-12", cursor: "2026-03-01" }),
      ],
      posted: [],
    })
    expect(alerts.map((a) => a.kind)).not.toContain("recurring_upcoming")
    expect(alerts.filter((a) => a.kind === "charge_shortfall")).toHaveLength(1)
  })

  it("obeys the cap even when everything is on fire", () =>{
    const cards = Array.from({ length: 10 }, (_, i) =>
      card({ id: `c${i}`, accountId: `acct_c${i}`, currentBalance: -500, statement: stmt({ id: `s${i}`, dueDate: "2026-03-01" }) }))
    expect(buildAlerts({ today: TODAY, accounts: [], cards, rules: [], posted: [] })).toHaveLength(6)
  })
})

describe("date helpers", () => {
  it("counts whole days across a month boundary", () => {
    expect(daysBetween("2026-02-27", "2026-03-02")).toBe(3) // 2026 is not a leap year
    expect(daysBetween("2026-03-10", "2026-03-01")).toBe(-9)
  })

  it("adds days in UTC", () => {
    expect(isoAddDays("2026-02-27", 3)).toBe("2026-03-02")
    expect(isoAddDays("2026-12-31", 1)).toBe("2027-01-01")
  })
})
