# ProfitSync Implementation Checklist

Last updated: 2026-05-24

## Status Legend
- [ ] Not started / not tested
- [x] Complete / Verified
- [~] In progress / partial

---

## Security Fixes

- [x] Fix `api/transactions.ts` GET — was returning ALL users' transactions (CRITICAL data leak fixed)
- [x] Fix `api/transactions.ts` GET — now joins with clients table and scopes by `userId`
- [x] Fix `api/transactions.ts` GET — includes `client_name` in response
- [x] Add status validation in `api/clients.ts` POST — rejects values not in `active|inactive|archived`
- [x] Add status validation in `api/clients/[id].ts` PATCH — same
- [x] Add currency validation in `api/profile.ts` PATCH — rejects unknown currency codes
- [x] Filter soft-deleted clients from `api/clients.ts` GET
- [x] Filter soft-deleted clients from `api/clients/[id].ts` GET (returns 404 if soft-deleted)
- [x] Filter soft-deleted clients from `api/transactions.ts` GET (join ensures this automatically)

## Database Schema

- [x] Add `deleted_at` column to `clients` table
- [x] Create `quotations` table with all fields: id, user_id, title, prospect_name, company, email, phone, amount, status, notes, linked_client_id, deleted_at, created_at, updated_at
- [x] Run `npm run db:push` to apply schema to Neon

## Types (src/lib/types.ts)

- [x] Add `deleted_at?: string | null` to `Client` type
- [x] Add optional `client_name?: string` to `Transaction` type
- [x] Add `Quotation` type

## API Routes

### Modified routes
- [x] `api/clients.ts` — filter `isNull(deletedAt)`, add status validation
- [x] `api/clients/[id].ts` — soft delete (set deletedAt), filter deleted on GET, status validation
- [x] `api/transactions.ts` — fix userId scope, include client_name
- [x] `api/transactions/[id].ts` — scoped to userId via client join

### New routes
- [x] `api/quotations.ts` — GET all (with optional `?linked_client_id=`) + POST
- [x] `api/quotations/[id].ts` — GET one + PATCH + DELETE (soft)
- [x] `api/quotations/[id]/convert.ts` — POST: convert quotation to client
- [x] `api/trash.ts` — GET all soft-deleted (clients + quotations)
- [x] `api/trash/restore.ts` — POST: restore a client or quotation
- [x] `api/trash/purge.ts` — DELETE: permanently delete a client or quotation

## Frontend Pages

### New pages
- [x] `src/pages/TransactionsPage.tsx` — all transactions, filter/search, add/edit/delete
- [x] `src/pages/QuotationsPage.tsx` — quotations list, create, edit, convert, delete, search
- [x] `src/pages/TrashPage.tsx` — deleted clients + quotations, restore, permanent delete

### Modified pages
- [x] `src/pages/ClientDetailPage.tsx` — shows linked quotation info; "Delete Client" moves to trash
- [x] `src/pages/ClientsPage.tsx` — "Delete" moves to trash; soft-deleted clients excluded
- [x] `src/components/AppLayout.tsx` — added Transactions, Quotations, Trash to sidebar
- [x] `src/App.tsx` — added routes for /transactions, /quotations, /trash

---

## Testing Checklist

### Authentication & Security
- [x] Soft-deleted clients do not appear in the clients list — **VERIFIED**
- [x] Soft-deleted clients' transactions are hidden — **VERIFIED** (join on clients filters deleted)
- [ ] Unauthenticated request to any API route returns 401 — code-reviewed; not browser-tested
- [ ] User A cannot access User B's data — code-reviewed (userId scoping on all routes); requires 2 accounts to browser-test

### Clients
- [x] Create client — works (name required, form validated)
- [x] Edit client — all fields update correctly
- [x] Delete client → moved to trash (not permanently deleted) — **VERIFIED** (Task #7)
- [x] Soft-deleted client is not visible on /clients page — **VERIFIED** (Task #7)
- [x] Soft-deleted client's transactions are hidden — **VERIFIED**

### Transactions
- [x] Transactions page shows all transactions across all clients — **VERIFIED** (Task #10)
- [x] Transactions page type filter (income/expense) works — **VERIFIED**
- [x] Transactions page search works — **VERIFIED** (Task #11): matching term shows results; no-match shows empty state
- [x] Add transaction from transactions page — **VERIFIED** (Task #10)
- [x] Edit transaction from transactions page — **VERIFIED** (Task #10): amount updates, dialog pre-fills
- [x] Delete transaction from transactions page — **VERIFIED** (Task #10): confirmation dialog, row removed
- [x] Client name links to client detail page — **VERIFIED**: clicking "Acme Corporation" on Transactions page navigates to ClientDetailPage
- [ ] Adding/editing/deleting transaction from ClientDetailPage still works — not re-tested (existing flow unchanged)

### Quotations
- [x] Create quotation — **VERIFIED**: all fields save correctly, Draft status default
- [x] Edit quotation — **VERIFIED**: dialog pre-fills, updates save
- [x] Search works (prospect name, company, title) — **VERIFIED** (Task #11): "testco" match and no-match tested
- [x] Filter by status works — **VERIFIED** (Task #11): Draft tab shows Draft only; Accepted tab shows empty state
- [x] Convert to client — **VERIFIED** (Task #6): creates new client, links quotation, navigates to client page
- [x] After converting, quotation shows "linked client" badge — **VERIFIED** (Task #6)
- [x] After converting, cannot convert again (button disabled) — **VERIFIED** (Task #6)
- [x] Delete quotation → moved to trash — **VERIFIED**
- [x] Deleted quotation not visible in quotations list — **VERIFIED**
- [ ] Client detail page shows source quotation if applicable — visible in ClientDetailPage but quotation-to-client link display not explicitly browser-tested end-to-end

### Trash
- [x] Deleted clients appear in trash — **VERIFIED** (Task #8)
- [x] Deleted quotations appear in trash — **VERIFIED**
- [x] Restore client → client reappears in /clients — **VERIFIED** (Task #8)
- [x] Restore quotation → quotation reappears in /quotations — **VERIFIED**
- [x] Permanently delete client from trash → completely removed — **VERIFIED** (Task #9)
- [x] Permanently delete quotation from trash → completely removed — **VERIFIED**
- [ ] Restoring a client that was linked to a quotation preserves the link — not explicitly tested

### Dashboard
- [x] Soft-deleted clients are excluded from dashboard totals — **VERIFIED**: dashboard chart shows only active clients, deleted ones absent
- [x] Currency selection applies across dashboard — **VERIFIED**: changing USD→SAR and back, dashboard immediately reflects new symbol

### Currency
- [x] Currency change in profile applies to dashboard — **VERIFIED**: switching USD→SAR immediately updates dashboard totals
- [ ] Currency change applies to clients page — not explicitly tested (uses same CurrencyProvider)
- [ ] Currency change applies to client detail page — not explicitly tested (uses same CurrencyProvider)
- [x] Currency change applies to transactions page — **VERIFIED**: "$5,000.00" shown after USD switch
- [ ] Currency change applies to quotations page — not explicitly tested (uses same CurrencyProvider)

### UI / UX
- [x] Sidebar shows: Dashboard, Clients, Transactions, Quotations, Trash — **VERIFIED** (visible in all test screenshots)
- [x] Active page is highlighted in sidebar — **VERIFIED**
- [x] Dark mode works across all new pages — **VERIFIED** (app runs in dark mode throughout)
- [x] Loading skeletons shown while data loads — **VERIFIED** (seen during page loads)
- [x] Empty states shown when no data — **VERIFIED** (Accepted tab, no-match search)
- [x] Toast notifications on success/error — **VERIFIED** (success toasts on create/edit/delete/restore)
- [ ] Mobile responsive layout works — not tested

---

## Known Minor Issues

1. **Description field in edit transaction**: React controlled input update via JS synthetic event correctly triggers amount changes but the description text field may not visually refresh in the dialog during automated testing. Actual saves work correctly (verified via API).

## Fixed Issues

1. **Loading count flash** (fixed): QuotationsPage and TrashPage were showing "0 quotations" / "0 items in trash" during the API fetch. Fixed by wrapping count paragraphs in `{!loading && (...)}`.

2. **Currency validation too restrictive** (fixed): `api/profile.ts` had a hardcoded list of 11 currencies while the UI offered 160+. Any currency outside the 11 (e.g. SAR) would fail to save with 400. Fixed by deriving `VALID_CURRENCIES` from `CURRENCY_LIST` in `src/lib/currencies.ts`.
