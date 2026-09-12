---
name: migrations
description: Use when adding, editing, renumbering or debugging a database migration — anything under drizzle/, drizzle/meta/_journal.json, scripts/db-migrate.mjs, or a symptom like "the column is missing but db:migrate says up to date", a migration that seems to have been skipped, a duplicate migration number, or a merge conflict in the journal. Establishes the ONE-WATERMARK model that makes a wrong journal silently do nothing.
---

# Database migrations

**One sentence decides everything here: drizzle keeps a single number per database — the
highest `created_at` in `drizzle.__drizzle_migrations` — walks the journal in ARRAY order,
and runs an entry only when its `when` is strictly greater than that number.**

There is no per-migration bookkeeping. Nothing compares tags, hashes or file contents. So a
migration that lands at or below the watermark is not "pending": it is skipped forever, and
the migrator prints `database schema is up to date` while doing it.

Every migration incident this repo has had is that sentence playing out.

## The rule, from the source

`node_modules/drizzle-orm/neon-http/migrator.js` reads the watermark **once**, before the
loop:

```js
const dbMigrations = await db.session.all(
  sql`select id, hash, created_at from ${...} order by created_at desc limit 1`
)
const lastDbMigration = dbMigrations[0]
for await (const migration of migrations) {
  if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis) {
```

Read what that does and does not say:

- The watermark is `max(created_at)` over the **whole table**, not "have I run this one".
  A single row with a large `created_at` — from any branch, any deploy — suppresses
  everything at or below it.
- It is captured **once** and never updated inside the loop. The comparison is against a
  frozen number, so a journal that is out of order skips or applies based on where the
  watermark happens to sit.
- The comparison is `<`, not `<=`. An entry whose `when` **equals** the watermark is skipped.
- `hash` is computed and inserted but **never compared**. Editing the SQL of a migration
  that has already run is a no-op on that database, permanently.
- `readMigrationFiles` never lists the `drizzle/` directory. It resolves `drizzle/<tag>.sql`
  for each journal entry, so a `.sql` file no entry names is **invisible** — never read,
  never applied, no warning.
- `idx`, `version` and the numeric filename prefix are decoration to the runtime. Only
  `tag` resolves a file and only `when` decides anything.

**Bookkeeping is deferred.** All the `insert into __drizzle_migrations` statements are
collected and run *after* the whole batch. If the fifth of five migrations throws, the SQL
of the first four has already executed and **nothing is recorded** — the next run replays
the batch from the top against a half-migrated schema. That is why every migration must be
individually re-runnable.

## Adding a migration

1. Write `drizzle/NNNN_name.sql`, where `NNNN` is **one more than the current head**. Never
   reuse a number, and never leave a hole.
2. Add a journal entry with `when: Date.now()` — a real clock reading, not a hand-typed
   number. It must be strictly greater than the last entry's.
3. Append it **last** in `entries`. Array order is apply order.
4. Make every statement re-runnable:
   - `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`
   - every `ADD CONSTRAINT` preceded by `DROP CONSTRAINT IF EXISTS` for the same name
   - a data migration guarded so a second run changes nothing (`WHERE NOT EXISTS`, or a
     condition that stops matching once it has run)
5. `node scripts/check-migrations.mjs` — it enforces all of the above and runs in the
   pre-commit hook, `pr.yml` and `security.yml`.
6. Apply it, then **verify the object exists** in `information_schema`. "Up to date" is not
   evidence.

## Renumbering, and why it is safe

The numbering is **contiguous**: 0001, 0002, … with no holes. Retiring a migration no
database ever ran is legitimate — the Budget v2 trio was pulled that way — but the ones
after it are then renumbered to close the hole.

Renaming is safe precisely because of what the migrator reads. It resolves
`drizzle/<tag>.sql` and compares `when`. It never compares `idx`, the filename number, or
the recorded `hash`. So renaming a file, updating its `tag` and `idx`, and **leaving `when`
exactly as it is** changes nothing for a database that has already migrated: every entry
still sorts the same way and still evaluates to "already applied".

The one rule: **never edit an existing `when`.** Lower it and the migration re-applies on
some databases; raise it and it is skipped on others. After any renumber, prove it — run
`db:migrate` against a migrated database and check the row count and watermark are
unchanged.

A renumber does churn the journal, so expect conflicts with any other open branch that
adds a migration. Resolve them by keeping every `when` and re-closing the numbering.

## Things that are errors, and what they look like

| Symptom | Cause |
|---|---|
| "column/relation does not exist" during migrate | An earlier migration was skipped; a later one that depends on it ran. |
| `db:migrate` says up to date, object missing | The entry's `when` is at or below the database's watermark. |
| A migration never runs anywhere | Its `.sql` file has no journal entry — the migrator reads the journal, never the folder. |
| Works on a fresh DB, not on an existing one | Out-of-order `when`, or a duplicate `when`. |
| Every new migration is skipped on one database | That database has a **future-dated** row. |

## The future-dated row

The nastiest failure, and it has happened here. A journal entry stamped with a future
epoch-ms value applies immediately and writes that value into `created_at`. From then on it
is the watermark, and **every** migration written afterwards with a real clock sorts below
it and is skipped — until wall-clock time passes the poisoned value.

On 2026-09-12 the shared dev database held a row stamped `1789600000000` (2026-09-16). All
67 journal entries evaluated to "skip" against it. It was repaired with the UPDATE below.

`check-migrations.mjs` rejects a future `when`. To repair a database that already has one,
lower that row's `created_at` to just above the next-highest recorded value — the migration
stays recorded as applied, and the watermark stops suppressing everything after it:

```sql
UPDATE drizzle.__drizzle_migrations SET created_at = <second_highest + 10>
WHERE created_at = <the future value>;
```

## Repairing a database whose bookkeeping disagrees with its schema

This is the e2e-database failure of 2026-09-08: the watermark sat between the migration that
CREATEs a table and the one that ALTERs it. For a **disposable** database, rebuild rather
than patch — it is faster and leaves no doubt:

```sql
DROP SCHEMA IF EXISTS drizzle CASCADE;
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
```

then `npm run db:migrate` and confirm the recorded count matches the journal length. Seed
data that lives in migrations (`plans`, via `0002` and `0006`) comes back on its own.

For a database you cannot rebuild, delete only the bookkeeping rows at or above the first
migration that needs to re-run, and rely on every statement being re-runnable.

## Environments

- **No local database.** Everything runs against Neon. `DATABASE_URL` in `.env.local` is the
  shared **dev** branch; the e2e branch lives only in the `E2E_DATABASE_URL` GitHub secret.
- **Never `npm run db:push`** against a shared database — it diffs the live schema and will
  propose dropping columns other branches added.
- The shared dev branch carries migrations from **unmerged branches**. Its watermark is
  routinely ahead of any one branch's journal, so a migration correct in the repo can still
  be skipped there. Apply it by hand and record it when that happens, and say so.
- Production only ever has what `main` has applied, so it is the one environment where the
  journal and the database agree by construction. Check it before assuming a repo-level fix
  is needed.
