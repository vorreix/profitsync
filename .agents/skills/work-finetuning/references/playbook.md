# Work Fine-Tuning — playbook mechanics

Concrete, copy-ready mechanics for the procedure in `SKILL.md`. Adapt commands to
the host project; the shapes are what matter.

## A. Deep parallel research workflow

Run ONE read-only agent per task cluster via the Workflow tool. Structured output
schema (per task):

```
{ taskId, title, summary,
  relevantFiles: [{path, role}],
  currentBehavior,            // how it works today, WITH file:line
  rootCauseOrGap,             // the precise cause / missing piece
  recommendedApproach,        // grounded, fits existing patterns
  filesToModify: [{path, change}],
  newFiles?: [{path, purpose}],
  risks: [string],
  migrationNeeded: bool, i18nKeysNeeded: bool,
  complexity: "low"|"medium"|"high" }
```

Per-agent prompt preamble: "Senior engineer doing DEEP read-only research on
<repo>. Stack: <one-line stack>. Read CLAUDE.md/AGENTS.md first. Trace ACTUAL
execution paths and cite file:line. Do NOT edit. Be concrete — name exact
functions/components/routes/columns. Return via the structured schema."

While it runs, read the cross-cutting infra yourself: data/cache layer, modal
primitives, auth/scoping, money/ledger, build/PWA config. You need ground truth to
judge the agents.

When the workflow result is large, it's written to a file — read it in pages, and
**re-derive any behaviour-changing / money claim by hand** before trusting it.

## B. The quality gate

Mirror the project's husky pre-commit. For ProfitSync:

```
npm run i18n:check   # locale parity (source locale = source of truth)
npm run lint         # eslint (warnings OK here; errors block)
npm run typecheck    # tsc across app/node/api tsconfigs
npm run test:ci      # vitest run
```

The gate runs automatically on `git commit`. Run `npm run typecheck` after each
edit batch to catch errors early (faster than waiting for the full hook). If a
declared dependency is missing locally (e.g. typecheck can't find a package that's
in package.json), run `npm install` first.

## C. i18n propagation

1. Add the new key(s) to the source locale (`en.json`) first.
2. Write `/tmp/<task>-i18n.json` = `{ "<lang>": { "<dotted.key>": "<translation>" } }`
   for every non-source locale, with real translations.
3. `node scripts/i18n-merge.mjs /tmp/<task>-i18n.json` (additive, order-preserving).
4. `npm run i18n:check` to confirm parity. Reuse existing keys where possible to
   avoid new translations.

## D. Migrations (Drizzle) + the journal-timestamp gotcha

1. Edit `src/lib/db/schema.ts`.
2. `npm run db:generate` → review the generated SQL.
3. **Open `drizzle/meta/_journal.json`**: the new entry's `when` is sometimes
   generated *below* the previous entry's normalized value → the migrator reports
   "up to date" and **silently skips** it. Bump the new `when` to exceed the
   previous one (e.g. previous `1780800000003` → set `1780800000004`).
4. Apply locally and CONFIRM the column exists:
   `node -r dotenv/config scripts/db-migrate.mjs dotenv_config_path=.env.local`
   then query `information_schema.columns`. ("up to date" alone is not proof.)

## E. Stacked branch chain + push

```
git checkout <user-base-branch>            # e.g. dev
git checkout -b feat/<name>-00-plan        # commit PLAN.md here (chain root)
git checkout -b feat/<name>-01-<task>      # off the previous branch
# ...implement, gate, commit...
git push -u origin feat/<name>-01-<task>
git checkout -b feat/<name>-02-<task>      # off 01, and so on
```

Each branch = one task, created FROM the previous (so later branches contain all
earlier work). Commit messages end with the project's co-author trailer.

**If you forget to branch and commit on the previous branch:** create the new
branch at the current HEAD (`git branch <new>`), then `git reset --hard <prev-origin-sha>`
the previous branch back to its pushed state, checkout the new branch, push.

PRs: if `gh` is authenticated, open each PR targeting the previous branch (stacked);
otherwise GitHub prints a `pull/new/<branch>` URL on push — record it in the doc.

## F. Playwright / Chrome DevTools verification loop

1. The dev server is usually already running (check `lsof -iTCP:3000 -sTCP:LISTEN`).
2. `browser_navigate` → `browser_take_screenshot` (read the PNG) to confirm the
   change rendered; `browser_console_messages level=error` to confirm no NEW errors
   (an expected `/api/admin/me` 403 for non-admins is fine).
3. Exercise the real flow with `browser_click` / `browser_type` / `browser_press_key`
   (selectors: prefer `#id`; for ambiguous text use `button >> text="X" >> nth=-1`).
4. For correctness, assert the *effect* (e.g. after editing a transaction amount,
   screenshot the account balance and confirm it re-synced).
5. **Clean up** any rows you created (delete via DB or UI; keep balances consistent).
6. If a page is gated behind onboarding/role you can't satisfy, complete the minimal
   safe setup on a clearly-disposable dev/test account (note it), or fall back to
   typecheck + code review and say so in the doc.

## G. Smooth data mutations (the core "feels fast" mechanism)

**The anti-pattern to kill:** a mutation handler that ends with a full-list refetch
which flips `loading=true` and swaps the list for skeletons. That is the
"it reloads the whole screen" the user feels. Replace it everywhere with **surgical
in-place updates**:

| Action | Do this — NOT a full refetch |
|---|---|
| **Create** | `POST` returns the new row → `setItems(prev => [created, ...prev])`; bump `total`/summary. (Flat lists: zero refetch.) |
| **Edit** | `PATCH` returns the updated row → `setItems(prev => prev.map(x => x.id === u.id ? u : x))`. |
| **Delete / bulk-delete** | Remove instantly *before* the request: `setItems(prev => prev.filter(...))` + subtract from `total`/summary; on failure, reconcile with a **silent** refetch + toast. |

**Mechanism details that make it correct AND smooth:**

- **`silent` refetch flag.** Give each page's loader an option: `fetchPage1({silent}: …)`
  that skips `setLoading(true)` (and its error toast). Use it for *every*
  post-mutation reconcile and every rollback, so the list never flashes — React
  diffs by **stable `key={id}`**, so only the changed row re-renders.
- **Optimistic modal close.** A create/edit modal closes **instantly** and saves in
  the background (`runOptimistic({apply, rollback, mutate, errorMessage, onSuccess})`);
  on failure it reopens with the data intact + a toast. The form draft must survive
  the close (don't reset until success) so the retry keeps what was typed.
- **Granular cache.** Replace blunt `clearApiCache()` on mutations with
  `invalidateKeys(['/api/<scope>'])` so unrelated pages stay warm (instant
  back/forward). Keep `clearApiCache()` only for logout/org-switch.
- **When NOT to fully reconstruct optimistically:** for server-shaped/aggregated
  rows that are risky to rebuild client-side (e.g. *grouped* transaction rows with
  income/expense summaries), do **optimistic delete** (easy + high-value) but use a
  **silent refetch** for add/edit — it's authoritative AND flash-free. Flat lists
  (clients, quotations) get full optimistic insert/replace/remove.
- **Summary/aggregate deltas.** When you optimistically remove a row, also adjust the
  visible summary cards (e.g. `summary.incoming -= amount`) so the numbers move with
  the row, not after a refetch.

**Rollout rule:** ship this on *every* list page that mutates. A "primitive + one
reference" is not enough — the user will (rightly) report it still reloads. Verify
each with Playwright: the row appears/disappears and summaries update with **no**
skeleton/flash.

## H. Persisted UI state (survives navigation AND restart)

User toggles (collapsible cards, view modes, "keep it closed") must persist across
reloads/restarts — back them with `localStorage`, not component‑local `defaultOpen`:

```ts
// keyed per entity so each surface remembers its own state; re-reads on key change
export function usePersistedOpen(key: string, fallback = true) {
  const read = (k: string) => { try { const v = localStorage.getItem(k); return v === null ? fallback : v === "1" } catch { return fallback } }
  const [open, set] = useState(() => read(key))
  useEffect(() => { set(read(key)) }, [key])          // re-read when the entity changes
  const setOpen = useCallback((next: boolean) => { set(next); try { localStorage.setItem(key, next ? "1" : "0") } catch {} }, [key])
  return [open, setOpen] as const
}
// <Collapsible open={open} onOpenChange={setOpen}>  — NOT defaultOpen
```

Verify with Playwright by reading `localStorage` + the element `data-state` after a
reload (a reload == a restart for this purpose).

## I. Small UI-polish patterns that recur

- **Compact forms:** pair related fields side by side in `grid grid-cols-1 sm:grid-cols-2`
  (e.g. date + category) instead of stacking full-width.
- **Date defaults:** make the form's `defaultForm` a **function** returning
  `new Date().toISOString().split("T")[0]` so "today" is fresh each open (a const
  object captures the date at module load and goes stale overnight).
- **Brand/logo avatars:** render real logos `object-cover` (a touch of `scale-110`)
  to **fill** the round container; `object-contain p-1` makes them look tiny. Fixing
  the shared icon component fixes every place it's used (cards + pickers).
- **Reuse with a guard:** extract a self-contained manager (e.g. an attachments
  component using the existing upload helper + detail modal) and drop it into both
  the detail view and the edit dialog — but **guard for destructive save paths**
  (e.g. don't expose attachment management on a split‑edit that deletes+recreates
  the row, which would orphan the files).
