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

## G. Optimistic-UI pattern (perceived speed)

- Add granular cache invalidation (`invalidateKeys(prefixes)`) so a write keeps
  unrelated pages' caches warm instead of clearing everything.
- `runOptimistic({apply, rollback, mutate, errorMessage, onSuccess})`: apply the
  change locally (close the modal / update the list instantly), save in the
  background, and on failure roll back + toast + reopen the modal with data intact.
- Roll this out incrementally from a verified reference — do NOT blanket-convert all
  mutations blind, especially in financial code.
