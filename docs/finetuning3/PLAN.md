# Fine-tuning Wave 3 — plan & live tracker

Autonomous execution of a 9-item UX brief. Stacked feature branches off
`feat/ux2-12-unified-tx-modal` (which itself stacks on the ux2 wave off `dev`).
Each branch: one task (or a tightly-coupled pair), passes the full gate
(`i18n:check → lint → typecheck → test:ci`), Playwright-verified where reachable,
pushed. Source of truth for status is the **Branch chain** table below.

The user is not available mid-run. Decisions favour **simple, lovable, mobile-first
UX** with correct data, reusing the components that already exist.

## Working conventions

- **Mobile-first**: design at ~390px first; ≥44px touch targets; verify a phone and a
  desktop width in the browser.
- **Instant in-place updates**: after create/edit/delete, update the affected view in
  place (optimistic or silent refetch) — never flash a full-screen skeleton. The API
  layer clears the GET cache on every mutation, so a *silent* refetch returns fresh data.
- **Transitions**: any new motion (expand/collapse, list, modal) animates transform/
  opacity or the grid `0fr→1fr` trick; respects `prefers-reduced-motion`.
- **i18n**: every user-visible string via the i18n hook; add to `en.json` first, then
  propagate to all 7 locales (`scripts/i18n-merge.mjs`); the parity check gates the commit.
  The `/admin` console is intentionally English-only. ClientDetailPage / ClientFilesPage /
  ClientOverviewModal currently use raw English strings (pre-existing) — match the
  surrounding file's convention there rather than half-i18n-ing one label.
- **Scoping / serialize / role+quota checks**: unchanged API rules.
- **No migrations needed** for any item in this wave (verified — budgets/clients/
  transactions schemas already support everything).

## Verified findings (research + adversarial in-browser verification)

Two research-agent claims were **wrong** and were corrected by hand + Playwright:

- ⚠️ **Item 5 ("no bug found")** is a **real bug**. The file modal *opens then
  auto-closes*: probe showed `?file=` + 1 dialog at t=60ms, then URL cleared + 0 dialogs
  by t=460ms. `ClientFilesPage` manages the `?file=` param via `setSearchParams` **and**
  the vendored `Dialog` pushes its own `useBackClose` history entry → a double-history
  race pops it shut. Manifests on **mobile** (desktop happened to win the race). Same
  class as item 1b.
- ⚠️ **Item 9 ("no change needed")** — editing technically works (clicking the budget
  bar opens `BudgetDialog` in edit mode, confirmed), but the bar has **no edit
  affordance**, so users can't discover it. Real fix = add a visible edit control.

## Branch chain (live tracker)

| # | Branch | Item(s) | Scope | Status |
|---|--------|---------|-------|--------|
| 13 | `feat/ux2-13-plan` | — | This plan doc | ✅ committed |
| 14 | `feat/ux2-14-client-overview-modal` | 1 | Fix zero Income/Expense/Net in the client "eye" overview (pass page-computed totals); fix Edit-from-overview closing without opening | ⏳ |
| 15 | `feat/ux2-15-quotation-toast-deeplink` | 4 | Quotation quick-add toast → `/quotations?view=<id>` (specific quote, not the list) | ⏳ |
| 16 | `feat/ux2-16-files-modal-race` | 5 | Fix file-detail modal opening-then-closing on the files page (single history mechanism) | ⏳ |
| 17 | `feat/ux2-17-budget-detail-and-card` | 2, 9 | Budget view/set/edit section on the client detail page; explicit edit affordance on the client-list card budget | ⏳ |
| 18 | `feat/ux2-18-own-company-budget-noclose` | 7 | Own-company budget card on the business dashboard; own (`is_own`) client never closable (UI + server guard) | ⏳ |
| 19 | `feat/ux2-19-wealth-health-dots` | 8 | Dashboard wealth: health dot on Total available (green/yellow/red) + per-account negative = red text + red dot | ⏳ |
| 20 | `feat/ux2-20-overlay-advanced` | 6 | Collapsible "Advanced" section in the + overlay (client + quotation) revealing all create fields, animated | ⏳ |
| 21 | `feat/ux2-21-inplace-updates` | 3 | After a tx add (client page + FAB from dashboard/analytics), update budgets + income/expense/net + wealth in place, no reload | ⏳ |

Order rationale: low-risk verifiable wins first (14–16), budget UI (17–18) before the
cross-cutting in-place-refresh (21) which depends on the budget section existing.

## Per-task detail

### 14 — Client overview ("eye") modal (item 1)
- **Problem**: (a) Income/Expense/Net always €0 in the overview; (b) clicking Edit closes
  the modal and the edit dialog never appears.
- **Root cause**: (a) `ClientOverviewModal` reads `client.total_incoming/total_outgoing`
  (`ClientOverviewModal.tsx:88-90`), which the **detail** GET never populates
  (`api/_routes/clients/[id].ts:24` returns the raw row; only the *list* endpoint computes
  totals). The page already computes them from `transactions` (`ClientDetailPage.tsx:181-183`).
  (b) Edit handoff (`ClientOverviewModal.tsx:213`) closes overview + opens the edit dialog
  in the same tick → the overview's `useBackClose` `history.back()` popstate is caught by
  the edit dialog → it closes. Same race as the prior tx view→edit fix.
- **Approach**: (a) pass `totalIncoming`/`totalOutgoing` props from the page to the modal,
  use them instead of the client fields. (b) Sequence the handoff so the overview's
  back-entry is consumed before the edit dialog mounts (e.g. close overview, open edit on
  the next frame / after the popstate settles), mirroring the verified tx pattern.
- **Files**: `src/components/ClientOverviewModal.tsx`, `src/pages/ClientDetailPage.tsx`.
- **Verify**: eye → totals match the stat cards; Edit → edit dialog opens AND stays.

### 15 — Quotation quick-add toast deep link (item 4)
- **Root cause**: `QuickAddModal.tsx` quotation success toast targets `/quotations`.
- **Approach**: target `/quotations?view=${created.id}` (QuotationsPage already opens the
  detail on `?view=`, `QuotationsPage.tsx:287`). One-line change.
- **Verify**: + → Quotation → create → toast "View" → lands on that quote's detail.

### 16 — File detail modal race (item 5)
- **Root cause**: double history mechanism (page `?file=` setSearchParams + Dialog
  `useBackClose`) closes the modal right after it opens (mobile).
- **Approach**: drive the `?file=` modal through a single history owner — use
  `useUrlModal('file')` for open/close and pass `disableBackClose` to the
  `AttachmentDetailModal`'s Dialog so it doesn't push a second entry (mirrors how
  `?view=` modals are wired). Confirm `AttachmentDetailModal`/vendored `Dialog` forwards
  `disableBackClose`.
- **Files**: `src/pages/ClientFilesPage.tsx` (+ `AttachmentDetailModal`/`ui/dialog` if a
  `disableBackClose` passthrough is needed).
- **Verify**: on **mobile** viewport, tap a file → modal opens and STAYS; edit/save works;
  Back closes it; deep link `?file=` still opens it.

### 17 — Budget on client detail + editable from card (items 2, 9)
- **Approach**: reuse `BudgetDialog` + `BudgetIndicator`. (2) Add a budget card to
  `ClientDetailPage` (load this client's budget from `/api/budgets`, show indicator or a
  "Set budget" CTA, open `BudgetDialog` with `current`; `onSaved` reloads just the budget).
  (9) On `ClientsPage` give the existing-budget indicator a clear edit affordance (e.g. a
  small pencil / "Edit" hint) so it's obviously tappable.
- **Files**: `src/pages/ClientDetailPage.tsx`, `src/pages/ClientsPage.tsx`.
- **Verify**: detail page shows/sets/edits/removes budget; card budget shows an edit
  control that opens the prefilled dialog.

### 18 — Own-company budget on dashboard + never closable (item 7)
- **Approach**: (a) a `BusinessBudgetCard` (parallel to `PersonalBudgetCard`) bound to the
  `is_own` client's budget, rendered on the business dashboard. (b) Guard `is_own` against
  closing: hide/disable the close button for `is_own` on `ClientDetailPage` **and** reject
  `closed:true` for `is_own` in `PATCH /api/clients/:id` (the gap; DELETE is already
  guarded).
- **Files**: `src/components/budget/BusinessBudgetCard.tsx` (new), `src/pages/Dashboard.tsx`,
  `src/pages/ClientDetailPage.tsx`, `api/_routes/clients/[id].ts`, locales.
- **Verify**: business dashboard shows the own-company budget (set/edit); the own client's
  close button is gone/disabled; API rejects closing it.

### 19 — Wealth health indicators (item 8)
- **Approach**: in the dashboard wealth card, a health dot by "Total available":
  **red** if total < 0; **yellow** if total ≥ 0 but any active account is negative;
  **green** otherwise (data-driven, no arbitrary %). Each account row with
  `current_balance < 0` → red amount + small red dot. Reuse `text-destructive`/emerald
  tokens; respect the balance-privacy toggle.
- **Files**: `src/pages/Dashboard.tsx` (+ small i18n for dot aria-labels/tooltips).
- **Verify**: negative total → red dot; positive total with an overdrawn account → yellow;
  all-positive → green; negative account rows are red.

### 20 — + overlay Advanced section (item 6)
- **Approach**: collapsible "Advanced" in `QuickAddModal` for client (phone, status,
  onboard_date, category, notes) and quotation (company, email, phone, status, category,
  notes), matching the full create forms + the POST payloads. Animate with grid
  `0fr→1fr`; collapsed by default. i18n for the toggle (reuse existing field labels).
- **Files**: `src/components/QuickAddModal.tsx`, locales.
- **Verify**: expand reveals all fields, collapse hides them, submit persists the advanced
  values (re-open the created entity to confirm).

### 21 — In-place updates after tx add (item 3)
- **Approach**: a lightweight refresh signal (`src/lib/data-refresh.tsx` context exposing
  `bump()` + `revision`) provided in `AppLayout`/`MobileAppLayout` around the FAB +
  `Outlet`. `AddTransactionDialog`'s FAB `onCreated` calls `bump()`. `Dashboard`,
  `AnalyticsPage`, and `ClientDetailPage` consume `revision` and silently refetch
  (`{silent:true}`, no skeleton). On the client detail page also refresh the budget
  indicator after an add. Reuses the cache-clear-on-mutation already in place.
- **Files**: `src/lib/data-refresh.tsx` (new), `src/components/AppLayout.tsx`,
  `src/components/MobileAppLayout.tsx`, `src/pages/Dashboard.tsx`,
  `src/pages/AnalyticsPage.tsx`, `src/pages/ClientDetailPage.tsx`.
- **Verify**: add a tx from the dashboard FAB → dashboard totals/wealth/latest update with
  no skeleton/reload; add from a client → its budget + income/expense/net update in place.

## Change log
- 2026-06-09: plan created on `feat/ux2-13-plan`; research (10 agents) + adversarial
  in-browser verification done; items 5 and 9 reclassified from "no-op" to real fixes.
