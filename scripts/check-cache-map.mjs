#!/usr/bin/env node
// The cache map has to keep agreeing with the code it describes. Two things
// drift on their own, and both are silent:
//
//   1. A GET route starts MATERIALISING money (posting due recurring rows,
//      filing a statement, running autopay) while serving a read. If the cache
//      policy doesn't mark it alwaysFetch, that work stops happening as soon as
//      a cached body is good enough to paint — no error, no failed request,
//      just a payment that never posts.
//   2. A write ships to a path with no fanout rule. That falls back to purging
//      the whole cache: correct, but it throws away every screen's data on an
//      unrelated write, which is exactly the lag this system exists to remove.
//
//   node scripts/check-cache-map.mjs

import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { build } from "esbuild"

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8" })
  } catch {
    return ""
  }
}

/**
 * Files under `dir` with one of `exts`.
 *
 * A directory pathspec, NOT a `**` glob: git's `api/_routes/**\/*.ts` matches
 * nothing at the top level, so `cards.ts`, `transactions.ts`, `calendar.ts` and
 * `flow.ts` — four of the routes that matter most here — were invisible to this
 * check until it was written this way.
 */
const files = (dir, ...exts) =>
  git(["ls-files", "--", dir])
    .split("\n")
    .filter((f) => f && exts.some((e) => f.endsWith(e)))

// The policy is TypeScript and this is Node, so bundle it the way the app would
// and import the real functions — re-implementing the matching here would just
// create a third thing to keep in sync.
const out = mkdtempSync(join(tmpdir(), "cache-map-"))
const bundle = join(out, "api-cache.mjs")
await build({
  entryPoints: ["src/lib/api-cache.ts"],
  outfile: bundle,
  bundle: true,
  format: "esm",
  platform: "neutral",
  logLevel: "silent",
})
const policy = await import(pathToFileURL(bundle).href)
rmSync(out, { recursive: true, force: true })

let failures = 0
const fail = (msg) => {
  console.error(`✗ ${msg}`)
  failures++
}

// ── 1. Every side-effecting GET route is marked alwaysFetch ──────────────────

// Helpers that write money while a GET is being served.
const SIDE_EFFECT_CALLS = /\b(materializeDueRecurring|syncCards|runAutopay|fileDueStatements)\s*\(/
/**
 * Can a browser GET reach this handler? Routes state it three ways: an early
 * `!== "GET"` 405 (GET only), an `=== "GET"` branch among several, or an early
 * `!== "POST"` 405 (no GET at all). A handler with no method check at all
 * answers every method, GET included.
 */
function servesGet(src) {
  if (/req\.method\s*!==\s*"GET"/.test(src)) return true
  if (/req\.method\s*===\s*"GET"/.test(src)) return true
  if (/req\.method\s*(?:===|!==)\s*"/.test(src)) return false
  return true
}

/** api/_routes/wealth/accounts.ts → /api/wealth/accounts (dynamic segments dropped) */
function routePath(file) {
  const rel = file.replace(/^api\/_routes\//, "").replace(/\.ts$/, "")
  const parts = rel.split("/")
  const kept = []
  for (const p of parts) {
    if (p.startsWith("[")) break // a dynamic segment ends the static prefix
    kept.push(p)
  }
  return `/api/${kept.join("/")}`
}

for (const file of files("api/_routes", ".ts")) {
  if (file.endsWith(".test.ts")) continue
  // Cron runs server-side on a schedule; no browser GET reaches it.
  if (file.startsWith("api/_routes/cron/")) continue
  const src = readFileSync(file, "utf8")
  if (!SIDE_EFFECT_CALLS.test(src) || !servesGet(src)) continue
  const path = routePath(file)
  if (!policy.policyFor(path).alwaysFetch) {
    fail(
      `${file} materialises money on a GET, but policyFor("${path}") is not alwaysFetch.\n` +
        `  Add its prefix to ALWAYS_FETCH in src/lib/api-cache.ts, or the server-side work stops\n` +
        `  running as soon as a cached body is fresh enough to paint.`,
    )
  }
}

// ── 2. Every write path has an explicit fanout rule ─────────────────────────

const WRITE_CALL = /\bapi(?:Post|Patch|Put|Delete)\s*<[^>]*>?\s*\(\s*[`"']([^`"'$]*)/g
const seen = new Map()

for (const file of files("src", ".ts", ".tsx")) {
  if (file.endsWith(".test.ts") || file === "src/lib/api.ts") continue
  const src = readFileSync(file, "utf8")
  for (const m of src.matchAll(WRITE_CALL)) {
    const path = m[1]
    if (!path.startsWith("/api/")) continue // a template built from a variable
    if (!seen.has(path)) seen.set(path, file)
  }
}

for (const [path, file] of seen) {
  if (policy.hasFanoutRule(path)) continue
  fail(
    `${file} writes to "${path}", which has no rule in FANOUT or FULL_PURGE.\n` +
      `  It falls back to purging the entire cache. Add the read prefixes this write\n` +
      `  actually invalidates to src/lib/api-cache.ts.`,
  )
}

if (failures > 0) {
  console.error(`\n${failures} cache-map problem${failures === 1 ? "" : "s"}. See src/lib/api-cache.ts.`)
  process.exit(1)
}
console.log(`✓ cache map: ${seen.size} write paths mapped, side-effecting GETs marked alwaysFetch`)
