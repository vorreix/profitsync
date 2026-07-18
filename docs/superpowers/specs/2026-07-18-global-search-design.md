# Global Search — Design Spec (2026-07-18)

**Approved by user:** floating glass button (mobile entry), bottom-docked input (mobile),
full scope (clients + transactions + quotations + pages + quick actions + wealth accounts +
categories), dedicated `/api/search` endpoint, ⌘K palette on desktop, recent searches.

## Goal

One global search across the whole app:

- **Desktop** — an ElevenLabs-style search bar in the `AppLayout` header (input-look button
  with a magnifier + `⌘K` kbd chip) that opens a cmdk command palette on click or Cmd/Ctrl+K.
- **Mobile** — a WhatsApp iOS-26 "Liquid Glass" style search: a round frosted-glass button
  floating at bottom-left (mirroring the + FAB), opening a full-screen frosted overlay whose
  **input is docked at the bottom** just above the keyboard, with filter chips above it and
  results filling the screen above that.

## Server

`GET /api/search?q=<term>` — new route `api/_routes/search.ts`, wired in `api/index.ts`
(`["search"]`, static, no dynamic siblings). `requireAuth` → all queries scoped by `orgId`.
Empty/1-char `q` → 400. Runs in parallel (`Promise.all`), all `ilike '%q%'`,
soft-deleted/archived excluded, `serialize()`d:

| Group | Table | Matched columns | Limit | Payload fields |
|---|---|---|---|---|
| clients | `clients` (`deleted_at IS NULL`) | name, company, email | 6 | id, name, company, status |
| transactions | `transactions` (`deleted_at IS NULL`) ⋈ clients | description, category, `tags::text`, client name | 6 | id, description, amount, type, date, category, client_id, client_name |
| quotations | `quotations` (`deleted_at IS NULL`) | title, prospect_name, company, email | 6 | id, title, prospect_name, status |
| accounts | `wealth_accounts` (`archived_at IS NULL`) | name | 4 | id, name, type |
| categories | `categories` | name | 4 | id, name, type |

Response: `{ clients: [...], transactions: [...], quotations: [...], accounts: [...], categories: [...] }`.

## Client core

- `src/lib/search-index.ts` — pure, DB-free registry:
  - `searchablePages(accountType, isAdmin)` → `{ labelKey, href, icon }[]` reusing the
    existing `nav.*` i18n keys (all pages from the sidebar/More sheet, filtered by
    `accountTypeAllows`, `/admin` only when admin).
  - `quickActions(accountType)` → the FAB actions as `?new=1` deep links
    (`actions.addClient` → `/clients?new=1`, `actions.addTransaction` → `/transactions?new=1`,
    `actions.createQuotation` → `/quotations?new=1`), feature-filtered like the FAB.
  - `filterLocal(items, query, translate)` — case-insensitive substring match on the
    translated label (so search works in every locale).
- `src/lib/recent-searches.ts` — pure recents store (max 6, de-duped, newest first) with
  injected storage for tests; persisted per org under `ps_recent_search_<orgId>`.
- `src/hooks/use-global-search.ts` — debounced (250 ms, ≥2 chars) `apiGet("/api/search?q=…")`
  returning `{ results, loading }`; stale responses discarded; errors → empty results
  (local groups still render).

## Desktop UI

- `src/components/GlobalSearchDialog.tsx` — shadcn `CommandDialog` (`shouldFilter={false}`),
  groups in order: **Recent** (empty query only) → **Actions** → **Pages** → **Clients** →
  **Transactions** → **Quotations** → **Accounts** → **Categories**. Enter/click navigates and
  records the query into recents. Footer hint row (↑↓ navigate · ↵ open · esc close).
- `AppLayout.tsx` header: centered input-look button (`flex-1` centering between the page
  title and the right cluster), magnifier + `t("search.placeholder")` + `⌘K` chip (`Ctrl K`
  shown on non-mac via `navigator.platform` check). Global `keydown` listener for
  Cmd/Ctrl+K toggling the dialog.

## Mobile UI

- `MobileAppLayout.tsx`: round `size-14` frosted button fixed `bottom-24 left-4 z-50`
  (`bg-background/70 backdrop-blur-xl border shadow-lg`; the existing
  `html.native-app [class*="backdrop-blur"]` CSS keeps WebView scroll perf safe). Hidden
  while the FAB action stack is open.
- `src/components/MobileSearchOverlay.tsx` — **always-mounted, state-driven** (StrictMode
  footgun), `useBackClose(open, close)` so the hardware/gesture back closes it. Full-screen
  `fixed inset-0 z-[60]` frosted layer (`bg-background/85 backdrop-blur-xl`), `100dvh`;
  body scroll locked while open. Layout top→bottom: close ✕ + results list (flex-1, scroll),
  filter chips row (All / Clients / Transactions / Quotations / Pages / Accounts — horizontal
  scroll, ≥44 px targets), input bar docked at the bottom (`safe-pb`, ≥16 px font, auto-focus
  on open). Keyboard: Capacitor WebView resizes the viewport; on web, a `visualViewport`
  resize listener keeps the input pinned above the keyboard.
- Empty query → recent searches (tap to re-run) + quick actions. No results → empty state.

## Navigation targets

| Result | Target |
|---|---|
| client | `/clients/:id` |
| transaction | `/transactions?view=<id>` — the page's existing deep link opens the detail modal and fetches the tx itself when it isn't in the visible page (superseded the earlier `?q=`+`?highlight=` plan: less code, works on any page) |
| quotation | `/quotations?view=<id>` (existing deep link) |
| account | `/wealth/:id` |
| category | `/categories` |
| page / action | its href |

## i18n

New `search.*` block in `en.json` (~15 keys: placeholder, title, recent, actions, pages,
clients, transactions, quotations, accounts, categories, noResults, clear, filterAll, hint
keys) → propagated to it/de/hi/ml/ta/te/ar via `scripts/i18n-merge.mjs`. Page/action names
reuse existing `nav.*`/`actions.*` keys — no new translations needed for them.

## Testing & gates

- DB-free unit tests: `recent-searches.test.ts`, `search-index.test.ts`.
- Browser verification (Playwright MCP): desktop 1164×963 — ⌘K opens, typed query returns
  grouped results, Enter navigates; mobile 430×932 — glass button, overlay, chips, bottom
  input, back-close, recents.
- Full pre-commit gate; `cap:sync:android` + `cap:sync:ios` (bundle change);
  branch `feat/global-search-maqbool`, pushed; user opens the PR.

## Out of scope (v2 candidates)

Fuzzy ranking, search highlighting inside result rows, tag-chip results, admin-console
search, server-side pagination of results.
