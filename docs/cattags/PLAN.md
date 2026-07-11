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
| 01 | `feat/cattags-01-schema` | mig 0050: tags on clients+quotations (+GIN), `tags` registry; schema.ts + types.ts | ⬜ |
| 02 | `feat/cattags-02-tags-lib-api` | generalize tags lib; clients/quotations tag read/write + `?tag=`; registry CRUD + rename cascade | ⬜ |
| 03 | `feat/cattags-03-tags-entities-delete` | `/api/tags/entities` drilldown; delete-with-choice (tag_only / with_records soft-delete + balance reversal) | ⬜ |
| 04 | `feat/cattags-04-categories-api` | combined create/edit/delete (multi-type, rename cascade to clients+quotations); `/api/categories/entities` drilldown | ⬜ |
| 05 | `feat/cattags-05-sidebar-tabs` | nav rename; `/categories` → tabbed `CategoryTagsPage` shell; i18n | ⬜ |
| 06 | `feat/cattags-06-categories-ui` | Category tab: combined list, multi-select create/edit, delete; drilldown w/ filter+date+sort+nav | ⬜ |
| 07 | `feat/cattags-07-tags-ui` | Tags tab: list/search/create/edit/delete-with-choice; drilldown | ⬜ |

Order rationale: schema first, then the backend it enables (tags before categories because tags
need the migration), then the shell, then the two UI tabs. Each branch passes the gate before push.

## Change log
- **2026-07-11** — Plan committed on `feat/cattags-00-plan`.
