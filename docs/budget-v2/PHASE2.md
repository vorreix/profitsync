# Budget v2 — Phase 2 delivery notes

Phase 2 turns the one-envelope plan Phase 1 delivered into a real budget:
several categories, obligations with due dates, refund review, and the actions
that let a user resolve an overspend instead of just looking at one.

Read this alongside `SMART_HYBRID_BUDGET_SPEC.md` (the authority) and
`I18N_REVIEW.md` (terms needing native review).

---

## 1. What shipped

| Area | Delivered |
|---|---|
| Schema | `transaction_settlements` (§10.11) · functional index `transactions_category_key_idx` on `(client_id, lower(btrim(coalesce(category,''))))` (§17.2 / D-4) — migration `0060` |
| Pure math | `categoryKey`, `categoryConflicts`, `normalizeMatchKeys`, `aggregateSection`/`aggregateAllSections`, `checkReallocation`, `reallocationPreservesTotal`, `overspendOptions`, `settlementRollup`, `canAddSettlement`, `checkReschedule`, `allowedOccurrenceActions`, `daysOverdue`, `needsAttention`, `detectCurrencyMismatch` |
| Engine | one grouped spend query for the whole plan · confirmed settlements netted per envelope · commitment/debt `settled` from occurrences · commitment names + allowed actions on occurrence lists · `uncategorised` total |
| API | `envelopes` (+ `/:id`, `/:id/detail`) · `commitments` (+ `/:id`) · `occurrences` · `reallocate` · `refunds` |
| UI | category cards (four figures) · overdue list with Mark paid / Reschedule / Skip · overspend resolution sheet · refund review · envelope detail sheet · add-category and add-bill dialogs |
| i18n | 101 new keys × 8 locales |

---

## 2. Defects found and fixed

Phase 2 was implemented by auditing the Phase 1 foundation against the spec
rather than trusting the Phase 1 report. That found five real defects, four of
them in code Phase 1 had shipped.

### 2.1 `db.batch()` was broken for every caller

Drizzle's neon-http session builds each batch element with `client.query ?? client`
and hands the array to `client.transaction(...)`. Neon's `transaction()` reads
`element.parameterizedQuery` and `element.opts` **synchronously** and rejects
anything whose `Symbol.toStringTag` is not `NeonQueryPromise`. The raw neon
callable returns exactly such a lazy promise; the repo's retry wrapper
(`src/lib/db/index.ts`) returns a plain promise that has already started
executing and carries no query descriptor — so every `db.batch()` threw
*"transaction() expects an array of queries"*.

No type check or unit test can see this: it depends on which client object
drizzle was handed at construction. It stayed latent because `db.batch` is used
only by Budget v2, and Phase 1's verification never closed a period — so the
period close and funding-base refresh in `sync.ts` would both have 500ed in
production.

**Fix:** `dbBatch()` runs the batch on a second drizzle instance bound to the raw
callable, with the retry around the whole batch. Query builders remain
interchangeable between the two instances because drizzle's `batch()` only reads
SQL text and params off each one.

### 2.2 The restatement fingerprint was not org-scoped

`transactions` carries no `organization_id`, so the drift fingerprint in
`restateDriftedPeriods` summed **every** organization's rows in the window. Any
unrelated workspace's activity could restate this org's closed period. Now
joined through `clients`.

### 2.3 Account-less transactions were dropped from budget spend

`wealth_account_id` is nullable and the Add-Transaction form allows "no
account", but `includedAccountIds()` returns every active bank+cash id when the
plan names none — so the `IN` filter excluded NULL rows. Real spending appeared
on `/transactions` and was missing from the budget.

**Rule now:** a plan that names **no** accounts counts NULL-account rows too
("all my money"); a plan that named specific accounts still does not, because
the user deliberately narrowed the scope.

### 2.4 Commitment and debt `settled`/`paid` were structurally always zero

Those sections take no category spend, and nothing read their occurrences. They
now come from occurrences settled inside the window, attributed by **due** date
so a carried occurrence is never counted in two periods at once.

### 2.5 A pending bill rendered as an overspend

Only a flexible envelope can be over — it has a target that caps spending. A
commitment or debt envelope carries no target, so `remaining` goes negative the
instant a bill is pending, and the card read `$1,056.40 over` in red with a
Resolve button. That is the conflation of *reserved* with *spent* that §8.7
exists to remove. `EnvelopeRow` is now section-aware.

Also fixed: unique-violation detection. Drizzle wraps the driver error in a
`DrizzleQueryError` whose `message` is the SQL text, so the constraint name lives
on `.cause`; `violates()` walks the chain. Without it every name clash surfaced
as a 500 instead of a 409.

---

## 3. Invariants and where they are enforced

| Invariant | Enforced in | Pinned by |
|---|---|---|
| Netted headroom, floored **once** | `aggregateSection` | `budget-math-phase2.test.ts` — asserts 100 **and** that it is not the 200 per-envelope flooring gives |
| One category → one envelope | `categoryConflicts` + write-time check in both envelope routes | unit + live (409 names the owning envelope) |
| Category matching is case- and whitespace-insensitive | `categoryKey` ≡ SQL `lower(btrim(coalesce(...)))` | unit test pins that JS trims **only** the four characters `btrim` does, so the matcher can never be wider than the index |
| Reallocation leaves total planned unchanged | asserted in `reallocate.ts` before the write | live: safe-to-spend byte-identical across a move |
| An occurrence never moves money | `occurrences.ts` writes only a deviation row | live: account balance unchanged after settling a 500 bill |
| Σ settlements ≤ expense | `canAddSettlement`, re-read inside the request | live: 409 with the room remaining |
| A confirmed settlement is not also a provisional guess | `spendByCategoryKey` excludes linked inflows | live |
| Reads never write | every GET | live: 15 consecutive GETs wrote 0 rows |
| A one-time bill never ages out | `carryLowerBound` (D-17) | live: a 2024 invoice still projects at 663 days late |
| Currency is detected, never converted | `detectCurrencyMismatch` | live: `{code: currency_mismatch, converted: false}` |

---

## 4. Multicurrency boundary

**No FX provider was added. No rate table was invented. No Maqbool-owned
currency design was modified.**

Worth stating plainly, because it changes what "multicurrency support" can even
mean here: **neither `transactions` nor `wealth_accounts` carries a currency
column.** Currency lives on `organizations` and is snapshotted onto
`budget_plans.currency`. So a per-account or per-transaction mismatch is
structurally impossible today, and building for one would be building for a
problem the data model does not have.

The one mismatch that **is** reachable: the org currency is changed after the
plan was created, leaving historical amounts entered under the old denomination
summed with new ones. That is detected and reported as
`currency_limitation: {code: "currency_mismatch", plan_currency, org_currency, converted: false}`.

Every amount the budget consumes passes through `amountInPlanCurrency()`, which
is still the identity but now takes the source and plan currencies so that every
call site already declares what it believes the denomination to be. The day a
conversion policy is agreed (§12.3 M1–M12), that function gains a rate lookup
and **no call site changes**.

---

## 5. Verification performed

| Check | Result |
|---|---|
| Unit tests | 662 passed (59 files), including 55 new Phase 2 math tests |
| Live API, real Clerk auth, real database | **109 assertions, 0 failures** |
| Playwright `e2e/budget-v2.spec.ts` | **9 passed** (setup + 8), run locally |
| Full pre-commit gate on every commit | secret scan · ESM extensions · function boot · route guards (122) · i18n parity · lint · typecheck · tests — all green |
| Production build | succeeds; `manualChunks` acyclicity verified (0 `vendor → charts`, 0 `vendor → flow`) |
| Browser review | desktop + mobile + Arabic RTL, 0 page errors, no horizontal overflow at 390px |
| Native parity | Android: `cap:sync:android`. iOS: `build:ios` + `cap copy ios` — see §6 |

---

## 6. Native parity — read this carefully

Both shells carry the Phase 2 bundle:

- **Android** — `npm run cap:sync:android` (android-mode `vite build` + `cap sync android`, plugins updated).
- **iOS** — `npm run build:ios` + **`npx cap copy ios`**, deliberately *not*
  `cap sync ios`. On Windows, the `cap update ios` half of `sync` writes
  backslash paths into `ios/App/CapApp-SPM/Package.swift`, which would break the
  macOS build. `copy` is the correct and sufficient operation here because
  Phase 2 added **no Capacitor plugin**, and it was verified safe:
  `Package.swift` is byte-identical (same md5) and no tracked file was dirtied.

**Copying web assets on Windows is not a native build verification.** Neither
app was compiled, installed or run. Confirming Phase 2 on device requires:

- **iOS:** a macOS machine with Xcode — `npm run cap:build:ios`, then run on a
  simulator or device. Only there can `cap sync ios` be run safely.
- **Android:** a Gradle build — `npm run cap:build:android` — then install the APK.

Both are outside what this environment can do, and neither has been done.

---

## 7. Follow-up work — now done

Everything listed here as deferred after Phase 2 has since been delivered; see
§9. What genuinely remains is at the end of that section.

- ~~Savings funds: `protectedSavingsDue` stubbed at `0`~~ → real, and covering
  exactly the envelopes with no funding mode so nothing is reserved twice.
- ~~Envelope reordering stored but with no affordance~~ → drag plus accessible
  move up/down.
- ~~Restatement detects drift but re-stores the old payload~~ → a real
  recompute, over the last 12 closed periods.
- ~~The attributed (report-only) settlement view is not built~~ → built, shown
  only when it differs from the cash view.
- ~~Notifications for Phase 2 events reuse the Phase 0 budget-alert path~~ →
  five dedicated types; see §9.8.

---

## 8. Native parity, restated

Both shells carry the current bundle:

- **Android** — `npm run cap:sync:android`.
- **iOS** — `npm run build:ios` + `npx cap copy ios`, deliberately not
  `cap sync ios`: on Windows the `cap update` half writes backslash paths into
  `ios/App/CapApp-SPM/Package.swift` and would break the macOS build. Verified
  safe each time — `Package.swift` md5 unchanged, no tracked file dirtied.

**Copying web assets on Windows is still not a native build verification.**
Neither app has been compiled, installed or run. That needs
`npm run cap:build:ios` on macOS with Xcode, and `npm run cap:build:android`
with Gradle.

---

## 9. Phase 3 follow-up (delivered)

### 9.1 Restatement is a real recompute

`buildBudgetView` now accepts a `periodId`, which was the blocker: it could only
ever report the OPEN period, so the old code detected drift and then re-stored
the **old** payload with a `__restated` flag — recording that something changed
without ever saying what the corrected figures were. The sweep also widened from
the single most-recent closed period to the last 12.

Cash is deliberately **not** recomputed. `available_now` is a reading of today's
balances and cannot be reconstructed for a past instant, so the original
snapshot's cash figures are carried forward and flagged `as_at_close`.
Recomputing them would quietly replace "what your balance was when this period
closed" with "what it is today". Each restatement also records which envelope
moved and by how much.

Verified through the real sync route: v1 keeps 120, v2 recomputes to 260, v3
recomputes to 0 after a delete, and a repeat sync restates nothing further
(19/19 assertions).

### 9.2 `protectedSavingsDue`

Covers exactly the savings envelopes with **no** funding mode — a plain "hold
this back" line rather than a sinking fund. The other three savings terms
already cover every virtual and Space-backed envelope, so overlapping them would
reserve the same money twice. Verified: 175 lands in `protected_savings_due`
and 0 in the virtual term, and drops out once confirmed or skipped.

### 9.3 Fund contributions

`POST /api/budgets/v2/contributions` — confirm / skip / unskip. Confirming is
reserved-NEUTRAL by design: the amount moves from
`virtualContributionsUnconfirmed` into `virtualFundBalances`, so safe-to-spend
does not jump and it is safe to leave a contribution unconfirmed for days. The
UI says so in as many words.

Crediting is idempotent on `(envelope_id, period_id)` via the partial unique
index, and when that index rejects a second credit the route reports success —
because it means the fund is already credited. A Space-backed contribution is
refused with `transfer_required`: it is real only once the money has moved, and
Budget must not fabricate that transfer.

Goal progress reuses `src/lib/spaces.ts` unchanged, as §8.9 intended.

### 9.4 Envelope reorder

`POST /api/budgets/v2/envelopes/reorder` rewrites positions from the array index
so the stored order always matches what the user sees. Drag uses
`@dnd-kit/core` (no new dependency); move up/down buttons are the **accessible**
path, not a fallback, and the drag handle is `aria-hidden` because announcing a
handle a screen reader cannot operate is worse than not announcing one.

### 9.5 Attributed settlement view

Report-only, in the envelope detail, shown only when it actually differs from
the cash figure. The cash view remains authoritative.

### 9.6 Defects this phase found

- **`i18n-merge.mjs` silently dropped corrections.** It is a backfill tool: it
  keeps existing values and only fills missing keys, while printing
  "N translation entries applied" — the input count, not the change count. The
  first native review applied cleanly, reported success, and changed nothing.
  Fixed with `--overwrite` and an honest summary; the generated prompts and this
  doc set both said to run it without the flag, so both were corrected.
- Three savings-UI defects found by looking at the rendered page rather than the
  numbers: a literal `{{amount}}`, "Held in a Space" on a fund with no Space,
  and "Set aside" used for both a period figure and a running total.
- Two touch targets found by the e2e: reorder chevrons at 24px, Resolve at 32px.

### 9.7 Translation review

154 native corrections applied — Malayalam 41, Arabic 25, Hindi 43, Tamil 45 —
each pre-flighted and re-verified for key existence, placeholder parity and
script. `scripts/i18n-review-prompts.mjs` generates the prompts from the strings
currently shipped, so they cannot drift from what is live.

Two reviewers independently flagged that `budgetV2` used the minority plural
style (bare + `_one`) against 26 uses of `_one`/`_other` elsewhere, so
`daysOverdue_other` now exists in all eight locales.

All five reviews are in: **ml 41, ar 25, hi 43, ta 45, te 46 — 200 corrections**,
each pre-flighted and re-verified for key existence, placeholder parity and
script, then re-checked together after the final merge (zero placeholder drift,
219/219 keys resolving).

**And they exposed a bug that had made them invisible.** Verifying that the
corrections actually RENDER — rather than trusting that a green `i18n:check`
meant they were on screen — found the whole UI still in English with
`<html lang="te">` set. The boot guard in `src/lib/i18n/index.ts` read
`i18n.resolvedLanguage ?? i18n.language`; `resolvedLanguage` is what i18next can
resolve against the bundles it currently HAS, which is English only at that
moment, so a stored `te` resolved to `en`, the guard skipped the load, and the
locale chunk never arrived. The check defeated itself: it asked "did the locale
load?" in order to decide whether to load it.

Picking a language from the switcher always worked (`setAppLanguage()` awaits
`ensureLocaleLoaded()`), so only a COLD load with a non-English language already
stored was broken — the returning user, not the one changing the setting. And
`ensureLocaleLoaded` swallows failures by design, so nothing was logged.

It is shared i18n code, not Budget v2, and it affected all 7 non-English locales
across the whole app. Verified in a browser before and after, and all five
reviewed locales now render their own script on a cold load with Arabic RTL
correct, no overflow at 390px and no leaked placeholders.

The lesson worth keeping: `i18n:check` proves a string EXISTS, not that it
reaches the screen.

### 9.8 Notifications

Five types, all in the `budget` category so ONE preference toggle governs them —
a user who mutes budget notifications must not still be pinged by their budget.
Every one is emitted from `POST /api/budgets/v2/sync` and only after the write
it describes has committed, and all are fire-and-forget: sync is what keeps the
plan correct, so a notification must never be able to fail it.

| Type | Cadence, and why |
|---|---|
| `budget_overdue` | ONE aggregated nudge per plan **per day**, in the plan's timezone. An overdue bill *stays* overdue, so per-commitment alerts would either fire once and go quiet as the pile grows, or fire forever. It is a standing condition, not a moment. |
| `budget_envelope_over` | Once per envelope per period, FLEXIBLE only — a commitment or debt envelope has no target, so its negative remaining means "not yet paid" (§8.7). Capped at 3 per sync so enabling this on an existing plan does not deliver a burst. |
| `budget_contribution_missed` | Per fund per closed period. §8.9.1 forbids auto-crediting, so an unconfirmed contribution becomes `missed` and the money stayed spendable — not a decision the user made deliberately. |
| `budget_period_closed` | One per period. |
| `budget_period_restated` | Per period per **version**, so a genuinely new revision notifies again. It revises a record the user may already have acted on. |

Verified live through the sync route: 17 assertions, 0 failures. Two things that
verification taught, both recorded in the throwaway test and worth knowing:

- **Sync can return before the notification insert lands**, because the emit is
  deliberately not awaited. A reader must poll rather than read immediately —
  the first run of the check looked like a total failure for exactly this
  reason.
- `notifyOrgMembers` **suffixes the dedupe key with the recipient id**, so the
  stored key is `<ourKey>:<userId>`.

---

## 10. Re-running the verification

Everything runs against the Neon database whose `DATABASE_URL` is in `.env.local`
(there is no local Postgres). The Phase 2 verification scripts live in this
session's scratchpad, not the repo, because they seed and mutate data:

```bash
# 1. migrations — reads .env.local itself; 0059–0061 are additive
npm run db:migrate

# 2. unit tests
npx vitest run src/lib/budget-math-phase2.test.ts

# 3. the committed e2e spec, against the dev Clerk instance
export CLERK_PUBLISHABLE_KEY="$VITE_CLERK_PUBLISHABLE_KEY"
npx playwright test --project=chromium e2e/budget-v2.spec.ts
```

---

## 11. Phase 4 — migration and rollout (delivered)

### 11.1 The migration script

`scripts/migrate-budgets-v2.ts` (`--dry-run` / `--org` / `--limit`), additive and
idempotent. Each §13.10 prohibition is enforced and locked by a test: `lifetime`
becomes a PAUSED plan, `income_mode` is `available` with no inferred income, an
org with no v1 budget gets nothing, no historical periods are fabricated,
amounts and currencies are copied verbatim, business orgs are skipped entirely,
and no `budgets` / `budget_history` row is ever written to.

Two details worth keeping:

- **`timezone='UTC'`** exactly preserves v1 semantics. v1 had no timezone and
  computed its windows in UTC, so any other zone would shift which transactions
  fall in a period and silently change numbers the user has already seen.
- **`daily` → a MONTHLY plan with `target_cadence='day'`.** The "20/day" intent
  survives and the engine normalises it onto the period; a daily *plan* would
  open a new period every day, which is not what was asked for.

`openPeriod` gained a migration-only `forceSource`, because §13.3 requires the
first period to SNAPSHOT rather than reconstruct and `baseSourceFor` would have
picked reconstruction on the one day the migration ran exactly on a boundary.

**55 assertions, 0 failures** against seeded v1 data covering monthly, weekly,
daily, lifetime, a business template + client cap, and no-budget — including an
md5 fingerprint of both v1 tables proving they are byte-identical afterwards,
idempotency across three runs, and a rollback that finds the v1 row still
readable.

### 11.2 The two prompts the migration refuses to answer

`POST /api/budgets/v2/prompts`, surfaced by `MigrationPrompts.tsx` ABOVE the
hero — both change the figures below them, so settling one before reading the
numbers is the right order.

- **§13.4 lifetime.** Offers a real monthly target or keeping it as a record.
  "Keep as a record" is a legitimate answer, so it is a proper option rather
  than an X in the corner. Choosing a target activates the plan and retargets
  the catch-all in ONE batch, so the plan is never observed active with the old
  lifetime figure standing in as a monthly target.
- **§13.8 salary-vs-target.** Fires when the catch-all target is within 5 % of
  median monthly income over three months. Answering "that is my income" sets
  `expected_income` and CLEARS the target rather than inventing one — a cleared
  target makes safe-to-spend honestly cash-bound until the user sets a real one,
  and the UI says so before you tap it.

Both are suppressed by an audited event rather than a column, because a
dismissal is a user decision. **21 assertions, 0 failures.**

### 11.3 Legacy URLs (§13.6)

`BudgetKeyPage` resolves `/budgets/:key`: no plan → the v1 page unchanged (not a
transitional state — business caps live on under §23); a plan → deep-link to the
matching envelope, `default` meaning the catch-all; unresolvable → `/budgets`
with an explanation. **An existing bookmark never 404s.**

### 11.4 Performance validation (§16.11)

Calibrating first changed what was worth measuring: every query here is an HTTPS
round trip costing ~200 ms, and a single-row fetch measures the same as a 100k
aggregate. Wall-clock milliseconds describe the PROXY, not the database, so
§16.11's production p95 targets **cannot be judged from this environment**.
ROUND TRIPS are the portable metric — and they are also what the named
regression (#13) actually looks like.

Against 100k transactions / 24 months / 41 envelopes / 10k fund entries,
**15 assertions, 0 failures**:

| Property | Result |
|---|---|
| Open-period read | **17 round trips, FLAT** — 17 at 15 envelopes and 17 at 41 |
| No sequential scan on 100k `transactions` | confirmed by EXPLAIN |
| Staleness probe | **1** round trip (was 2 — fixed) |
| Virtual fund balance | **1** indexed SUM (was shipping 10k rows — fixed) |
| Closed-period read | **1** row fetch, indistinguishable from the proxy floor |
| v1 adapter overhead | **+1** round trip |

Two real fixes came out of it, both committed: `syncRequired` now composes its
four checks into one statement (it runs on every read, so that is ~200 ms off
every one), and `virtualFundBalances` aggregates in SQL with its CASE bound by
comment to `fundBalanceFromEntries`, the same mirror discipline `categoryKey`
already has.

One of my assertions was wrong rather than the code: the fund SUM shows a Seq
Scan because the fixture gives one fund 10 000 of the table's 10 001 rows, so
the predicate matches everything and an index scan would be slower. With a
selective predicate (5 of ~10k) the planner does use the index.

### 11.5 Documentation

`docs/budget/BUDGETS.md` rewritten for v2 as the human explainer, and
`.claude/skills/budget-v2/SKILL.md` added as the operating guide — the repo
convention of a durable doc paired with a skill. Every path the skill cites was
checked to resolve.

### 11.6 Not done in Phase 4

- **The v1 drop migration** is deliberately absent. §13.9 gates it on the flag
  at 100 % for ≥30 days, zero v1-handler traffic and a verified backup — it is
  the point of no return and cannot be written ahead of that evidence.
- **Staged rollout** is supported by the script (`--org`, `--limit`) but the
  rollout itself is an operational sequence, not code.
- **Native builds** still require macOS/Xcode and Gradle.
