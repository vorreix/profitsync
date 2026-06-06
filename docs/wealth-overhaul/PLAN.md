# Wealth & Transactions Overhaul — Implementation Plan

> **Living document.** The **Branch Tracker** table is updated after every push. Each feature ships on its own branch, stacked on the previous one, starting from `dev`.

**Author:** autonomous build (Claude) · **Base branch:** `dev` · **Created:** 2026-06-06

---

## 1. Goal

Ship four tightly-scoped, mobile-first, beautiful improvements to the Wealth/Transactions experience:

1. **Split transactions are ONE transaction.** Paying €100 from Cash €30 + AC1 €25 + AC2 €45 must appear as a **single** transaction (with a per-account breakdown), not three rows. The detail view shows the split legs.
2. **Account-scoped quick-add + Adjust placement.** On `/wealth/:id` the "+" / Add-Transaction opens a **bottom-sheet overlay in place** (no navigation), pre-scoped to that account; on save the new row appears in the same list. The per-account **Adjust** control moves next to the balance.
3. **Rich bank accounts.** Creating/editing a bank account supports: bank-name autocomplete with **auto-filled logo** (stored on backend), **country** (drives the dynamic account-number field label — IBAN / Account Number / IFSC / Sort Code / Routing …), **SWIFT/BIC**, **address + location**, **note**, **attachments**, and **closing** the account from its detail page.
4. **Account-to-account transfers.** Drag one account card onto another on `/wealth` to open a **wizard** (amount first, then date/note/attachments — N26-style). A transfer is a real, balance-affecting transaction pair but is excluded from the normal transaction list/analytics and is never offered in the add-transaction modal. Works with touch.

## 2. Priority & dependency order

| # | Feature | Branch | Why this order |
|---|---------|--------|----------------|
| 1 | Split grouping (the "very important" refactor) | `feat/split-transactions-grouping` | Foundational. Introduces `group_id` reused by transfers. Touches the core tx create/list/detail path. |
| 2 | Account quick-add overlay + Adjust placement | `feat/account-quick-add` | Builds a reusable Add-Transaction sheet (also reused by #4). Small, high-value UX. |
| 3 | Rich bank accounts (logo/country/fields/attachments/close) | `feat/bank-account-details` | Self-contained account schema + UI growth. Independent of #1/#2 but stacked. |
| 4 | Account transfers (drag-drop wizard) | `feat/account-transfers` | Depends on `group_id` from #1; benefits from the reusable sheet from #2 and richer account cards from #3. |

Each branch is created **from the tip of the previous branch** so later work includes earlier work. Migrations increment across the stack (next free number is **0026**).

## 3. Branch Tracker (update after each push)

| Branch | Base | Status | Migration(s) | Pushed commit | PR |
|--------|------|--------|--------------|---------------|----|
| `feat/split-transactions-grouping` | `dev` | ⬜ not started | 0026 | — | — |
| `feat/account-quick-add` | `feat/split-transactions-grouping` | ⬜ not started | — | — | — |
| `feat/bank-account-details` | `feat/account-quick-add` | 0027 (+ attachments table) | ⬜ not started | — | — |
| `feat/account-transfers` | `feat/bank-account-details` | 0028 (`kind`) | ⬜ not started | — | — |

Legend: ⬜ not started · 🟨 in progress · ✅ pushed · 🔵 PR open · ✔️ merged

---

## 4. Cross-cutting conventions (apply to every branch)

- **DB:** Drizzle schema in `src/lib/db/schema.ts`; generate SQL with `npm run db:generate`; apply locally with `node -r dotenv/config scripts/db-migrate.mjs dotenv_config_path=.env.local`. Local DB == cloud Dev DB.
- **API:** handlers in `api/_routes/**`; register in `api/index.ts` + `src/lib/api-router.ts` (static route before same-depth dynamic). Always `serialize(row)` before `res.json`. `requireAuth` + `canWrite/canDelete` + quota checks. API imports use **`.js`** extensions.
- **Client API:** `apiGet/apiPost/apiPatch/apiDelete` from `src/lib/api.ts` (auto org header + cache).
- **i18n:** add keys under the right namespace in `src/lib/i18n/locales/en.json`, then **propagate to all 7 other locales** (English value is acceptable for parity; `npm run i18n:check` must pass). Helper: `node scripts/i18n-fill.mjs` (added in branch 1) copies any en key missing elsewhere.
- **Design:** Tailwind v4 + shadcn (new-york). Bottom-sheet dialog className (mobile dock → desktop top-center):
  ```
  inset-x-0 bottom-0 top-auto flex max-h-[92svh] w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-2xl p-0 sm:inset-x-auto sm:bottom-auto sm:top-[7svh] sm:left-1/2 sm:max-h-[86svh] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:rounded-2xl
  ```
  Use `.scrollbar-thin`; emerald = incoming, red = outgoing; `tabular-nums` for money.
- **Gate before every commit:** `npm run i18n:check && npm run lint && npm run typecheck && npm run test:ci`.
- **Verify in browser:** dev server at `http://localhost:3000` (already running). Use chrome-devtools/playwright. Test mobile via device emulation (390×844) AND desktop.

---

## 5. Feature 1 — Split transactions are ONE transaction

### Problem
`TransactionsPage.handleAdd` and `ClientDetailPage.handleAddTransaction` loop and POST one `/api/transactions` row per allocation. The list then shows N unrelated rows. Balance-sync is correct (each leg hits its own account) but the UX is wrong.

### Data model
`transactions` gains a nullable **`group_id uuid`** (indexed). All legs of a split share one `group_id`. A single-account transaction has `group_id = NULL`. Migration **0026**.

```ts
// schema.ts transactions
groupId: uuid("group_id"),
// + index("transactions_group_idx").on(table.groupId)
```

### API
Add an **atomic group-create** endpoint so a split is one request (no partial-failure, guaranteed shared group):

- `POST /api/transactions/group` — body `{ client_id?, type, description?, category?, date?, is_system?, allocations: [{ wealth_account_id, amount }] }`.
  - Validate each account (active, org-scoped). One quota check covering `allocations.length` new rows.
  - Generate one `groupId = crypto.randomUUID()` **iff** `allocations.length > 1` (single allocation → `groupId = null`).
  - Insert all legs (shared group fields), update each account's balance with `balanceDelta(type, amount)` (reuse existing logic). Return `{ group_id, ids: string[], legs: Transaction[] }`.
  - Audit: one `create` log per leg (or one group log — use per-leg to match existing).
- Keep `POST /api/transactions` unchanged (single-leg path still used internally).
- **List grouping** (`GET /api/transactions` paginated + `?limit=` paths, NOT the per-`clientId`/per-`wealthAccountId` scoped paths): collapse legs sharing `group_id` into one representative row using `gkey = COALESCE(group_id, id)`:
  - `amount` → `SUM(amount)`, `leg_count` → `COUNT(*)`, `account_count` → `COUNT(DISTINCT wealth_account_id)`, representative display fields via the latest leg, `id` → a representative leg id, plus `group_id`, `attachment_count` → `SUM(...)`.
  - `total` (pagination) counts **distinct gkey**. The income/expense **summary** stays a raw-row SUM (a split's legs already sum to the group total → unchanged numbers).
  - Account-detail (`?wealthAccountId=`) and client-scoped (`?clientId=`) lists are **NOT** grouped — they legitimately show the per-account leg.
- **Group fetch** for the detail view: `GET /api/transactions?groupId=<id>` returns all legs (org-scoped) so the modal can render the breakdown.
- **Delete** a grouped tx: `DELETE /api/transactions/:id` — when the row has a `group_id`, soft-delete **all** legs in the group and reverse each balance. (UI confirms "deletes all N parts".)
- **Edit** a grouped tx: editing reopens the split editor with all legs prefilled; on save, **replace** the group (soft-delete old legs + recreate with a fresh group via the group endpoint, preserving date/category/description). Single-leg edit unchanged.

### Types
`Transaction` gains `group_id?: string | null`, `leg_count?: number`, `account_count?: number`, and an optional `legs?: TransactionLeg[]` (loaded for the detail). Add `TransactionLeg = { id, wealth_account_id, wealth_account_name, wealth_account_bank_name, wealth_account_icon, wealth_account_type, amount }`.

### Client
- `src/lib/api.ts` callers: replace the per-allocation loops in `TransactionsPage.handleAdd` and `ClientDetailPage.handleAddTransaction` with **one** `apiPost("/api/transactions/group", …)`. Attachments still attach to the first returned leg id.
- **List rendering** (`TransactionsPage`): a grouped row shows the **total**, a `Split · N accounts` badge, and account label "N accounts" instead of one. Icon/colour unchanged.
- **Detail modal** (`TransactionDetailModal.tsx` + the inline view modal in `TransactionsPage`): when `leg_count > 1` (or `group_id` set), fetch `?groupId=` and render an **Allocations** section: each leg = account icon + name + amount, with the group total summed. Amount field shows the group total.
- A small pure helper `groupTransactions(rows)` is NOT needed if the server groups; keep client dumb. Add `src/lib/tx-format.ts` only if shared formatting is required.

### Files
- Create: `api/_routes/transactions/group.ts`, `src/lib/tx-grouping.ts` (pure SQL-builder helpers + unit-tested `summarizeLegs`), `scripts/i18n-fill.mjs`.
- Modify: `src/lib/db/schema.ts`, `src/lib/types.ts`, `api/_routes/transactions.ts` (grouped list), `api/_routes/transactions/[id].ts` (group delete), `api/index.ts`, `src/lib/api-router.ts`, `src/pages/TransactionsPage.tsx`, `src/pages/ClientDetailPage.tsx`, `src/components/TransactionDetailModal.tsx`, `src/pages/WealthAccountDetailPage.tsx` (leg display unaffected but verify), `src/lib/i18n/locales/*.json`.

### Tests
- Unit (vitest): `src/lib/tx-grouping.test.ts` — `summarizeLegs([...])` returns correct total/count/account_count; single leg → no group.
- Browser: create a 3-way split → Transactions list shows ONE row "€100 · Split · 3 accounts"; open detail → 3 legs €30/€25/€45 summing to €100; each account balance dropped by its share; delete removes all 3 and restores balances; account-detail page still shows the single leg for that account.

### Acceptance
- A 3-account split renders as exactly **one** list row; detail shows the breakdown; balances correct; delete/edit operate on the whole group; analytics totals unchanged.

---

## 6. Feature 2 — Account quick-add overlay + Adjust placement

### Problem
`WealthAccountDetailPage` "Add Transaction" does `navigate('/transactions?new=1&account=<id>')` — leaves the page. The per-account **Adjust** lives in a 3-dot menu, far from the balance.

### Approach
- Extract the Add/Edit transaction form from `TransactionsPage` into a reusable **`<TransactionFormSheet>`** (`src/components/TransactionFormSheet.tsx`): props `{ open, onOpenChange, mode: "add"|"edit", accounts, clients?, defaults, lockedAccountId?, onSaved(tx) }`. It renders the bottom-sheet dialog + `AccountSelector` + category/client/date/description + attachments, and calls the group endpoint. `TransactionsPage` is refactored to consume it (no behaviour change there).
- `WealthAccountDetailPage`: the section "Add Transaction" button **and** the page FAB open `<TransactionFormSheet>` with `lockedAccountId={account.id}` (AccountSelector pinned to this account, `max={1}`, not switchable). On `onSaved`, optimistically prepend/refetch the account's list and update the header balance. No navigation.
- **Adjust placement:** render a small icon button (`SlidersHorizontal`, `size-7` ghost) **inline next to the balance number** on each `WealthPage` AccountCard and on the detail-page balance hero. Remove the Adjust item from the 3-dot menu (keep Edit/Close there). Tapping opens the existing Adjust dialog.

### Files
- Create: `src/components/TransactionFormSheet.tsx`.
- Modify: `src/pages/TransactionsPage.tsx` (use the shared sheet), `src/pages/WealthAccountDetailPage.tsx` (overlay add + FAB + adjust-by-balance), `src/pages/WealthPage.tsx` (AccountCard adjust button by balance), `src/components/wealth/WealthAccountDialogs.tsx` (expose adjust opener), i18n.

### Tests
- Browser (mobile + desktop): on `/wealth/:id`, tap "+" → sheet rises from bottom, account locked → save → sheet closes, new row at top of the same list, header balance updated, URL unchanged (no `/transactions`). Adjust button sits beside each balance and opens the adjust dialog.

### Acceptance
- Add-transaction never navigates away from the account page; the new row appears in place; Adjust is one tap from the balance on both the grid card and the detail hero.

---

## 7. Feature 3 — Rich bank accounts

### Data model (migration 0027)
`wealth_accounts` gains (all `text NOT NULL DEFAULT ''` unless noted):
`country` (ISO-3166 alpha-2), `account_number`, `swift`, `routing_number`, `address`, `location`, `note`, `logo_url`, `logo_data` (base64 backup), `brand_domain`. New table **`wealth_account_attachments`** mirroring `transaction_attachments` (FK → `wealth_accounts`, cascade). "Close" reuses the existing `archived_at` (relabelled "Close account").

> Country-specific secondary fields (IFSC / Sort Code / Routing / BSB / Transit …) are stored in `account_number`/`routing_number`/`swift` generically; the **label** is dynamic (client map). We keep three storage slots: primary (`account_number`), secondary (`routing_number` — reused for IFSC/Sort/BSB/Transit), and `swift`.

### Country → field labels
- Add `src/lib/bank-fields.ts`: `accountFieldsForCountry(iso2)` → `{ primaryKey: "iban"|"account_number", primaryLabel, secondary?: { key, label }, usesIban }`. IBAN-country set from **`ibantools`** (`isSEPACountry`/known IBAN list) or a bundled constant; explicit overrides for IT, GB, US, IN, CA, AU, AE, BR, SG, DE, FR, ES, CH, SE, NO, JP, HK, NZ, MX, ZA (from research). SWIFT/BIC always shown as an optional field.
- Unit-test the map (IT→IBAN, IN→Account Number+IFSC, US→Account Number+Routing, GB→Account Number+Sort Code, unknown→Account Number).

### Bank logo + autocomplete (free, graceful)
- Server route `GET /api/wealth/bank-search?q=<name>` → proxies **Brandfetch Brand Search** (`https://api.brandfetch.io/v2/search/<q>` with `Authorization: Bearer ${BRANDFETCH_APIKEY}`). Returns `[{ name, domain, icon }]`. On any failure/empty → `[]` (the field still works as free text).
- Server route `GET /api/wealth/bank-logo?domain=<d>` → fetches the logo image server-side with a **fallback chain**: Brandfetch CDN (`https://cdn.brandfetch.io/<domain>?c=<id>` if available) → Google favicon (`https://www.google.com/s2/favicons?domain=<domain>&sz=128`, no key) → DuckDuckGo (`https://icons.duckduckgo.com/ip3/<domain>.ico`). Returns `{ logo_url, logo_data, file_type }` (base64). Used at save time to persist `logo_data` on the account; `logo_url` is what the UI renders (cheap, cached).
- Account create/patch accept `country, account_number, routing_number, swift, address, location, note, brand_domain, logo_url, logo_data`. The accounts **list** returns `logo_url` (not `logo_data`) to avoid payload bloat.
- `WealthAccountIcon` renders `logo_url` (rounded image) when present, else falls back to the existing lucide icon.

### UI
- **Create/Edit account dialog** (`WealthAccountDialogs`): bank-name field becomes a **combobox** with async Brandfetch results (debounced 300ms) — selecting fills name + domain + logo preview. Below: Country select (drives the dynamic primary field label + secondary field), primary number field, secondary field (conditionally shown), SWIFT/BIC, Location, Address (textarea), Note (textarea). Keep it a clean, sectioned bottom-sheet form; advanced fields under a collapsible "Bank details (optional)".
- **Account detail page** gains a "Details" area (logo, country flag, masked account number, SWIFT, location, note) and an **Attachments** section (reuse the attachment upload pattern → `/api/wealth/accounts/:id/attachments`). The **Close account** action is a clear, confirmed button (reuses archive).

### Files
- Create: `src/lib/bank-fields.ts` (+ test), `api/_routes/wealth/bank-search.ts`, `api/_routes/wealth/bank-logo.ts`, `api/_routes/wealth/accounts/[id]/attachments.ts`, `src/components/wealth/BankNameCombobox.tsx`, `src/components/wealth/AccountDetailsForm.tsx`.
- Modify: `schema.ts`, `types.ts`, `api/_routes/wealth/accounts.ts` + `accounts/[id].ts`, `api/index.ts`, `api-router.ts`, `WealthAccountDialogs.tsx`, `WealthAccountDetailPage.tsx`, `WealthAccountIcon.tsx`, i18n. Add `ibantools` to deps.

### Acceptance
- Typing a bank name suggests real banks with logos; selecting stores the logo on the backend and shows it on the card. Country select relabels the account field (IBAN vs Account Number vs …) and reveals the right secondary field. Address/location/note/attachments persist. The account can be closed from its detail page.

---

## 8. Feature 4 — Account-to-account transfers

### Data model (migration 0028)
`transactions` gains **`kind text NOT NULL DEFAULT 'standard'`** (`'standard' | 'transfer'`). A transfer is two legs sharing a `group_id` (from Feature 1) with `kind='transfer'`: an `outgoing` leg on the source account and an `incoming` leg on the destination, same amount/date, attached to the org's default/own client (`ensureDefaultClient`). Transfers are **excluded** from the global transactions list, the income/expense summary, and analytics via a `kind <> 'transfer'` filter; they DO appear (styled as transfers) on each account's detail list.

### API
- `POST /api/wealth/transfer` — body `{ from_account_id, to_account_id, amount, date?, note? }`. Validates both accounts (active, org-scoped, distinct), creates the two legs (shared `group_id`, `kind='transfer'`), syncs both balances, returns `{ group_id, from_leg, to_leg }`. Attachments (optional) attach to the outgoing leg via the existing attachments route.
- Global list query (`transactions.ts`) and analytics add `ne(transactions.kind, 'transfer')` to default views. Account-detail (`?wealthAccountId=`) keeps transfers and labels them.

### UI
- **Drag-and-drop** on `/wealth`: add `@dnd-kit/core` (touch + mouse via PointerSensor). Each AccountCard is draggable and a drop target. Dropping A→B opens the **transfer wizard**.
- **Transfer wizard** (`src/components/wealth/TransferWizard.tsx`) — bottom-sheet, N26-style steps: **Step 1** big amount input (from→to summary, validates ≤ source balance with a soft warning), **Step 2** date + note + attachments, then **Confirm**. Smooth step transitions (grid `0fr↔1fr`/translate, respect reduced motion). Also expose a non-drag **"Transfer"** button on the page header (opens the wizard with empty from/to selectors) so it's discoverable and keyboard/AT accessible.
- Account-detail list renders transfer legs with a transfer glyph (`ArrowLeftRight`) and "Transfer to/from <account>".

### Files
- Create: `api/_routes/wealth/transfer.ts`, `src/components/wealth/TransferWizard.tsx`, `src/components/wealth/AccountDndCard.tsx` (or wrap existing card).
- Modify: `schema.ts`, `types.ts`, `transactions.ts` (+ analytics route) for the `kind` filter, `api/index.ts`, `api-router.ts`, `WealthPage.tsx` (DnD context + Transfer button), `WealthAccountDetailPage.tsx` (transfer row styling), i18n. Add `@dnd-kit/core` (+ `@dnd-kit/utilities`) to deps.

### Acceptance
- Dragging card A onto B (mouse AND touch) opens the wizard; completing it moves money (A down, B up), shows a "Transfer to B"/"Transfer from A" row on each account, never appears in the global Transactions list/analytics, and is never offered in the add-transaction modal.

---

## 9. Risks & mitigations
- **Grouped-list query regressions** (pagination/summary) → keep summary as raw-row SUM; add unit tests for `summarizeLegs`; browser-verify totals before/after.
- **Neon HTTP has no multi-statement tx** → group/transfer inserts are best-effort sequential (matches existing balance-sync); on a mid-failure, return partial + the client refetches. Document as known limitation (pre-existing).
- **Brandfetch quota/availability** → all logo/search paths degrade to free favicon services or plain text; never block account creation.
- **i18n parity gate** → propagate every new en key to all locales before committing (`scripts/i18n-fill.mjs`).
- **DnD on mobile** → use `@dnd-kit` PointerSensor with an activation constraint so taps/scroll still work; provide the non-drag Transfer button as a fallback.

## 10. Definition of done (per branch)
`i18n:check` + `lint` + `typecheck` + `test:ci` all green · browser-verified on mobile (390×844) and desktop · branch pushed · this doc's Branch Tracker updated.
