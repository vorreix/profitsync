#!/usr/bin/env node
// Guards the migration sequence — the ordering rules drizzle depends on and
// never checks for you.
//
// WHY THIS EXISTS. drizzle's neon-http migrator keeps ONE number per database:
// the highest `created_at` in drizzle.__drizzle_migrations. It walks the journal
// in ARRAY order and runs an entry only when that entry's `when` is GREATER than
// the watermark. There is no per-migration bookkeeping, so anything whose `when`
// lands at or below the watermark is skipped FOREVER, silently, with the
// migrator printing "database schema is up to date".
//
// Every incident this repo has had with migrations is that one sentence:
//   • 2026-09-08 — the e2e database sat at a watermark between 0062 and 0063, so
//     the migration that CREATEs credit_card_statements was skipped and the one
//     that ALTERs it ran. Every e2e run died on "relation does not exist".
//   • 2026-09-12 — a feature branch shipped a debt migration numbered 0063
//     alongside the existing 0063 (cards), with its journal entry appended LAST but stamped
//     BELOW the entry before it. On any database already migrated it would never
//     have run, and the debt tables would simply never have existed.
//   • The same day: a migration stamped 2026-09-16 — four days in the FUTURE —
//     was applied to the shared dev database. Every later migration written with
//     a real timestamp now sorts below it and is skipped there.
//
// None of those needed a database to catch. They are all visible in the repo.
//
// The numbering is CONTIGUOUS — 0001, 0002, … with no holes. Retiring a
// migration that no database ever ran (the Budget v2 trio was pulled this way)
// is legitimate, but the ones after it are then renumbered to close the hole, so
// the folder always reads as the order things actually run in. A hole is not
// dangerous to drizzle, which only ever reads `tag` and `when` — it is dangerous
// to the person reading the folder and guessing what comes next.
//
// Run by the pre-commit hook and CI. Keep both in sync.

import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const dir = join(root, "drizzle")
const journalPath = join(dir, "meta", "_journal.json")

const problems = []
const fail = (msg, fix) => problems.push({ msg, fix })

const journal = JSON.parse(readFileSync(journalPath, "utf8"))
const entries = journal.entries ?? []
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()

// ── 1. One number per migration ────────────────────────────────────────────
const byNumber = new Map()
for (const f of files) {
  const m = /^(\d{4})_/.exec(f)
  if (!m) {
    fail(`drizzle/${f} does not start with a 4-digit number.`, "Rename it to NNNN_name.sql.")
    continue
  }
  const n = m[1]
  if (byNumber.has(n)) {
    fail(
      `Two migrations share the number ${n}: ${byNumber.get(n)} and ${f}.`,
      `Renumber the newer one to the next free slot after ${String(Math.max(...[...byNumber.keys()].map(Number))).padStart(4, "0")}.`,
    )
  } else byNumber.set(n, f)
}

// ── 1b. No holes ───────────────────────────────────────────────────────────
const numbers = [...byNumber.keys()].map(Number).sort((a, b) => a - b)
for (let i = 1; i < numbers.length; i++) {
  if (numbers[i] !== numbers[i - 1] + 1) {
    const gap = numbers[i] - numbers[i - 1] - 1
    fail(
      `The numbering jumps from ${String(numbers[i - 1]).padStart(4, "0")} to ${String(numbers[i]).padStart(4, "0")} (${gap} missing).`,
      "Renumber the migrations after the hole so the folder reads in order. Keep every journal `when` EXACTLY as it is — it is the only field the migrator compares, so changing it re-applies or skips.",
    )
  }
}

// ── 2. Journal and folder agree ────────────────────────────────────────────
const tags = new Set(entries.map((e) => e.tag))
for (const e of entries) {
  if (!files.includes(`${e.tag}.sql`)) {
    fail(`The journal lists "${e.tag}" but drizzle/${e.tag}.sql does not exist.`, "Restore the file or drop the journal entry.")
  }
}
for (const f of files) {
  const tag = f.replace(/\.sql$/, "")
  if (!tags.has(tag)) {
    fail(
      `drizzle/${f} has no journal entry, so it will NEVER run.`,
      "Add an entry to drizzle/meta/_journal.json with idx, when and tag.",
    )
  }
}

// ── 3. The sequence only ever goes forward ─────────────────────────────────
// Array order is apply order, and `when` is the only thing compared against the
// watermark, so both have to increase together — and the filename number has to
// agree, or the folder stops describing the order things actually run in.
for (let i = 1; i < entries.length; i++) {
  const prev = entries[i - 1]
  const cur = entries[i]
  if (cur.when <= prev.when) {
    fail(
      `"${cur.tag}" is stamped when=${cur.when}, which is not after "${prev.tag}" (when=${prev.when}).`,
      "Any database already past that mark will SKIP it. Stamp it with Date.now().",
    )
  }
  if (cur.idx <= prev.idx) {
    fail(`"${cur.tag}" has idx=${cur.idx}, which is not after "${prev.tag}" (idx=${prev.idx}).`, "Give it the next idx.")
  }
  const numOf = (t) => Number(/^(\d{4})_/.exec(t)?.[1] ?? NaN)
  if (numOf(cur.tag) <= numOf(prev.tag)) {
    fail(
      `"${cur.tag}" sorts before "${prev.tag}" by filename but comes after it in the journal.`,
      "Renumber the file so the folder reads in apply order.",
    )
  }
}

// ── 4. Nothing from the future ─────────────────────────────────────────────
// A future stamp poisons every database it reaches: later migrations written
// with a real clock sort BELOW it and are skipped until the date passes.
const now = Date.now()
for (const e of entries) {
  if (e.when > now) {
    fail(
      `"${e.tag}" is stamped ${new Date(e.when).toISOString().slice(0, 10)}, which is in the FUTURE.`,
      "Every later migration stamped with a real clock will be skipped on any database this reaches. Use Date.now().",
    )
  }
}

// ── 5. Every migration must survive being re-run ───────────────────────────
// The migrator defers ALL bookkeeping inserts until after the whole batch. If
// the fifth of five statements throws, the first four have already executed and
// NOTHING is recorded — so the next run replays the batch from the top against a
// half-migrated schema. A migration that is not individually re-runnable turns
// one bad statement into a wedged database.
//
// Enforced from 0069 onward only. Everything before it shipped before this rule
// existed and is already applied everywhere; editing an applied migration is a
// no-op anyway, because the migrator records a hash and never compares it. They
// are history — read them, don't rewrite them.
const ENFORCE_RERUNNABLE_FROM = 66
const GUARDED = /IF (NOT )?EXISTS/i
for (const f of files) {
  if (Number(/^(\d{4})_/.exec(f)?.[1] ?? 0) < ENFORCE_RERUNNABLE_FROM) continue
  const sql = readFileSync(join(dir, f), "utf8")
  const lines = sql.split("\n")
  const dropped = new Set()
  lines.forEach((line, i) => {
    const drop = /DROP CONSTRAINT IF EXISTS "([^"]+)"/i.exec(line)
    if (drop) dropped.add(drop[1])
    const add = /ALTER TABLE "[^"]+" ADD CONSTRAINT "([^"]+)"/i.exec(line)
    if (add && !dropped.has(add[1])) {
      fail(
        `drizzle/${f}:${i + 1} adds constraint "${add[1]}" without dropping it first.`,
        'Precede it with ALTER TABLE … DROP CONSTRAINT IF EXISTS "…"; a replay would fail on "already exists".',
      )
    }
    const ddl = /^\s*(CREATE TABLE|CREATE INDEX|CREATE UNIQUE INDEX|CREATE SCHEMA)\s/i.exec(line)
    if (ddl && !GUARDED.test(line)) {
      fail(`drizzle/${f}:${i + 1} runs ${ddl[1]} without IF NOT EXISTS.`, "Add IF NOT EXISTS so a replay is a no-op.")
    }
    const col = /^\s*ALTER TABLE "[^"]+" ADD COLUMN\s/i.exec(line)
    if (col && !GUARDED.test(line)) {
      fail(`drizzle/${f}:${i + 1} adds a column without IF NOT EXISTS.`, "Add IF NOT EXISTS so a replay is a no-op.")
    }
  })
}

// ── Report ─────────────────────────────────────────────────────────────────
if (problems.length === 0) {
  const head = entries.at(-1)
  console.log(`✓ migrations linear (${entries.length} entries, head ${head?.tag ?? "none"})`)
  process.exit(0)
}
console.error(`\n✗ ${problems.length} migration problem${problems.length === 1 ? "" : "s"}:\n`)
for (const { msg, fix } of problems) console.error(`  ${msg}\n    → ${fix}\n`)
console.error("Migrations are applied in journal order against ONE watermark; anything out of")
console.error("order is skipped silently. See .claude/skills/migrations/SKILL.md.\n")
process.exit(1)
