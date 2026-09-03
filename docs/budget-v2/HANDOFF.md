# Budget v2 — handoff

Everything in this document is written for the **next** person (or agent) to pick up Budget v2 after
the PR that introduced Phases 0–4. It is deliberately split into three parts: what to verify before
merging, what to do to actually ship it, and what was left undone on purpose.

Orientation, in reading order:

| Read this | For |
|---|---|
| `docs/budget/BUDGETS.md` | The human explainer — what the numbers mean and why |
| `docs/budget-v2/SCREENSHOTS.md` | Every screen, with a caption on each |
| `.claude/skills/budget-v2/SKILL.md` | The operating guide: 12 invariants and the traps |
| `docs/budget-v2/PHASE2.md` | The build log, §9 Phase 3, §11 Phase 4 |
| `docs/budget-v2/LOCAL_DB.md` | An isolated local Postgres that speaks the Neon protocol |

---

## 1 — Checks before merging

### The gate (mirrors `.husky/pre-commit` and `.github/workflows/pr.yml`)

```bash
npm ci
node scripts/secret-scan.mjs
node scripts/check-esm-extensions.mjs      # prod parity — Node needs .js on relative api/ imports
node scripts/boot-functions.mjs            # imports every function entry in real Node
node scripts/check-route-guards.mjs        # every _routes handler must call an auth guard
npm run i18n:check                         # 1,978 keys × 8 locales, placeholders intact
npm run lint
npm run typecheck                          # all three tsconfigs
npm run test:ci                            # 671 tests, 59 files, DB-free
```

### The build-only failure modes CI cannot see from the dev server

```bash
npm run build
# The chunk graph must stay acyclic: flow -> charts -> vendor.
# A library in `vendor` whose dependency sits in a leaf chunk is a total white screen at boot.
grep -o 'charts-[^"]*\.js' dist/assets/vendor-*.js     # MUST return nothing
```

### End to end

```bash
npx playwright test                        # needs the E2E_* GitHub secrets, or a local Clerk dev instance
```

`e2e/budget-v2.spec.ts` borrows the test user's **personal** workspace for its duration and restores
the original in `afterAll`. That restore is not cosmetic: `playwright.config.ts` runs with
`workers: 1`, so a left-behind workspace switch would move every later spec file's data into the
wrong org, past the leftover sweep in `auth.setup.ts`. If you touch that spec, keep the restore.

### By hand, against a local database

1. Bring up the local DB (`docs/budget-v2/LOCAL_DB.md`) and `npm run db:migrate`.
2. Confirm the three migrations really applied — the journal has silently skipped one before:

```sql
select column_name, data_type from information_schema.columns
 where table_name = 'budget_envelopes' and column_name = 'icon';
select to_regclass('transaction_settlements'), to_regclass('transactions_category_key_idx');
```

3. Create a plan through the wizard on a **personal** workspace, then check the four numbers move the
   way the explainer says: `safe_to_spend` is the lower of the two limits and names which one bound.
4. Switch to a **business** workspace and confirm `/budgets` bounces and `/budgets/own` still loads.

> ⚠️ **Never run `npm run db:push` against a shared database.** It diffs the live schema and will
> propose dropping columns that exist there from unmerged branches.

---

## 2 — To actually ship it

### 2.1 Schema

Migrations `0059`, `0060`, `0061` run automatically on `vercel-build`. After the first production
deploy, verify the columns exist in `information_schema` rather than trusting the "up to date" line —
that is the journal gotcha in `CLAUDE.md`.

### 2.2 Migrate existing v1 budgets

`scripts/migrate-budgets-v2.ts` is additive and idempotent. It skips business orgs and orgs with no
budgets, and converts v1 cadences (`monthly`→monthly/period, `weekly`→weekly/period,
`daily`→**monthly/day**) and v1 history actions into v2 equivalents.

```bash
npx tsx scripts/migrate-budgets-v2.ts --dry-run                 # whole database, writes nothing
npx tsx scripts/migrate-budgets-v2.ts --dry-run --org <orgId>   # one org
npx tsx scripts/migrate-budgets-v2.ts --limit 25                # then, in batches
```

A **lifetime** v1 budget cannot be expressed as a period, so it is migrated to a **paused** plan
carrying `detail.lifetime_needs_choice = true`. That is what the lifetime prompt (§13.4) asks the
user to resolve; do not silently pick a cadence for them.

### 2.3 Staged rollout (§13.9)

Not automated — it is an operational sequence, and it was left to whoever owns the release:

1. Internal orgs only, v1 adapter still serving `/api/budgets`.
2. A cohort of personal workspaces; watch `budget_period_restated` notification volume, which is the
   signal that recompute is disagreeing with what users were shown.
3. All personal workspaces.
4. Only then consider retiring the v1 adapter (decision **D-14**) and, separately, the v1 drop
   migration. Both are gated on evidence that does not exist yet — do not write the drop migration
   before step 3 has run for a full period.

### 2.4 Native apps

The Android and iOS apps are Capacitor shells around the **same** `dist/` bundle, so this PR's UI is
their UI once the bundle is re-copied. The PR ran `npm run cap:sync:android`, and `npm run build:ios`
+ `npx cap copy ios` (permitted here because no Capacitor plugin changed).

Still needed, and **needs macOS + Xcode / a Gradle toolchain**:

```bash
npm run cap:sync:android && npx cap open android    # release build, bump versionCode/versionName
npm run cap:sync:ios     && npx cap open ios        # archive, bump build number
```

The store is the only native update path — the service worker is disabled inside the shell — so a
shipped change means a version bump and a re-upload. See `docs/native/PUBLISHING.md`.

---

## 3 — Deliberately not done

| Item | Why it was left |
|---|---|
| The v1 **drop** migration | §13.9 gates it on rollout evidence that does not exist yet |
| Retiring the v1 adapter (**D-14**) | Same gate |
| Native device builds | Need macOS/Xcode and a Gradle toolchain |
| Multicurrency **M1–M12** (§12) | Would require an FX provider and a rate table. Out of scope by instruction — see the boundary below |
| Credit cards, pending transactions, loan split | Phase 5 |
| Business envelope plans | Business workspaces keep per-client caps; see the gate below |
| Export / reports | Phase 5 |

### The multicurrency boundary — do not cross it casually

No FX provider was added and no exchange-rate table was invented. **Every** amount that Budget
calculations consume routes through one seam:

```ts
// src/lib/budget-math.ts
export function amountInPlanCurrency(amount: number, from?: string | null, planCurrency?: string | null): number
```

It is identity today. When a plan currency and an org currency disagree, `buildBudgetView` returns a
machine-readable limitation rather than summing incompatible values:

```ts
{ code: "currency_mismatch", plan_currency, org_currency, converted: false }
```

If you add conversion, add it **inside that function** and nowhere else. Do not assume all future
accounts share one currency, and do not modify the existing transaction/account currency design to
make Budget easier.

### The business gate is a correctness rule, not a scope boundary

`api/_lib/budget-v1-adapter.ts` returns `null` for a non-personal workspace, and `PersonalOnlyRoute`
bounces `/budgets`. The reason is stronger than "out of scope": a business workspace's `budgets` rows
**are** its per-client spend caps, so serving it a household plan would *replace* a feature it is
already using. If business envelope plans are ever built, they need their own storage — not these
rows.

---

## 4 — Things a reviewer should push back on if they disagree

These were judgement calls, not conclusions. Each is reversible and each is written down so it can be
argued with rather than discovered later:

1. **`daily` v1 budgets migrate to monthly/day**, not to a daily period. A daily period would open and
   close 30 periods a month, each with its own snapshot.
2. **Deleting an occurrence is final.** A settled occurrence can be un-settled, but a deleted one does
   not come back. Consistent with recurring transactions elsewhere in the app.
3. **The catch-all envelope is created by the wizard with the same name as its section**
   ("Everyday spending"), which reads as a duplicate on the plan page. The `leftover` tag
   disambiguates it. Renaming the wizard default is a product decision that was left alone.
4. **Overdue notifications are one digest per plan per day**, not one per bill. Ten overdue bills
   should not be ten notifications.
5. **Confirming a savings contribution is reserved-neutral.** The money was already held back, so
   confirming must not change `safe_to_spend` — only which state the contribution is in.
