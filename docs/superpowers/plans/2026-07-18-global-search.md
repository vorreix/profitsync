# Global Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Org-scoped global search — desktop ⌘K command palette + WhatsApp-Liquid-Glass mobile overlay — over clients, transactions, quotations, wealth accounts, categories, pages, and quick actions.

**Architecture:** One new API route (`/api/search`) aggregates the five entity queries in parallel; a pure client core (`search-index.ts`, `recent-searches.ts`, `use-global-search.ts`) feeds two thin UIs: `GlobalSearchDialog` (cmdk, desktop `AppLayout`) and `MobileSearchOverlay` (always-mounted frosted overlay, bottom-docked input, `MobileAppLayout`).

**Tech Stack:** Drizzle `ilike` + `Promise.all`, shadcn `CommandDialog` (cmdk), `useBackClose`, i18next, Vitest (DB-free).

Spec: `docs/superpowers/specs/2026-07-18-global-search-design.md`. Branch: `feat/global-search-maqbool`.

---

### Task 1: Recents store + search index (TDD, pure libs)

**Files:** Create `src/lib/recent-searches.ts`, `src/lib/recent-searches.test.ts`, `src/lib/search-index.ts`, `src/lib/search-index.test.ts`

- [ ] Write failing tests: recents — load empty, record de-dupes + caps at 6 + newest first, per-org key isolation, corrupt JSON → []; index — pages filtered by accountType/isAdmin, actions feature-filtered, `filterLocal` matches translated labels case-insensitively.
- [ ] Implement `recent-searches.ts`: `loadRecents(storage, orgId)`, `recordRecent(storage, orgId, q)`, `clearRecents(storage, orgId)`; key `` `ps_recent_search_${orgId}` ``.
- [ ] Implement `search-index.ts`: `searchablePages(accountType, isAdmin)` (all sidebar/More routes, reuse `nav.*` keys + lucide icons, `accountTypeAllows` from `src/lib/types.ts`), `quickActions(accountType)` (`actions.*` keys → `?new=1` hrefs), `filterLocal(items, q, t)`.
- [ ] `npx vitest run src/lib/recent-searches.test.ts src/lib/search-index.test.ts` → PASS. Commit.

### Task 2: `/api/search` route

**Files:** Create `api/_routes/search.ts`; modify `api/index.ts` (import + `["search"]` entry), `CLAUDE.md` route table

- [ ] Handler: GET only (405 otherwise); `requireAuth`; `q = String(req.query.q ?? "").trim()`, len < 2 → 400 `{error:"query too short"}`; five parallel org-scoped `ilike` queries per the spec table (limits 6/6/6/4/4, `deleted_at`/`archived_at` null); respond `{clients, transactions, quotations, accounts, categories}` with `serialize()` on every row. **`.js` extensions on all relative imports.**
- [ ] Wire route (static entry, alphabetical-ish near `["referrals"]`); add CLAUDE.md row.
- [ ] Verify against the dev server: `curl -H "Authorization: Bearer …" -H "x-org-id: …" "http://localhost:5174/api/search?q=te"` (or via the browser session). Commit.

### Task 3: `use-global-search` hook

**Files:** Create `src/hooks/use-global-search.ts`

- [ ] `useGlobalSearch(query)` → `{results, loading}`; 250 ms debounce; skip server when `query.trim().length < 2` (results = null); `apiGet<SearchResults>` with an incrementing request id — stale responses dropped; error → null results. Commit (typecheck green).

### Task 4: Desktop ⌘K palette

**Files:** Create `src/components/GlobalSearchDialog.tsx`; modify `src/components/AppLayout.tsx`

- [ ] `GlobalSearchDialog({open, onOpenChange})`: `CommandDialog` + `Command shouldFilter={false}`; groups Recent (empty q) → Actions → Pages → Clients → Transactions → Quotations → Accounts → Categories; row icons + secondary text (company / client·amount / prospect); select → `recordRecent` + navigate (targets per spec) + close.
- [ ] `AppLayout` header: input-look button centered between the title and `ml-auto` cluster (magnifier, `search.placeholder`, `⌘K`/`Ctrl K` chip via platform sniff); `keydown` listener (metaKey||ctrlKey + "k", preventDefault, toggle); dialog mounted once. Commit.

### Task 5: Transactions deep-link (`?q=` + `?highlight=`)

**Files:** Modify `src/pages/TransactionsPage.tsx`

- [ ] `const [search, setSearch] = useState(() => searchParams.get("q") ?? "")`; add `data-tx-id={tx.id}` to the row; effect: when rows land and `searchParams.get("highlight")` matches, `scrollIntoView({block:"center"})` + 2 s `ring-2 ring-primary` flash class, then drop the param. Commit.

### Task 6: Mobile overlay + glass button

**Files:** Create `src/components/MobileSearchOverlay.tsx`; modify `src/components/MobileAppLayout.tsx`

- [ ] Overlay per spec: always-mounted (`open` prop, render `null` only for content, keep hook order stable), `useBackClose`, `fixed inset-0 z-[60] bg-background/85 backdrop-blur-xl`, `h-dvh` column: header ✕ + results (flex-1 `overflow-y-auto`), chips (All/Clients/Transactions/Quotations/Pages/Accounts, horizontal scroll, ≥44 px), bottom input bar (`safe-pb`, 16 px input, auto-focus on open, clear ✕). `visualViewport` resize → container height so the input rides the keyboard on web. Empty q → recents + quick actions; no matches → `search.noResults`. Body scroll lock while open. Reuses `useGlobalSearch` + the same navigate map (close before navigating).
- [ ] `MobileAppLayout`: frosted `size-14` round button `fixed bottom-24 left-4 z-50` (hidden when FAB stack open or a page action overlays); opens overlay. Commit.

### Task 7: i18n

**Files:** Modify `src/lib/i18n/locales/en.json`, then all 7 others via `scripts/i18n-merge.mjs`

- [ ] Add `search.*` block to en.json (placeholder, title, description, recent, clearRecent, actions, pages, clients, transactions, quotations, accounts, categories, filterAll, noResults, hintNavigate, hintOpen, hintClose).
- [ ] Merge translated maps for it/de/hi/ml/ta/te/ar (maps in `$CLAUDE_JOB_DIR/tmp/`); `npm run i18n:check` → green. Commit.

### Task 8: Verify + ship

- [ ] Browser (Playwright MCP): desktop 1164×963 — bar renders, ⌘K opens, query groups results, Enter navigates, recents persist; mobile 430×932 — glass button, overlay, chips filter, bottom input, back-close, tx highlight flash.
- [ ] Multi-angle review (workflow: correctness / security / UX-regression lenses) on the diff; fix confirmed findings.
- [ ] Full gate (pre-commit runs on commit) → `npm run cap:sync:android` + `npm run cap:sync:ios` → push branch → hand the PR compare URL to the user.
