# Multi-currency release checklist

The runbook for shipping `feature/multi-currency-full-maqbool` (migrations
0069–0082). Work through it top to bottom. Every step is in the order it has to
happen in. Background: `FIX_TRACKER.md` (MC-115, 117, 118, 119, 034, 035, 156,
120) and `.claude/skills/migrations/SKILL.md`.

## 1. Merge order (MC-115)

- [ ] Merge this branch into `dev` **before any `dev → main` promotion**.
      `origin/dev` ships `0075` stamped `1789383113149`, above this branch's
      `0069–0074` (`1789303202114…614`). If dev reaches a database first, that
      database's watermark jumps past 0069–0074. They are then skipped silently,
      and 0076 fails on the missing `currency_code`.
- [ ] After the merge, `npm run migrations:check` passes on `dev`, and the journal
      reads 0068 → 0069 … 0082 in that order.

## 2. Before the deploy, on every database (dev · e2e · each Preview DB · prod)

Pick each database with `ENV_FILE` (prod: `ENV_FILE=.env.production.local`) or an
exported `DATABASE_URL=…`; both `audit:balances` and `db:migrate` honour them, and
an exported `DATABASE_URL` wins over the file. Check the `target:` host each
script prints.

- [ ] **Watermark.**
      ```sql
      select max(created_at) as watermark, count(*) from drizzle.__drizzle_migrations;
      ```
      Prod must read `1789303202014` (0068). If any database reads
      `1789383113149` (0075 from dev), its 0069–0074 will be skipped. To repair it,
      delete only that bookkeeping row so that `db:migrate` replays 0069–0082. All of
      them can be re-run, 0075 included. Rehearse this on a Neon branch first.
      ```sql
      delete from drizzle.__drizzle_migrations where created_at = 1789383113149;
      ```
- [ ] **Debt audit (MC-117), read-only.** Run `npm run audit:balances`. On a
      database without the multi-currency schema it runs only the three debt
      audits and predicts the labels 0069 + 0076 will assign:
      - debts in another currency than their workspace;
      - debt repayment rules paid from an account in another currency (after 0076
        their next posting is refused with `currency_mismatch`);
      - debt groups whose legs span more than one currency.

      Decide each finding before you deploy: leave it, pause the rule (tell the
      user), or relabel it with the user's agreement. Write the decision down.
- [ ] **Rehearse on a Neon branch of prod.** Run
      `DATABASE_URL=<branch-url> npm run db:migrate` and check that the printed
      `[db-migrate] target:` is the branch host, not dev. The sentinel must print
      `multi-currency sentinel ok`. Then follow §5: roll back,
      write, and roll forward, and check that nothing breaks.

## 3. Deploy

- [ ] `vercel-build` runs `scripts/db-migrate.mjs`. After migrating, its
      **schema sentinel** checks `transactions.currency_code`,
      `wealth_accounts.currency_code`, `transfers`,
      `reporting_amount(numeric,text,date,text)`, `fx_rate_on(text,text,date)`
      and `transactions_account_currency_fk`. **A missing object fails the
      build** (exit 1). Do not bypass it. Go back to §2's watermark step.
- [ ] The old deployment keeps serving until promotion. Rows it writes in that
      window get their currency from the BEFORE INSERT triggers: 0081 for
      accounts, 0082 for transactions and recurring rules (MC-118).

## 4. After the deploy

- [ ] `npm run audit:balances` (now the full audit). Expect 0 NULL-currency rows
      and accounts, 0 currency-mismatched rows, and the debt findings you
      decided on in §2. Write down any drift and do not `--apply` blindly.
- [ ] The FK is validated. The audit's last lines must say
      `row-currency FK (0081): valid`. If it says NOT VALID, fix the listed rows,
      then run `ALTER TABLE transactions VALIDATE CONSTRAINT transactions_account_currency_fk`.
- [ ] Worker: run `make register` in `worker/` (or open /admin → Worker, which
      repairs it). This adds the `fx-refresh` schedule (16:30 UTC →
      `/api/cron/fx`).
- [ ] GitHub fallback: set the repo secret `PROFITSYNC_CRON_TOKEN` to the app's
      `CRON_FALLBACK_TOKEN` Vercel env. Run `fx-refresh-fallback` once by hand.
      It must return 200.
- [ ] /admin → Worker → FX health shows no failing provider and no pair without
      a rate.

## 5. Rollback policy (MC-035): roll forward only

As soon as production holds **any** foreign-currency account or cross-currency
transfer, never roll back to a pre-multi-currency build. v0.14.1 trashes only
the legs that share a `group_id`, which leaves the fee and the header live. It
also adds EUR to INR unconverted. Fix forward instead.

```sql
select
  (select count(*) from wealth_accounts wa join organizations o on o.id = wa.organization_id
    where wa.type not in ('loan','receivable')  -- v0.14.1 already keeps debts in their own currency
      and wa.currency_code is distinct from coalesce(o.reporting_currency, upper(o.currency))) as foreign_accounts,
  (select count(*) from transfers where source_currency <> destination_currency) as cross_currency_transfers;
```

An instant rollback is only acceptable while both counts are 0. Foreign debts
don't count: the old build created them itself and handles them. Even then, the
0081/0082 triggers keep the old build's rows labelled. Rehearse it on a Neon
branch before release:

1. deploy;
2. roll back;
3. write with the old build;
4. roll forward;
5. run `audit:balances`.

## 6. Native apps (MC-120, MC-034)

The store builds carry a frozen copy of the web bundle. Without these steps,
1.4.0 keeps showing unconverted totals.

- [ ] After the API is live, run `npm run cap:sync:android` and `npm run cap:sync:ios`.
- [ ] Bump the versions:
      - Android: `versionCode` 19 → 20 and `versionName` "1.5.0" in
        `android/app/build.gradle`.
      - iOS: `CURRENT_PROJECT_VERSION` 9 → 10 and `MARKETING_VERSION` 1.5.0.
- [ ] New builds send `x-client-capabilities: multi-currency` on every API
      call (`src/lib/client-capabilities.ts`). Requests without the header (1.4.0,
      a stale PWA) get **409 `client_update_required`** when they create an
      account, Space, card (new bank or credit) or debt in a currency other
      than the workspace's reporting currency. Same-currency creation is never
      gated. Check it on the emulator with an old APK if you have one.
- [ ] Known limits for old builds, accepted:
      - They ignore `excluded_count`, so totals that leave out rows without a
        rate look complete (MC-119).
      - Their edit of a transfer leg is refused with "This is part of a transfer.
        Delete it and record it again." A fee row says "Delete the transfer and
        record it again.", because a fee can't be deleted on its own (MC-156).
- [ ] Upload to Internal testing / TestFlight first, then promote.

## 7. Post-deploy smoke (web, Android emulator, iOS simulator)

In a workspace with an account in another currency (for example INR + a EUR bank):

- [ ] /wealth shows the **By currency** breakdown. Net worth converts the EUR bank
      and shows a `≈` line with the rate date.
- [ ] Transaction, transfer and card detail screens show `≈` reporting amounts.
      Nothing shows a raw mixed sum.
- [ ] Do a cross-currency transfer with a fee, then reverse it. Both balances
      move exactly once, and Trash restore and purge keep the legs and the fee
      together.
- [ ] The dashboard, /analytics, /budgets and /calendar show the "excluded"
      notice only when a rate is missing.
- [ ] `audit:balances` stays clean after the smoke test.
