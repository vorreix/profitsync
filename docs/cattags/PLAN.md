# Category & Tags — Build Plan (live tracker)

**Started:** 2026-07-11 · **Root branch:** `feat/cattags-00-plan` (off `dev`)
**Owner directive:** autonomous ("do everything by yourself, no inputs from my side").

Turn the sidebar **Category** section into **Category & Tags** with two tabs, add a full
tag system (registry + entity tagging across transactions/clients/quotations), multi-type
categories, per-entity drilldowns with filter/date/sort, and delete-with-choice for tags.

---

## Working conventions (non-negotiable)

- **Org-scope every query** by `orgId` from `requireAuth()` — never `userId` alone.
- `serialize(row)` before every `res.json(row)`.
- `.js` extensions on all relative `api/` imports (unbundled ESM on @vercel/node).
- `canWrite(role)` / `canDelete(role)` before mutations; `check*Quota` before creates where relevant.
- **i18n**: every user-visible string via `useTranslation()`; add to `en.json` first, then
  propagate to all 7 other locales (`scripts/i18n-merge.mjs` is additive) — `i18n:check` gates the commit.
- **Mobile-first**: design at ~390px first, ≥44px touch targets, reuse responsive primitives.
- **Optimistic in-place updates**: create → insert returned row; edit → replace; delete →
  remove optimistically + adjust totals; silent refetch only on failure. Never flash a skeleton.
- **Money rule**: a `with_records` tag delete that soft-deletes transactions MUST reverse
  wealth balances (recompute from ledger — a DB-direct delete does not).
- **Full pre-commit gate** on every branch (secret-scan → esm-extensions → boot-functions →
  route-guards → i18n → lint → typecheck → test:ci). No `--no-verify`.
- New API routes: handler in `api/_routes/`, import + register in `api/index.ts`
  (static route before dynamic sibling at the same depth).

## Ground truth (verified in code)

- `categories` table = per-`(org, name, type)` rows; `type ∈ {incoming, outgoing, client, quotation}`;
  unique `(org, type, name)`. Entities store the category **name as free text**
  (`transactions.category`, `clients.category`, `quotations.category`). Rename currently
  cascades only to `transactions.category`.
- **Tags** live only on `transactions.tags` (jsonb `string[]`, GIN-indexed, `?tag=` `@>`
  filter). Shared pure lib `src/lib/transaction-tags.ts` (normalize `#tag`, cap 20 × 40).
  `clients` / `quotations` have **no** tags column yet.
- Nav item `nav.categories → /categories` in `AppLayout.tsx` + `MobileAppLayout.tsx` (icon `Tag`).
  Route `/categories → CategoriesPage` in `App.tsx`.
- Migration head is **0049**; the next feature migration is **0050** (bump journal `when` above
  `1783773043762`; use `IF NOT EXISTS` for db:push-residue safety; verify columns/table exist after migrate).

## Key design decisions

### Categories — NO schema change (aggregate existing rows)
A **logical category** = all `categories` rows sharing `(org, name)`; its type-set = the
`type` values among those rows.
- **Combined list**: aggregate the already-fetched rows by name → `{ name, color, types[] }`
  (client-side; no new list endpoint).
- **Create**: extend POST to accept `types: string[]` (keeps back-compat `type`), inserting
  one row per type, `onConflictDoNothing`.
- **Edit**: `PUT /api/categories/combined { oldName, newName, types[], color }` in one pass:
  insert rows for newly-selected types, delete de-selected, rename old→new across all rows,
  and **cascade rename** to `transactions.category` / `clients.category` / `quotations.category`.
  Reject if `newName` collides with a different logical category.
- **Delete (logical)**: `DELETE /api/categories/combined?name=X` removes all rows sharing the
  name; entity free-text is left intact (orphan-safe, matches current behaviour).
- **Drilldown**: `GET /api/categories/entities?name=X&types=&dateFrom&dateTo&sort` → org-scoped
  union of matching transactions/clients/quotations, each with entity type + nav link.

### Tags — migration 0050 + a small registry (mirrors categories)
- **Migration 0050**: `tags jsonb NOT NULL DEFAULT '[]'` + GIN on **clients** and **quotations**;
  a **`tags` registry** table `(id, organization_id, name, color, created_at, updated_at)` unique
  `(org, name)`.
- **Shared lib**: generalize `transaction-tags.ts` → `src/lib/tags.ts` (back-compat re-exports).
- **Registry CRUD**: `/api/tags` (GET list + usage counts, POST create), `/api/tags/:id`
  (PATCH rename, DELETE). GET unions the registry with tags actually present on entities.
- **Entity tags**: clients + quotations POST/PATCH accept + normalize `tags`; `?tag=` filter on
  both list routes.
- **Rename**: registry row + rewrite the string across all three tables' arrays (org-scoped).
- **Delete-with-choice** `DELETE /api/tags/:id?mode=tag_only|with_records`:
  - `tag_only`: strip the tag from every entity array + delete registry row (entities survive).
  - `with_records`: **soft-delete** (to Trash, reversible) every entity carrying the tag +
    delete registry row; transactions reverse wealth balances (recompute from ledger). Never hard-delete.
- **Drilldown**: `GET /api/tags/entities?tag=X&types=&dateFrom&dateTo&sort` → org-scoped union.

### Sidebar + routing
- Rename `nav.categories` → `nav.categoryTags` ("Category & Tags"); **keep** the `/categories`
  path (avoid breaking bookmarks/tests). Page becomes a tabbed shell (`Category | Tags`) with
  `?tab=tags` deep-link. Drilldowns are in-page panels (mobile-first, back-close) keyed by name/tag.

## Branch chain (stacked off `dev`)

| # | Branch | Delivers | Status |
|---|--------|----------|--------|
| 00 | `feat/cattags-00-plan` | This PLAN.md on the root branch | ✅ done |
| 01 | `feat/cattags-01-schema` | mig 0050: tags on clients+quotations (+GIN), `tags` registry; schema.ts + types.ts | ✅ done |
| 02 | `feat/cattags-02-tags-lib-api` | generalize tags lib; clients/quotations tag read/write + `?tag=`; registry CRUD + rename cascade | ✅ done |
| 03 | `feat/cattags-03-tags-entities-delete` | `/api/tags/entities` drilldown; delete-with-choice (tag_only / with_records soft-delete + balance reversal) | ✅ done |
| 04 | `feat/cattags-04-categories-api` | combined create/edit/delete (multi-type, rename cascade to clients+quotations); `/api/categories/entities` drilldown | ✅ done |
| 05 | `feat/cattags-05-sidebar-tabs` | nav rename; `/categories` → tabbed `CategoryTagsPage` shell; i18n | ✅ done |
| 06 | `feat/cattags-06-categories-ui` | Category tab: combined list, multi-select create/edit, delete; drilldown w/ filter+date+sort+nav | ✅ done |
| 07 | `feat/cattags-07-tags-ui` | Tags tab: list/search/create/edit/delete-with-choice; drilldown | ✅ done |

Order rationale: schema first, then the backend it enables (tags before categories because tags
need the migration), then the shell, then the two UI tabs. Each branch passes the gate before push.

## Change log
- **2026-07-11** — Plan committed on `feat/cattags-00-plan`.
- **2026-07-11** — Branches 01–03 shipped: mig 0050 (tags on clients+quotations + `tags` registry), generalized `src/lib/tags.ts`, tag read/write + `?tag=` filter on clients/quotations, `/api/tags` registry CRUD + rename cascade, `/api/tags/entities` drilldown, and delete-with-choice (`tag_only` / `with_records` soft-delete with ledger balance reversal — DB-verified 1119→999 exact). Gate green each.
- **2026-07-11** — Branch 04 shipped: combined categories API — multi-type `POST /api/categories` (`types[]`, collision 409, per-org cap), `PUT /api/categories/combined` (add/remove/rename per-type rows + cascade rename to transactions/clients/quotations free-text), `DELETE ?name=` (logical, orphan-safe), and `GET /api/categories/entities` drilldown (CategoryType→table + tx.type mapping, filter/date/sort/deep-links). DB-verified: drilldown counts + rename cascade across all three tables, sibling categories untouched. Gate green.
- **2026-07-11** — Branch 05 shipped: `/categories` is now a tabbed `CategoryTagsPage` shell (Category | Tags, `?tab=tags` deep-linkable, same URL-sync pattern as ProfilePage). Extracted the existing category management verbatim into `src/components/categories/CategoriesPanel.tsx` (container-less; shell owns page title); `TagsPanel.tsx` is a stub filled in branch 07. Sidebar + mobile nav renamed `nav.categories` → `nav.categoryTags` ("Category & Tags"); path unchanged. New `categoryTags` + `tags` i18n namespaces across all 8 locales. **Verification: typecheck + lint + i18n + full prod build (chunk invariant holds, `CategoryTagsPage` chunks cleanly); live Playwright deferred to branch 06** (auth-gated page; the interactive combined UI lands there, so the browser session is set up once and reused).
- **2026-07-11** — Branch 07 shipped: **Tags tab UI**, fully browser-verified — the feature is now complete. New `useTags` hook (`src/lib/use-tags.ts`) pulls the MERGED registry+usage list from `GET /api/tags` (inline tags come back `id:null`); new `TagUsage` type in `types.ts`. `TagsPanel` (was a stub) rewritten around it, reusing every pattern proven in branch 06: a merged list sorted by usage (badges per entity type + an "Unused" pill), an always-mounted state-driven `TagDialog` (name normalized to `#hashtag`, space→dash, `#` auto-prefixed + preset color) with optimistic `mutateLocal` insert/replace + silent refresh, and the shared **`EntityDrilldown`** (endpoint `/api/tags/entities`, `typeOptions` transaction/client/quotation, client-side chip filter reconciled to `count>0` + server date/sort, rows deep-link with `navigate(replace)`). **Delete-with-choice** is a dedicated `DeleteTagDialog`: "Remove tag only" (strip everywhere, records survive) always, plus a red "Delete tag & records" (soft-delete the N tagged records to Trash, reversible, ledger-safe) shown only when the tag has usage. **Inline tags (`id:null`) are materialized** with a POST before any PATCH/DELETE (the registry-id routes require a row). New `tags` i18n namespace (43 keys) across all 8 locales (dropped the old `panelStub`); 1454 keys in sync. **Verified with Playwright** on the test org (seeded `#travel` on a client+tx+quotation and `#urgent` on the tx): list + usage badges correct; create `#high-value` (space→dash, blue, "Unused", optimistic) → 3 tags; drilldown `#travel` = 3 items across all types with reconciled chips (Tx 1/Client 1/Quotation 1), Clients-chip → 1, row click → `/clients/:id`, browser-back → clean list; edit inline `#urgent` → `#priority` (materialize + **rename cascade** kept its tx count, recolor red); delete `#priority` with-records → tx soft-deleted (**DB-verified `deleted_at` set, `#priority` stripped, `#travel` re-reconciled to Clients 1/Quotation 1** as the shared tx left), "Tag and 1 record deleted"; delete unused `#high-value` tag-only → single option, registry row removed. Test data cleaned up (DB-verified 0 tagged tx / 0 registry rows). Gate green.
- **2026-07-11** — Branch 06 shipped: **Category tab UI**, fully browser-verified. `src/lib/categories.ts` `combineCategories()` folds the per-`(name,type)` rows into one logical category (earliest-created row wins name+color, canonical type order; case-insensitive) with a DB-free vitest. `CategoriesPanel` rewritten around it: combined rows show a colored tag dot + one badge per type; a shared always-mounted `CategoryDialog` does add/edit (name + 4-way multi-select "Applies to" + preset color) with optimistic `mutateLocal` insert/replace/remove + silent refresh; delete confirms then removes. Reusable **`EntityDrilldown`** (`src/components/entity-drilldown/`, shared with tags branch 07): a right Sheet fetching `{items,counts}` from an endpoint+query, type chips **filter client-side** (only rendered for types with `count>0`, so counts always reconcile with the item total) + server-side date-range + sort, rows deep-link (tx→`/transactions?view=`, client→`/clients/:id`, quotation→`/quotations?view=`). **Verified with Playwright** on a fresh test org: combined list (11 categories, each Income+Expense); create "Consulting" (Income+Expense+Client, blue) → 12; edit drops Expense → Income+Client; delete → 11; drilldown Marketing shows 3 items with reconciled chips (Income 1/Expense 1/Client 1), Client-chip filter → 1 item, click→transaction peek, browser-back→clean list. **Fixes found only by exercising the real UI:** (a) drilldown chips derived from the category's registered types missed entities referencing the name via free-text for other types → now derived from `count>0`; (b) row click did `onClose(); navigate()` — the back-close `navigate(-1)` raced the push and stranded on `/categories` → now a single `navigate(link,{replace:true})`; (c) the type toggle nested a Radix `<Checkbox>` (a `<button>`) inside a `<button>` (invalid HTML / hydration error) → visual-only checkbox span; (d) the add/edit dialog was conditionally mounted with hardcoded `open`, so StrictMode's double-invoked back-close effect `history.back()`'d it shut on open → refactored to the always-mounted `open={state!==null}` pattern (matches `SpaceTransferModal`). Added `categories.dialogDescription` (8 locales) + wired `SheetDescription`/`DialogDescription` for a11y. Gate green (342 tests).
