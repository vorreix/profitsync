// The CACHE POLICY: how long a GET may be reused, whether it may ever be
// written to disk, and which reads a write makes wrong.
//
// Pure and dependency-free on purpose — no browser APIs, no React — so every
// rule is unit-tested (api-cache.test.ts) and scripts/check-cache-map.mjs can
// read the same tables the app runs on. src/lib/api.ts applies them; nothing
// else should need to know they exist.
//
// The three ideas, in the order they matter:
//
//  1. SIDE-EFFECTING GETS. Nine routes MATERIALISE money while serving a read:
//     they post due recurring transactions, file credit-card statements and run
//     autopay. Serving one of those from cache and skipping the request means
//     someone's rent never posts. They may paint from cache, but the request
//     ALWAYS goes out (`alwaysFetch`).
//  2. WHAT REACHES DISK IS A SHORT LIST. A body is disqualified if it carries a
//     balance — a stale number on a finance screen is a wrong number, and one
//     read off disk minutes later is worse — OR if it decides what the user
//     sees, which is the one that catches people out (see PERSIST_ALLOWLIST).
//     What is left — the organization list and the category/tag config — is
//     enough to have part of the shell in hand before the first request.
//  3. A WRITE INVALIDATES WHAT IT ACTUALLY CHANGED. Not everything (the old
//     default, which made every screen refetch after any edit) and not just the
//     obvious path (which leaves stale balances behind).

export type FreshnessClass = "identity" | "config" | "money" | "derived" | "admin" | "no-store"

export type CachePolicy = {
  cls: FreshnessClass
  /** Reuse without touching the network for this long (ms). */
  fresh: number
  /** Beyond `fresh`, still paint this copy while revalidating behind it (ms). 0 = never. */
  maxStale: number
  /** May this response be written to storage and survive a reload? */
  persist: boolean
  /**
   * Always send the request, even on a fresh hit. For the reads that WRITE
   * money on the server — skipping one skips a due payment.
   */
  alwaysFetch: boolean
}

const SECOND = 1000
const MINUTE = 60 * SECOND

/**
 * GET routes whose handler materialises recurring transactions, files
 * statements or runs autopay. Verified against the source: every file under
 * api/_routes that imports materializeDueRecurring or syncCards and can be
 * reached by a client GET. Keep in step — scripts/check-cache-map.mjs re-derives
 * this from the API source and fails if the two disagree.
 */
export const ALWAYS_FETCH = [
  "/api/transactions",
  "/api/wealth/accounts",
  "/api/spaces",
  "/api/cards",
  "/api/recurring",
  "/api/calendar",
  "/api/flow",
  // Materialises due recurring rows before summing, so the month's rent is in
  // the figure even when this is the first screen opened today.
  "/api/spending-budgets",
] as const

/**
 * Responses that may be written to storage. DEFAULT-DENY: anything not listed
 * stays in memory and dies with the tab.
 *
 * Two things disqualify a body, and the second is easy to miss:
 *
 *   1. It carries a balance. A stale number on a finance screen is a wrong
 *      number, and one read off disk minutes later is worse.
 *   2. IT DECIDES WHAT THE USER SEES. `/api/profile` looks like the safest
 *      thing in the app and is not: it carries `current_organization_id`, the
 *      ACTIVE WORKSPACE. Off disk, it puts you back in the workspace you left —
 *      switch on your phone, open your laptop tab, and the old one loads. On a
 *      personal-only route (`/spaces`) the guard then redirects you away
 *      before the fresh copy has landed, so the correction never gets a chance
 *      to show. Same reasoning keeps `/api/admin/me` (which gates a whole
 *      console) in memory.
 *
 * The organizations LIST stays: which workspaces exist, and what each one is,
 * doesn't change under you — only which one is selected does, and that isn't
 * here.
 */
export const PERSIST_ALLOWLIST = ["/api/organizations", "/api/categories", "/api/tags"] as const

/**
 * Never reuse, not even within a single tick: one-shot, metered, or
 * credential-bearing. A cached presigned URL is a dead link or a too-long-lived
 * one; a cached AI answer is a charge for nothing.
 *
 * Match these narrowly. `/api/ai/` as a prefix looks right and is not: it also
 * catches `/api/ai/quota`, an ordinary credit-balance read that four separate
 * components ask for on one page load — with no reuse that was four identical
 * requests every time a screen opened.
 */
export const NO_STORE = [
  "/api/attachments/",
  "/api/client-attachments/",
  "/api/quotation-attachments/",
  "/api/wealth-account-attachments/",
  "/api/billing/invoice-pdf",
  "/api/account/delete",
  "/api/ai/parse-transaction",
  "/api/ai/assistant",
  "/api/ai/transcribe",
  "/api/wealth/bank-search",
] as const

/** Reads that must never be served stale: their body drives a decision. */
export const NO_STALE = [
  // The attention banner states things like "card payment overdue". Its whole
  // justification over the notification log is that it is true RIGHT NOW, so it
  // is the one read that must never be painted stale — and it is cheap to
  // refetch, being a summary of one screen.
  "/api/alerts",
] as const

const startsWithAny = (path: string, list: readonly string[]) => list.some((p) => path === p || path.startsWith(p))

/** The path without its query string — policy is per resource, keys are per URL. */
export function basePath(path: string): string {
  const q = path.indexOf("?")
  return q === -1 ? path : path.slice(0, q)
}

/**
 * The policy for one GET path. Order matters: the most specific rule wins, so
 * no-store is checked before the class prefixes and /api/admin/me (identity)
 * before /api/admin (cross-org, never cached hard).
 */
export function policyFor(path: string): CachePolicy {
  const p = basePath(path)
  const alwaysFetch = startsWithAny(p, ALWAYS_FETCH)

  if (startsWithAny(p, NO_STORE)) {
    return { cls: "no-store", fresh: 0, maxStale: 0, persist: false, alwaysFetch: false }
  }

  // Identity. `persist` here is only a permission — PERSIST_ALLOWLIST above has
  // the final say, and it withholds the two whose bodies steer the app
  // (`/api/profile` picks the workspace, `/api/admin/me` opens a console).
  // Those still get the long in-memory window, which is where most of the win
  // is: it collapses a page load's repeat asks into one request.
  if (p === "/api/profile" || p === "/api/organizations" || p === "/api/admin/me") {
    return { cls: "identity", fresh: 5 * MINUTE, maxStale: 30 * MINUTE, persist: true, alwaysFetch: false }
  }
  if (p === "/api/categories" || p === "/api/tags") {
    return { cls: "config", fresh: 5 * MINUTE, maxStale: 60 * MINUTE, persist: true, alwaysFetch: false }
  }

  // Everything under /api/admin is cross-org and capability-gated: short reuse
  // to collapse a burst, never stale, never persisted.
  if (p.startsWith("/api/admin")) {
    return { cls: "admin", fresh: 15 * SECOND, maxStale: 0, persist: false, alwaysFetch: false }
  }

  if (startsWithAny(p, NO_STALE)) {
    return { cls: "money", fresh: 15 * SECOND, maxStale: 0, persist: false, alwaysFetch }
  }

  if (
    startsWithAny(p, [
      "/api/transactions",
      "/api/clients",
      "/api/wealth",
      "/api/wealth-accounts",
      "/api/spaces",
      "/api/cards",
      "/api/recurring",
      "/api/analytics",
      "/api/calendar",
      "/api/flow",
      "/api/budgets",
      "/api/debts",
      "/api/spending-budgets",
      "/api/trash",
      "/api/alerts",
    ])
  ) {
    // 15s of reuse collapses the burst a single navigation makes; past that the
    // copy may still paint, but only while a revalidation is in flight behind it.
    return { cls: "money", fresh: 15 * SECOND, maxStale: 2 * MINUTE, persist: false, alwaysFetch }
  }

  // Search, audit, quotations, notifications, quotas, billing pricing: real
  // data, but nothing anyone reads a balance off.
  return { cls: "derived", fresh: 30 * SECOND, maxStale: 5 * MINUTE, persist: false, alwaysFetch }
}

export const canPersist = (path: string) => policyFor(path).persist && startsWithAny(basePath(path), PERSIST_ALLOWLIST)

// ── Which reads does a write make wrong? ─────────────────────────────────────

/**
 * Anything that moves money touches all of this. A single transaction can shift
 * several account balances, a card's derived statement, budget spend, and every
 * aggregate built from the ledger — so the honest answer to "what did that
 * change?" is nearly always this whole set.
 *
 * Exported because it is also the set worth dropping when a tab comes back
 * after a long time away — see DataRefreshProvider.
 */
export const MONEY_PREFIXES = [
  "/api/transactions",
  "/api/clients",
  "/api/wealth",
  "/api/wealth-accounts",
  "/api/spaces",
  "/api/cards",
  "/api/recurring",
  "/api/analytics",
  "/api/calendar",
  "/api/flow",
  "/api/budgets",
  // Spending budgets carry live spend, so anything that moves money moves them.
  "/api/spending-budgets",
  // A debt IS a wealth account, and its progress, status and debt-free date are
  // all derived from the ledger — so every money move can change them.
  "/api/debts",
  "/api/search",
  "/api/audit",
  "/api/trash",
  // The attention banner is derived from all of the above, so anything that
  // moves money changes it. Leaving it out is how the banner ends up still
  // saying "card payment overdue" on the screen the user just paid from.
  "/api/alerts",
]

/** A write path → the GET prefixes it invalidates. First match wins. */
const FANOUT: { match: RegExp; drop: string[] }[] = [
  // Money, in every shape it is written.
  { match: /^\/api\/transactions\b/, drop: MONEY_PREFIXES },
  { match: /^\/api\/wealth\/transfer\b/, drop: MONEY_PREFIXES },
  { match: /^\/api\/wealth\b/, drop: MONEY_PREFIXES },
  { match: /^\/api\/wealth-accounts\b/, drop: MONEY_PREFIXES },
  { match: /^\/api\/spaces\b/, drop: MONEY_PREFIXES },
  { match: /^\/api\/cards\b/, drop: MONEY_PREFIXES },
  { match: /^\/api\/debts\b/, drop: MONEY_PREFIXES },
  { match: /^\/api\/recurring\b/, drop: MONEY_PREFIXES },
  { match: /^\/api\/clients\b/, drop: [...MONEY_PREFIXES, "/api/quotations"] },
  { match: /^\/api\/trash\b/, drop: [...MONEY_PREFIXES, "/api/quotations"] },
  { match: /^\/api\/budgets\b/, drop: [...MONEY_PREFIXES, "/api/notifications"] },
  // A spending-budget edit moves no money: it changes the budgets, their audit
  // trail, and (through the alert dedupe) what the bell may say next.
  { match: /^\/api\/spending-budgets\b/, drop: ["/api/spending-budgets", "/api/audit", "/api/notifications"] },

  // Creating a category (the exact path) only inserts a row: nothing that was
  // read before is wrong afterwards. The budget dialog creates categories
  // inline, so this must not fall through to the rename rule below and empty
  // every money screen for the sake of one new chip.
  { match: /^\/api\/categories$/, drop: ["/api/categories"] },

  // A category or tag rename is not a config edit. PUT /api/categories/combined
  // rewrites `category` on transactions, clients AND quotations in one go, and
  // spending budgets match on lowered category names, so spend physically moves
  // budget. It is a re-attribution of money and everything derived from it.
  { match: /^\/api\/(categories|tags)\b/, drop: [...MONEY_PREFIXES, "/api/categories", "/api/tags", "/api/quotations"] },

  { match: /^\/api\/quotations\b/, drop: ["/api/quotations", "/api/clients", "/api/search", "/api/trash", "/api/audit"] },
  { match: /^\/api\/notifications\b/, drop: ["/api/notifications"] },

  // An AI call parses text; it does not post the transaction. What it DOES
  // change is the org's credit balance (charged on success) and, for the
  // assistant, the ask history. Before this rule it fell through to a full
  // purge, so every quick-add threw away every screen's data to record a
  // credit deduction.
  { match: /^\/api\/ai\b/, drop: ["/api/ai"] },

  // Whatever is left under /api/admin (a follow-up note on a billing attempt,
  // a blog post) is read back only by the admin console itself. It reached here
  // because it is NOT in FULL_PURGE above.
  { match: /^\/api\/admin\b/, drop: ["/api/admin"] },

  // Identity: deliberately narrow. The boot-time POST /api/legal/accept used to
  // wipe the whole cache mid-boot, which is why every screen refetched.
  { match: /^\/api\/(profile|legal)\b/, drop: ["/api/profile", "/api/organizations"] },
  { match: /^\/api\/(organizations|invitations|referrals)\b/, drop: ["/api/organizations", "/api/profile", "/api/admin/me", "/api/referrals", "/api/search", "/api/audit"] },
]

/**
 * Writes whose blast radius is the whole cache: the active org changes, the plan
 * changes (every quota-gated read is now wrong), the account is reset or
 * deleted, or a platform admin changed something — plans, roles, subscriptions,
 * whole organizations — that reaches back into ordinary app data. An UNMAPPED
 * path lands here too, which is the safe direction to be wrong in.
 */
const FULL_PURGE = [
  /^\/api\/organizations\/switch\b/,
  // Onboarding seeds a workspace — categories, the Cash account, the first
  // figures. It runs once, so the cost of purging is nothing and the cost of
  // guessing which of those a given run touched is a stale empty state.
  /^\/api\/onboarding\b/,
  /^\/api\/billing\b/,
  /^\/api\/account\b/,
  /^\/api\/admin\/(plans|roles|admins|subscriptions|organizations|users|referral-settings|payouts)\b/,
]

export type Invalidation = { kind: "all" } | { kind: "prefixes"; prefixes: string[] }

/**
 * What a successful write to `path` invalidates.
 *
 * Unmapped paths return `all`, so a new route is stale-free by default and only
 * ever *slower* than it could be. scripts/check-cache-map.mjs is what stops that
 * being permanent: it fails the build when a route ships with no entry here.
 */
export function invalidationFor(path: string): Invalidation {
  const p = basePath(path)
  if (FULL_PURGE.some((re) => re.test(p))) return { kind: "all" }
  const hit = FANOUT.find((f) => f.match.test(p))
  return hit ? { kind: "prefixes", prefixes: hit.drop } : { kind: "all" }
}

/** True when `path` has an explicit fanout rule (used by the guard script). */
export function hasFanoutRule(path: string): boolean {
  const p = basePath(path)
  return FULL_PURGE.some((re) => re.test(p)) || FANOUT.some((f) => f.match.test(p))
}
