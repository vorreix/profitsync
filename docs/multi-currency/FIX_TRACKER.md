# Multi-currency fix tracker

Source: `IMPACT_ANALYSIS.md` (177 deduplicated issue groups, MC-001…MC-177). Waves follow its
"Suggested fix order": server guards first, then validation + additive migrations, read-side
maths, the client formatting sweep, refusal UX, and finally FX operations / rollout / tests.

Status: ⏳ in progress · ✅ fixed + verified · 🟡 partial · ⏭️ deferred (with reason)

## Wave 1 — stop ledger corruption (server guards, no schema change) ✅

| Id | What | Status |
|---|---|---|
| MC-002 | DELETE/PATCH of an already-trashed row moves balances again | ✅ |
| MC-003 | Transfer fee rows escape the transfer guards (keyed on `kind`, not `transfer_id`) | ✅ |
| MC-004 | A trashed / partly trashed transfer can be reversed | ✅ |
| MC-132 | A reversal can itself be reversed | ✅ |
| MC-012 | Purge leaves the fee row and header behind | ✅ |
| MC-013 | Tag "delete with records" trashes single transfer legs | ✅ |
| MC-114 | Tag delete dialog understates what is trashed | ✅ |
| MC-165 | Tag delete strips the tag from trashed rows, no audit | ✅ |
| MC-010 | Transaction PATCH can move rows onto Spaces/debts, edit system rows | ✅ |
| MC-036 | Admin transaction edit/delete bypasses the ledger services | ✅ |
| MC-068 | Planned/pending transfers can target a debt account | ✅ |
| MC-043 | Editing a row on an archived account returns 409 `currency_missing` | ✅ |
| MC-096 | Deleting a debt whose rows are all trashed hard-deletes the account | ✅ |
| MC-125 | Extra cash wallets can't be archived/restored | ✅ |
| MC-158 | Creating a wallet named "Cash in Hand" returns 500 | ✅ |
| MC-061 | No balance-vs-ledger audit tool | ✅ |
| MC-173 | STATUS.md overstates the transfer guards | ✅ |

**Verification (2026-10-01):**
- Full gate green: lint, typecheck, ESM/boot guards, route guards, migrations, cache map, i18n, 1121 unit tests (16 new: `api/_lib/tx-trash.test.ts`, `api/_lib/tag-ops.test.ts`).
- 31/31 live API scenarios against a fresh dev server, exact native balances at every step (scratch script, not committed): double DELETE, PATCH of a trashed row, fee-row delete/edit/bulk-delete, reverse refunds the fee exactly once, reversal-of-reversal refused, trashed transfer cannot be reversed, restore re-applies once, purge removes legs + fee + header, tag cascade never one-sided and keeps tags + audit, PATCH onto a Space / system rows, archived-account edit, extra cash wallet archive/restore, reserved cash name, planned transfer onto a loan.
- E2E: four pre-existing test flaws fixed on the way: `credit-card.spec` fixture statement was already overdue on the 1st of every month; `debts.spec` summed only page 1 of a 20+-row wallet and asserted a raw cross-currency net worth; `alerts.spec` role-queried hidden carousel slides.
- New tool: `npm run audit:balances [-- --org <id>]` (read-only). On the dev DB it reports pre-existing drift from the bugs fixed here (e.g. 13 incomplete completed transfers, 4 header-less transfer groups) — repairs come with the tool's `--apply` mode in Wave 6.

Follow-ups surfaced by Wave 1 reviews (scheduled): client delete / bulk delete are not yet audited for transfer rows (Wave 2); raw JSON error toasts for the new refusal codes `reserved_cash_name`, `default_cash_exists`, `system_row`, `transfer_trashed`, … (Wave 5); `api/_routes/admin/clients.ts` hard delete bypasses the ledger (Wave 2); legacy transfers whose header is live but all rows trashed can be purged but not restored — needs a repair migration (Wave 6, MC-116).

## Wave 2 — one currency source of truth, locks, per-entity currencies ✅

| Id | What | Status |
|---|---|---|
| MC-001 | Onboarding wrote only `organizations.currency` | ✅ `setOrgCurrency` (api/_lib/org-currency.ts) writes both columns + audit; MoneyWizard sends `currency_code` |
| MC-033 | The two org currency columns drift (admin edit, old script) | ✅ admin validated + via `setOrgCurrency`; debts/AI read `reportingCurrencyFor`; old script deleted. 🟡 billing readers still read the legacy column — now always equal for new writes |
| MC-032 | No repair path for a wrong-currency workspace | ✅ `scripts/relabel-org-currency.mjs` (dry-run default; relabels, never converts; refuses mixed orgs; one transaction) |
| MC-038 | Org currency change left money reads cached | ✅ FANOUT rule drops every money prefix (+ pricing) |
| MC-164 | Reporting-currency change not audited | ✅ |
| MC-109 | Pricing vs checkout country differ | ✅ shared `billingCountry()`; profile PATCH drops cached pricing |
| MC-011/054/055/062 | Account currency lock ignored rules/cards/transfers/balances; picker disagreed | ✅ pure `accountCurrencyLockReason` (src/lib/account-currency-lock.ts) used by PATCH + GET flag; materializer second guard |
| MC-015/075/044 | Rule/row currency silently re-stamped on edit/move | ✅ keeps stored currency; 409 `amount_required_for_currency_change`; client clears + re-asks the amount |
| MC-042/157 | Cross-currency splits; NULL-currency accounts on create | ✅ 400 `split_currency_mismatch`, 409 `currency_missing` |
| MC-126/145 | Debt currency change races payments; interest-only payments ignored | ✅ guarded single batch + row lock; payment batch aborts on a currency change |
| MC-172 | Unused currency-less transfer-leg helper | ✅ deleted |
| MC-018 | New spending budgets saved without a currency | ✅ stored at creation (sub-budgets inherit) + 0077 backfill |
| MC-020 | Per-client caps had no currency | ✅ 0077 columns; caps judged + shown in their own currency (UI, notifications) |
| MC-108 | Quotations had no currency | ✅ stored at creation, list + PDF use it. 🟡 AI/quick-add path forwards the parsed currency in Wave 4 |
| MC-024 | Credit card always in reporting currency | ✅ card currency picked in the wizard (defaults to the issuing bank's) |
| MC-025/026 | Autopay funded from another currency | ✅ refused on POST/PATCH/wizard/engine; panel disables the switch; alerts no longer claim "covered" |
| MC-005/110/163 | Referral balances mixed currencies; unvalidated reward/invoice currencies | ✅ per-currency balances and payouts; codes validated |
| W1 follow-ups | Client delete/bulk delete trashed transfer rows one-sided; admin client hard delete bypassed the ledger | ✅ `api/_lib/client-trash.ts`; admin delete refused for money rows |
| MC-054 (rest) | Trashing/purging system Opening Balance rows orphans balances | ⏭️ Wave 6 (ledger repair); the new balance lock already prevents relabelling such accounts |

**Migration 0077_entity_currencies** (additive, re-runnable): `currency_code` on `budgets`, `budget_history`, `quotations`; backfills + NULL `spending_budgets` backfill. Applied to the shared dev DB and verified in `information_schema` (0 NULLs left).

**Verification (2026-10-01):** full gate green (1177 unit tests); 20/20 live API scenarios (org currency both columns + audit + invalid code refused; account lock by rule and by balance + GET flag; currency+balance PATCH consistent; row/rule moves need the amount restated and move balances once; cross-currency split refused; budget/sub-budget/quotation currencies stored; EUR credit card; cross-currency autopay refused; debt currency locked after an interest-only payment).

## Wave 3 — server-side money maths ✅

| Id | What | Status |
|---|---|---|
| MC-007/008/052 | System rows (Opening Balance, Balance Adjustment) and refunds counted as income on the Dashboard, /transactions summary and client totals | ✅ shared classification (`tx-classify` / `tx-sql`) everywhere |
| MC-053/037/136/137 | "Excluded" rows invisible or the notice showed the raw i18n key | ✅ `fx.excludedNotice` translated; notices on dashboard, closed clients, client sheets, calendar, flow, analytics (+ per-row markers), budgets, client caps |
| MC-006/161 | Heroes showed raw mixed sums before the summary; summary lagged due recurring items | ✅ no raw mixed sums; `/api/wealth/summary` materialises first and is `ALWAYS_FETCH` |
| MC-040/041/130/045/171 | Mixed-currency split totals, detail GET without currency, amount sort, optimistic delete | ✅ `groupMoneySql` single definition; `amount: null` + "No rate yet" + `≈` on every consumer (type widened); sort by reporting amount; optimistic delete uses the shared P&L |
| MC-124 | Money flow added mixed-currency split legs | ✅ |
| MC-023 | Cards summary strip summed across currencies | ✅ |
| MC-028/089/090/091/142/094 | Debt hub totals, interest, repaid, pressure ratio, rankings mixed currencies; Upcoming over-marked as paid | ✅ per-currency figures (`*_by_currency`; old fields kept, deprecated, for pinned native builds) |
| MC-092 | Net worth counted settled debts | ✅ only active/paused debts count |
| MC-074/071 | Recurring "posted so far" mixed; failed auto-save silently lost | ✅ |
| MC-080–085/149/150 | Budget allocation sums, missing FX pairs, partial spend treated as complete, excluded counts, analytics, alert dedupe currency, transfer fees never alerting | ✅ |
| MC-027/087/148 | Reversed card payment counted as paid; autopay-failed card page; planned transfers ignored by shortfall alerts | ✅ |
| MC-111/112 | Admin referrals / org detail mixed sums | ✅ |

**Verification (2026-10-01):** full gate green (1234 unit tests); 10/10 live scenarios (opening balance not income; own client totals; EUR 10 → USD 11.36 at the row's rate in the summary and in a USD budget, never raw 10; detail GET carries currency; summary reflects a due recurring occurrence; a written-off loan leaves net worth; debt hub per-currency months; amount sort by reporting amount). Docs updated: "Ten GET routes materialise money" (CLAUDE.md, AGENTS.md, data-fetching skill), DEBTS.md FX note.

## Wave 4 — UI money-formatting sweep ✅  ·  Wave 5 — refusal UX and i18n ✅

Run together: two foundation clusters first, then five UI clusters on top of them, then one integration owner for the cross-file leftovers.

**Foundations**
- `src/lib/api-error-codes.ts` + `apiErrorMessage` (src/lib/api.ts): every server refusal code (83 of them, incl. all Wave 1-3 codes) maps to a translated message in all 8 locales; non-JSON errors fall back to the caller's text, never raw JSON. Shared optimistic writes (`src/lib/optimistic.ts`) and every money-write catch use it. Stale-screen refusals (`source/destination_currency_mismatch`, `transfer_account_currency_changed`) also invalidate the cache (MC-063, MC-152, MC-153, MC-154).
- `src/lib/money.ts` typed `AmountError` with distinct codes (no Decimal.js text leaks); DB-function RAISE tokens map to their own codes (MC-152, MC-154, MC-067, MC-133).
- `src/lib/wealth.ts`: `formatMoney` safe for 0/3-decimal currencies and old iOS WebViews, `formatMoneyWhole` / `formatMoneyCompact`, `formatRate` with significant digits, unambiguous input symbols (CA$, A$…), `formatList`; no hand-written money `Intl` formatters left in the app (MC-129, MC-103, MC-138, MC-140, MC-139).
- Ledger descriptions for fees / fee refunds / reversals are stored as stable markers and rendered translated (`ledgerDescription`) everywhere they appear (MC-155). Budget notifications carry translated amounts (MC-151).

**Screens now in their true currency** — wealth account detail (native Income/Expenses/Net via `summary.native`), Spaces hub/detail + auto-save source filtering + foreign Spaces/cash wallets ("Add Cash" in any currency), transfer wizard (received amount resets on currency change, fee in the funds check), pay-card fee, scheduled-transfer layout, search, Trash, transaction peek/detail/split `≈`, entity drill-down, quick-add toast, cards (payload carries the card currency; wizard inputs; notifications), budgets list/detail/analytics/tooltips/recent rows, recurring list/detail/dialog, debt card/planner/form/Upcoming, AI parse + confirm card (stated currency respected; cross-currency transfers need a received amount), admin transactions tab, quotations (MC-009, 014, 016, 017, 019, 022, 029, 030, 048–051, 064–066, 069, 070, 072, 073, 076–079, 086, 088, 093, 095, 105–107, 113, 131, 133–135, 141, 143, 144, 146, 162).

| Open | Why |
|---|---|
| MC-147 | Marking a planned transfer done can't record the real rate / fee — needs a column + `complete_transfer` change → Wave 6 |

**Verification (2026-10-01):** full gate green (1422 unit tests, 110 files); all 61 earlier live scenarios re-run green (Waves 1-3) on both :5188 and the user's :5173; e2e 64/64; `npm run cap:sync:android` + `npm run cap:sync:ios` done (chunk-cycle check clean).

## Browser UI test pass (2026-10-01) ✅

70 prioritised checks (from `IMPACT_ANALYSIS.md`'s UI plan) run in a real browser against the dev server on :5173 as the signed-in e2e user, in 5 sequential batches with namespaced fixtures and screenshots; every failure re-verified independently.

- **First run: 58 pass · 10 fail · 2 blocked.** All 10 failures were confirmed product bugs (0 test artifacts). The 2 blocked checks need a brand-new Clerk user (onboarding — covered by the Wave 2 API checks instead) or a precondition the product now correctly refuses.
- **Fixed:** extra cash wallets can be archived/closed from the UI again (shared `src/lib/cash-wallet.ts`, MC-W08); transfer wizard shows the translated reason for an invalid amount instead of a silently disabled Next (MC-I01); scheduled-transfer row no longer overflows in Malayalam (MC-T09); debt Upcoming / month obligations stop at payoff (MC-DB04, `src/lib/debt-status.ts`); 44 px touch targets for the transfer wizard, organisation dialog, currency picker, Trash actions, alert dots and every dialog's close button (scoped CSS rule, `src/components/ui` untouched); 16 px search inputs in every command picker (MC-T01, MC-M01, MC-X04, MC-A01).
- **Re-test: 8/8 previously failing checks pass.**
- **Moved to Wave 6:** MC-W07 (minor-unit validation for 0/3-decimal currencies; Frankfurter cross-rate precision; a fallback rate stamped with today's date) and MC-FL01 (money flow values balances through a second "today" rate path).
- **Needs a decision:** the screen-reader label "Close" on every dialog is hard-coded English inside vendored `src/components/ui/dialog.tsx`; translating it needs a one-line change there, which CLAUDE.md forbids without the shadcn CLI.

## Wave 6 — FX engine & operations, concurrency, rollout, tests

Split into sub-waves, each committed when verified.

### 6a — FX engine ✅

| Id | What | Status |
|---|---|---|
| MC-021/166 | No historical rates outside the ECB set; nothing older than ~6 years | ✅ provider chain: Frankfurter/ECB (to 1999) → fawazahmed0 currency-api daily archive (since 2024-03-02) → open-er-api (latest); USD pegs derived only when nothing answers; `scripts/fx-backfill.ts` reaches 1999 |
| MC-097/101/W07c | Pre-publication rate frozen forever; placeholder reported as today's fresh rate | ✅ real observations replace placeholders; rates stored and reported under their real observation date; `currentRate` is the single "today" |
| MC-102/W07b | Weak-currency precision lost | ✅ EUR-anchored tables, cross rates in Decimal (14 places) |
| MC-169 | Any user could write any pair into the shared rate table | ✅ no client-supplied rates; provider fetches only for the org's currencies; rate-limited (`rate_limited`) |
| MC-098/099/123 | `fx_rate_on` preferred old direct over newer inverse; unlimited carry-forward; NULL semantics | ✅ migration **0078**: newest observation first in either direction, manual > market, real > fill, strong side preferred, nothing older than 10 days → NULL (excluded, counted); NULL-currency semantics documented |
| MC-100/FL01 | Two definitions of today's rate (flow vs wealth) | ✅ flow values balances through the wealth summary's rates |
| MC-031/047/W07a | Money ignored ISO minor units | ✅ every writer validates per currency (`amount_whole_units`, `amount_too_many_decimals`); inputs step by minor units; 3-decimal currencies (KWD, BHD, OMR, JOD, TND, IQD, LYD) no longer selectable for new entities — limitation + upgrade path documented in ARCHITECTURE.md |
| MC-147 | Marking a planned transfer done couldn't record the real rate/fee | ✅ completion accepts the real received amount + fee, atomically; migration **0079** keeps the planned card (`transfers.from_card_id`) |
| MC-159 | Cross-currency Space auto-save had no rate policy | ✅ received amount converted at the occurrence date's rate and recorded; no rate → occurrence pauses with a translated reason (`autosave_rate_unavailable`) |
| MC-167 | Aggregates call `fx_rate_on` per foreign row | 🟡 lookup is index-friendly but Postgres cannot inline it; a per-(currency, date) rate join in each report route is the real fix — performance only, scheduled with 6c |

**Verification (2026-10-01):** migrations 0078 + 0079 applied to the shared dev DB and verified (functions + column); gate green (1476 unit tests); 10/10 Wave 6a live scenarios (JPY whole units, KWD not selectable, USD 3-decimal refused, planned EUR→INR completed with the real ₹9,500 + €2 fee atomically, rate endpoint read-only with the honest observation date, flow root balance = summary valuation); all 61 earlier scenarios re-run green.

### 6b — FX operations & ledger repair ✅

| Id | What | Status |
|---|---|---|
| MC-104/039 | Rates existed only for days someone opened a report; history backfilled inside user GETs | ✅ `POST /api/cron/fx` (service token) refreshes every pair in use daily in two passes (today + recent window for all pairs, then bounded deep backfill); request paths only top up the last 31 days |
| MC-168 | Rate completeness re-scanned on every report request | ✅ one query per call; a complete workspace returns with no provider calls (~44 ms); parallel routes share one in-flight check |
| MC-127 | No FX monitoring | ✅ per-provider ok/refused/failed counters + last error; `GET /api/admin/fx` and an FX health card on /admin → Worker (pairs without a rate, excluded rows per org, last refresh) |
| MC-061 (--apply) | No ledger repair | ✅ `npm run audit:balances -- --apply <id>` / `--apply-all --org <id>`: dry-run by default; posts ONE explanatory reconciliation row per drifting account, never rewrites balances; refuses (and explains) accounts it can't reconcile safely |
| MC-054 (rest) | Purging a system Opening Balance left an unexplained balance | ✅ balance-defining system rows on live accounts are kept by purge / Empty trash / bulk delete / tag delete, and the UI says so (translated) |
| MC-116 | Legacy transfers trashed before 0071 had a live header | ✅ migration **0080** gives them a trashed header so Trash restore works (0 rows on dev) |

**Ops after deploy:** worker `make register` (or /admin → Worker auto-repairs) adds the `fx-refresh` schedule (16:30 UTC → `/api/cron/fx`); GitHub fallback `.github/workflows/fx-refresh.yml` needs the existing `PROFITSYNC_CRON_TOKEN` secret; optional `FX_REFRESH_BUDGET_MS` (default 15000). Run `audit:balances` against production before and after the deploy.

**Verification (2026-10-01):** migration 0080 applied + checked; cron route 401 without / 200 with the service token (3 pairs refreshed, 0 failures); audit dry run refuses the 3 historically damaged dev accounts with reasons; gate green (1499 unit tests); all 71 live scenarios re-run green; e2e 64/64 after scoping recurring-debt.spec's picker clicks to the open popover.

### Remaining

- **6c Concurrency & atomicity:** MC-056, 057, 058, 059, 060, 046, 160 (+ MC-167 performance).
- **6d Rollout & migrations:** MC-115 deploy order, 116, 117, 118 NULL-currency re-backfill, 119, 034 minimum client version, 035 roll-forward-only, 156, 120 store release.
- **6e Tests:** MC-121 static unsafe-sum guard everywhere, 122 (now visible: since 6b keeps balance-defining system rows, the credit-card spec's cleanup archives its card instead of deleting it, so archived e2e cards and their rows pile up in the personal workspace — recurring-debt.spec's picker clicks were scoped to the open popover to stay robust), 128 deterministic FX in e2e, 174–177; warm the dev server in `e2e/auth.setup.ts` (the first spec after a cold start hits Vite's dependency-optimisation reload — `Failed to fetch`); MC-170 currency-aware export/import (deferred feature).
- **Decision needed:** translated screen-reader label for the vendored dialog close button (`src/components/ui/dialog.tsx`).
