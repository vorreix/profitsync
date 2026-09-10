# Work Fine-Tuning — ProfitSync conventions & corrections

Project-specific ground truth + the corrections this skill learned the hard way.
Read alongside the repo's `CLAUDE.md` (authoritative architecture).

## Stack facts that change how you implement

- React 19 + TS + Vite, Tailwind v4, shadcn/ui (vendored — don't hand-edit
  `src/components/ui/*`; add via the CLI). react-router-dom v7, Clerk auth, Neon +
  Drizzle, Vercel serverless under `api/_routes/**` behind one `api/index.ts`
  router, i18next (8 locales), recharts, sonner.
- **API imports MUST use `.js` extensions** (unbundled `@vercel/node` ESM) or prod
  500s. Shared code in `src/lib` is importable by both client and API.
- **Every API query scoped by `orgId`** from `requireAuth()`, never `userId`. Call
  `serialize(row)` before `res.json`. Role (`canWrite`/`canDelete`) + quota checks
  before writes.
- **Wealth `current_balance` is STORED, not derived.** create `+delta`, delete
  `−delta` (reverse), restore `+delta`. The single source of truth for the sign is
  `src/lib/wealth-ledger.ts` (`balanceDelta`/`reverseDelta`/`reversalsByAccount`/
  `applicationsByAccount`) — unit-tested. Reuse it; never re-derive the sign inline.
- Split transactions = N leg rows sharing `group_id` (no separate "main" row). The
  global list collapses via `coalesce(group_id, id)`. Expand a selection to all
  legs with `api/_lib/tx-legs.ts#resolveTxLegs` before deleting/purging.
- Forms: the project convention is zod; for the existing *controlled* forms use
  `src/lib/use-field-errors.ts` (zod → `aria-invalid` red borders) rather than a
  full react-hook-form rewrite.
- Perceived speed / smooth mutations (see playbook → "Smooth data mutations"):
  - `src/lib/api.ts#invalidateKeys(prefixes)` — granular cache; `apiPost/Patch/Delete`
    take an optional `invalidate` scope (default = safe clear-all).
  - `src/lib/optimistic.ts#runOptimistic` (instant-save illusion + rollback).
  - Each list page's `fetchPage1` takes `{ silent }` to reconcile without the
    skeleton. Add/edit/delete update the list **in place** (TransactionsPage,
    ClientsPage, QuotationsPage all do this) — no full reload. Delete is fully
    optimistic incl. summary deltas; grouped transactions use silent‑refetch for
    add/edit (rows are server‑shaped) but optimistic delete.
- Persisted UI state: `src/lib/wealth.ts#usePersistedOpen(key, fallback)` —
  localStorage‑backed collapse state, keyed per entity (e.g. the wealth
  Account‑Detail/Attachments cards). Use it instead of `defaultOpen`.
- Attachments: `src/components/transactions/TransactionAttachments.tsx` is a reusable
  manager (list + add + `AttachmentDetailModal` for preview/download/rename/delete),
  used in the transaction edit dialog. `AttachmentDetailModal` already does
  preview(image/pdf/text)/download/rename/delete; `attachments-client.ts` has
  `uploadAttachment`/`attachmentsListPath`/`validateFile`/`ACCEPT_ATTR`.
- `WealthAccountIcon` renders a real bank logo (`logo_url`) `object-cover scale-110`
  to fill the round; reused by wealth cards + the Add/Edit Transaction `AccountSelector`.
- Plans: `plans.account_type` is `personal|business|null`; `accountTypeAllows()`
  gates business features (clients/quotations/members). The `free` tier is a shared
  quota layer (account_type null) applying to both.
- The dev DB == the cloud Development DB (they're the same). Clean up test rows.
  A dev test account can be onboarded as **Company** to unblock verification of
  business-gated pages (reversible; note it in the doc).

## Corrections we've had to make (don't repeat these)

Research agents produced these **wrong** recommendations; each was caught by
re-deriving from code. Treat any similar claim with suspicion.

- ❌ "The outgoing delete-balance reversal sign is inverted." **False** — create is
  `balance + delta`, delete is `balance − delta`, which correctly undoes it for
  both directions. "Fixing" it corrupts every delete. (Locked by
  `wealth-ledger.test.ts`.)
- ❌ "Trash purge of a transaction lacks balance reversal — add one." **False** — a
  trashed transaction is already soft-deleted, so its balance was already reversed;
  reversing again on purge **double-reverses**. Purge must NOT touch balances for
  already-soft-deleted rows. (Client purge reverses only still-*live* transactions,
  for pre-fix data.)
- ❌ "Remove `index.html` from the PWA precache to avoid stale shells." **Unsafe** —
  that breaks Workbox `navigateFallback` (needs a precached URL). Instead recover
  client-side: an inline `<script>` in index.html reloads once on an `/assets/`
  load error (the entry-chunk case a React boundary can't catch), a root
  `AppErrorBoundary`, broadened `register-sw.ts` listeners, and immutable `/assets`
  cache headers in `vercel.json`.
- ❌ "Migrate all forms to react-hook-form for red borders." **Too risky** blind in
  a financial app — use the zod `aria-invalid` hook on the existing controlled
  forms instead.
- ⚠️ T16 gate: hide business-only plan limits on `account_type === 'personal'`
  (the user's actual report), not only on `key === 'free'`.
- ⚠️ **"Primitives + one reference" is not "done" for perceived speed.** Shipping
  `invalidateKeys`/`runOptimistic` + a single example left every other list still
  doing a full‑reload refetch — the user came back saying "you're loading the whole
  screen again." Roll surgical in‑place updates out to **every** mutating list
  (Transactions, Clients, Quotations) in one pass.
- ⚠️ **Split‑edit recreates the transaction.** `handleEdit` for a split (or a single
  edited into multiple allocations) does delete‑group‑then‑recreate, which would
  orphan attachments. So only expose attachment management in the edit dialog for
  **single, non‑split** transactions (`!group_id && allocations.length <= 1`).
- ⚠️ **Persisting a UI toggle ≠ it reaches the user.** After implementing
  `usePersistedOpen`, a "still not working" report was an environment/stale‑bundle
  issue, not the code (proven via `localStorage` + `data-state` after reload). When
  re‑reported, re‑verify on the running server with the inspector before assuming a
  bug, and tell the user to hard‑refresh / note unmerged branches won't be on `dev`.

## The Drizzle journal-timestamp gotcha (bit us again)

`npm run db:generate` sometimes stamps the new migration's `when` *below* the
previous entry → migrator says "up to date" and **silently skips** it. Always bump
the new `when` above the previous in `drizzle/meta/_journal.json`, apply, and
**confirm the column exists** via `information_schema.columns`.

## Verification access notes

- A non-admin test user gets a `/api/admin/me` 403 on every app load — that's
  expected `AdminProvider` behaviour, not a regression. Ignore it when counting
  console errors.
- Admin pages (`/admin/**`) can't be Playwright-verified without an app-admin user;
  fall back to typecheck + review and say so.

## The eslint warning you'll see

`AppErrorBoundary.tsx` trips `react-refresh/only-export-components` (a class
boundary + a helper component in one file). It's a **warning**, the gate passes
(eslint exits 0 on warnings). Don't chase it.
