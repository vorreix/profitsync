# List / Card / Table views + lazy loading — Quotations & Clients

**Status:** in progress · **Owner:** Maqbool · **Started:** 2026-07-12
**Chain root:** `feat/views-00-plan-maqbool` (off `dev`)

Add a **view switcher** (Card grid · List rows · dense sortable Table) to the
**Quotations** and **Clients** sections, with **auto infinite scroll** lazy loading
and a clean, optimized data path. Reflect everything in the **Android + iOS** apps
(Capacitor — same web bundle) and add a **strict Web ↔ Native parity rule** to the docs.

---

## 1. Decisions (locked with the user)

| Decision | Choice | Why |
|---|---|---|
| Lazy loading | **Auto infinite scroll** (IntersectionObserver sentinel) + keep the existing "Load More" button as an accessible / no-observer fallback | Seamless, modern, memory-bounded (only fetched pages in the DOM); builds on the pagination that already exists |
| Views | **Card + List + Table** | Table = dense, click-to-sort columns → needs server-side sort params |
| View persistence | Persist per section to `localStorage` (`ps_view_clients`, `ps_view_quotations`) | The existing Clients toggle is volatile — preference is lost on navigation |
| Sorting | **Server-side** sort params (correct with pagination; client-side would only sort loaded rows) | Clients already sorts name/date; Quotations gains `sort`; Clients gains income/expense/profit |
| Virtualization (react-window) | **No** | Not an existing pattern; pagination + infinite scroll bounds the DOM already. Free caps 10/30 rows, premium paginates. Over-engineering. |
| Native | Same Vite bundle via Capacitor WebView → the web change **is** the native change; the work is mobile/native-safety + `cap sync` + docs | Confirmed by exploration: `android/app/src/main/assets/public` & `ios/App/App/public` are gitignored; no separate native code to commit |

## 2. Ground truth (from the Understand pass)

- **ClientsPage** (800 lines) *already* has a grid/list `viewMode` toggle (lines 106, 354-371),
  **not persisted**; page-based fetch (`fetchPage1` + `handleLoadMore`, refs for search/sort),
  "Load More" at 632-638; server sort name/date. Grid card 402-557, list row 558-630. Closed
  matches during search render **grid-only** (642-665). `ClosedClientsPage` (190) has no toggle.
- **QuotationsPage** (1120 lines) has **no** toggle — card grid only; page-based fetch,
  "Load More"; FilterSheet (status + date); PDF modal + closed accordion.
- **APIs:** both `GET /api/clients` and `/api/quotations` return all rows by default, or a page
  of **20** (`?page=N` → `{data,total}`) with **server-side** search/filter. Clients sorts
  `name_asc|name_desc|date_asc|date_desc`; **Quotations sorts `createdAt desc` only**.
- **Data layer is already clean:** `apiGet` = 30 s GET cache + in-flight dedup + LRU(50);
  `apiPost/Patch/Delete` accept a **granular `invalidateKeys` array** (e.g. ClientsPage create
  passes `["/api/clients"]`) so unrelated caches stay warm; `emitDataChanged` drives refreshes.
  → "optimized fetching" = **use** this consistently + memoize rows + Map lookups, not a rewrite.
- **UI primitives to reuse:** `toggle-group.tsx`, `button-group.tsx`, `scroll-area.tsx`,
  `@formkit/auto-animate`; `useMultiSelect`, `useLongPress`, `FilterSheet`, `ExpandableSearch`.
  No IntersectionObserver / virtualization exists yet (we introduce the observer hook).
- **Native (Capacitor 8):** WebView loads `dist/`; reflect a web change with
  `npm run build:android && cap sync android` (+ ios). `MobileAppLayout` + safe-area insets
  (`src/index.css`) + 44 px touch targets + iOS ≥16 px inputs are the constraints a Table view
  must respect (wrap wide tables in `overflow-x-auto`; page body never scrolls horizontally).

## 3. Architecture of the change

**Shared primitives (branch 01):**
- `useViewMode(key, default)` — `"card" | "list" | "table"`, persisted to `localStorage`,
  SSR/Capacitor-safe (guards `window`). Migrates Clients' `"grid"` → `"card"`.
- `useInfiniteScroll({ hasMore, loading, onLoadMore, rootMargin })` — returns a `sentinelRef`;
  an IntersectionObserver fires `onLoadMore` once when the sentinel nears the viewport. Disabled
  when `!hasMore || loading`. The "Load More" button stays as the a11y/no-observer fallback.
- `<ViewToggle value onChange available? />` — segmented icon control (Card/List/Table) reused
  by both pages; visible on mobile too (Table scrolls horizontally on narrow screens).
- i18n: shared `view.*` keys in the `translation` namespace (×8 locales).

**Per page (branches 02 Quotations, 03 Clients):**
- Extract **memoized** `QuotationCard`/`QuotationRow` and `ClientCard`/`ClientRow` (+ a Table
  body) so switching views and loading pages don't re-render every item.
- Replace O(N) `clientById` with a `Map`.
- Wire `useViewMode` + `useInfiniteScroll`; Table headers are click-to-sort (drives the server
  `sort` param; changing sort resets to page 1 like a filter change).
- Quotations API gains `sort`; Clients API gains income/expense/profit sorts.

**Native (branch 04):** mobile/native verification (viewport emulation), responsive fixes
(Table `overflow-x-auto`, toggle on mobile, safe-area/44 px), `cap sync` for both platforms
(best-effort in this env; device test deferred — documented).

**Docs + rule (branch 05):** CLAUDE.md **Key conventions** parity bullet + a short *Web ↔
Native parity* subsection; cross-ref from `docs/native/README.md`; this doc's change-log; memory.

## 4. Branch chain (stacked, in dependency order)

Naming: `feat/views-NN-<task>-maqbool`, each cut from the previous.

| NN | Branch | Scope | Depends | Status |
|----|--------|-------|---------|--------|
| 00 | `feat/views-00-plan-maqbool` | This plan doc | dev | ✅ done |
| 01 | `feat/views-01-primitives-maqbool` | `useViewMode`, `useInfiniteScroll`, `<ViewToggle>`, shared `view.*` i18n ×8, unit tests | 00 | ✅ done |
| 02 | `feat/views-02-quotations-maqbool` | Quotations API `sort` + page: ViewToggle, List + Table (sortable), infinite scroll, memoized Card/Row, Map lookup, persist view; i18n | 01 | ✅ done |
| 03 | `feat/views-03-clients-maqbool` | Clients API income/expense/profit sorts + page: persist view, add Table, infinite scroll, memoized Card/Row, ClosedClientsPage parity (Card+List); i18n | 02 | ✅ done (static gate) |
| 04 | `feat/views-04-native-parity-maqbool` | Mobile/native verification + responsive fixes (Table overflow, mobile toggle, safe-area/44 px), `cap sync` android+ios | 03 | ⬜ todo |
| 05 | `feat/views-05-docs-rule-maqbool` | CLAUDE.md parity rule + section, docs/native cross-ref, feature doc, memory note | 04 | ⬜ todo |

**Gate per branch (no `--no-verify`):** secret-scan → check-esm-extensions → boot-functions →
route-guards → i18n:check → lint → typecheck → test:ci (husky pre-commit).

## 5. Assumptions (decided, recorded — per autonomous mandate)

- **A1 — Table on mobile scrolls horizontally** inside an `overflow-x-auto` wrapper; the page
  body never scrolls sideways. The toggle is shown on mobile (Card default).
- **A2 — Persist view per section**, not per user profile (no server round-trip; instant; matches
  the local-first feel of search `?q=`). Key: `ps_view_<section>`.
- **A3 — Keep "Load More" button** as a visible fallback beneath the sentinel, so infinite scroll
  is a progressive enhancement (accessibility + reduced-motion + observer-unsupported).
- **A4 — Client-stats sorts** (income/expense/profit) sort by the aggregated `sum(...)` expression
  server-side; `is_own` still pinned first, `id` as the stable tiebreaker.
- **A5 — Native "update"** = the shared bundle + mobile-safety + `cap sync`; there is no separate
  native source to commit for a pure web-UI change (synced bundle is gitignored). Device-level
  visual verification is **deferred** to the operator (no emulator/SDK + `.env.android/.ios` here),
  same posture as the existing native branch chain.

## 6. Verified vs deferred (honesty ledger) — filled in as branches land

| Check | Status |
|---|---|
| `useViewMode` / `useInfiniteScroll` unit tests | ✅ 389 tests pass (10 new pure-predicate tests) |
| Quotations sort param (typecheck + boot-functions) | ✅ boots, 177 modules |
| Clients stat sorts (typecheck + boot-functions) | ✅ boots, 177 modules |
| Browser: toggle + all 3 views + infinite scroll (desktop + 390 px) | ⬜ branch 04 |
| Full pre-commit gate per branch | ✅ 01·02·03 (typecheck + lint + i18n + tests + ESM + boot) |
| `cap sync` android + ios (pipeline intact) | ⬜ branch 04 (deferred if SDK/env missing) |
| On-device Android/iOS visual check | ⛔ deferred (no emulator/SDK here) |
| PR creation | ⛔ deferred (`gh` not authed → `pull/new/...` URLs) |

## 7. Change log
- 2026-07-12 — Plan authored; decisions locked (infinite scroll + Card/List/Table); chain-root created.
- 2026-07-12 — **01** shipped: `useViewMode` (localStorage `ps_view_*`, legacy `grid`→`card`), `useInfiniteScroll` (IntersectionObserver + `shouldLoadMore` predicate), `<ViewToggle>` (radiogroup, mobile-visible), shared `view.*` i18n ×8, 10 unit tests.
- 2026-07-12 — **02** shipped: Quotations API `sort` (created/date/amount/title/prospect/status, id tiebreaker); page rewired to Card/List/Table with click-to-sort headers, auto infinite scroll (sentinel + Load-More fallback), memoized `QuotationCard/ListRow/Table`, O(1) `clientMap` lookup, persisted view; `quotation-display.ts` extracted; `quotations.table.*` i18n ×8.
- 2026-07-12 — **03** shipped (static gate): Clients API income/expense/profit + company/name/date sorts (aggregate `sum(...)` server-side, `is_own` pinned, `id` tiebreaker); `client-views.tsx` (memoized `ClientCard/ListRow/Table` + `ClientActions`/`ClientColumn`/`ClientWithStats`); ClientsPage rewired (ViewToggle, 3 views, budget-aware sort select +6 options, `budgetFor`/`handleSort`/latest-ref actions, infinite scroll); ClosedClientsPage parity (Card+List toggle, key `clients-closed`, infinite scroll); `clients.table.*` + 6 sort labels i18n ×8. Browser + native verification → branch 04.
