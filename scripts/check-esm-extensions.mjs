#!/usr/bin/env node
// Walks the import graph of the deployed serverless functions and fails on any
// relative VALUE import that lacks a .js extension.
//
// Why: the api/ functions run as unbundled ESM on @vercel/node. Node's ESM
// resolver requires explicit file extensions for relative specifiers, so an
// extensionless import works everywhere locally (vite / tsx / vitest resolve
// it) but crashes the WHOLE consolidated api function at module load in
// production with ERR_MODULE_NOT_FOUND — every /api/* request 500s. This is
// exactly what took production down on 2026-06-13 (v0.4.0:
// src/lib/billing-currency.ts imported "./currencies" without the extension).
//
// `import type { … }` / `export type { … }` are erased by tsc and never reach
// the runtime, so they're exempt.
//
// Run by the pre-commit hook and CI next to the other gates.

import { readFileSync, existsSync } from "node:fs"
import { dirname, resolve, relative } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

// Every Vercel function entrypoint (files in api/ outside _-prefixed dirs).
const ENTRYPOINTS = ["api/index.ts", "api/billing/webhook.ts", "api/ssr.ts"]

// import / export ... from "spec" | import("spec") — captures the specifier and
// whether it is a type-only form.
const IMPORT_RE = /(?:import|export)\s+(type\s+)?(?:[\s\S]*?from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g

const visited = new Set()
const problems = []

function resolveToFile(fromDir, spec) {
  const base = resolve(fromDir, spec)
  if (spec.endsWith(".js")) {
    const ts = base.slice(0, -3) + ".ts"
    if (existsSync(ts)) return ts
    if (existsSync(base)) return base
    return null
  }
  for (const cand of [base + ".ts", base + ".tsx", resolve(base, "index.ts")]) {
    if (existsSync(cand)) return cand
  }
  return null
}

function walk(file) {
  if (visited.has(file)) return
  visited.add(file)
  let src
  try {
    src = readFileSync(file, "utf8")
  } catch {
    return
  }
  const dir = dirname(file)
  for (const m of src.matchAll(IMPORT_RE)) {
    const typeOnly = Boolean(m[1])
    const spec = m[2] ?? m[3]
    if (!spec || !spec.startsWith(".")) continue
    const target = resolveToFile(dir, spec)
    if (!typeOnly && !spec.endsWith(".js") && !spec.endsWith(".json")) {
      problems.push(`${relative(root, file)} → "${spec}"`)
    }
    if (target) walk(target)
  }
}

for (const entry of ENTRYPOINTS) {
  const file = resolve(root, entry)
  if (existsSync(file)) walk(file)
}

if (problems.length) {
  console.error("✗ ESM extension check failed — these relative imports are reachable from the")
  console.error("  api/ serverless functions and MUST end in .js (Node ESM, unbundled @vercel/node;")
  console.error("  extensionless specifiers crash EVERY /api/* route in production):\n")
  for (const p of problems) console.error("  " + p)
  console.error(`\n  ${problems.length} bad import(s) across ${visited.size} reachable files.`)
  process.exit(1)
}
console.log(`✓ ESM extension check passed (${visited.size} files reachable from api/ entrypoints)`)
