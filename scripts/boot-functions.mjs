#!/usr/bin/env node
// Boots every Vercel serverless function the way PRODUCTION does, and fails on
// any module-load crash.
//
// Why this exists: on 2026-06-13 the v0.4.0 release took every /api/* route
// down with FUNCTION_INVOCATION_FAILED while the whole gate (lint, typecheck,
// unit tests, e2e) was green. The functions run as UNBUNDLED ESM on
// @vercel/node — each .ts file is transpiled 1:1 to .js and resolved by Node's
// own ESM resolver at runtime. Vite, tsx and Vitest all use bundler-style
// resolution, so a whole class of prod-only failures (extensionless relative
// imports, JSON imports without attributes, top-level env/config throws) can
// never surface in tests that go through them.
//
// This script reproduces the production setup faithfully:
//   1. esbuild-TRANSPILES (no bundling — import specifiers untouched) the
//      function entrypoints + their full relative-import graph into a temp
//      dir, .ts -> .js, exactly like @vercel/node does;
//   2. copies the JSON files the graph requires plus vercel.json includeFiles
//      needed at module scope;
//   3. imports each function entry in THIS Node process (placeholder env), so
//      Node's real ESM resolver and all top-level module code run.
//
// Any ERR_MODULE_NOT_FOUND / module-init throw here is exactly what production
// does on its first request. Complements scripts/check-esm-extensions.mjs
// (the fast static check with friendlier messages); this one is the
// end-to-end proof.
//
// Run by the pre-commit hook and pr.yml. Keep both in sync.

import { build } from "esbuild"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const ENTRYPOINTS = ["api/index.ts", "api/billing/webhook.ts", "api/ssr.ts"]

// Files some function loads at MODULE scope from disk (vercel.json
// includeFiles); they must exist next to the transpiled output for boot.
const MODULE_SCOPE_INCLUDES = ["src/landing/i18n/locales/en.json"]

// Placeholder env mirroring vite.config.ts's test env: enough for modules to
// CONSTRUCT (the Neon client never connects unless a query runs). Add a var
// here if a function legitimately needs one at module scope.
process.env.DATABASE_URL ||= "postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder" // secret-scan:ignore
process.env.CLERK_SECRET_KEY ||= "sk_test_placeholder" // secret-scan:ignore
process.env.DODO_PAYMENTS_WEBHOOK_SECRET ||= "whsec_placeholder" // secret-scan:ignore

const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g

function relativeToRoot(p) {
  return p.startsWith(root) ? p.slice(root.length + 1) : p
}

// Collect the full relative-import graph (TS sources + JSON files) from the
// entrypoints, mirroring how the deployed function's file trace works.
function collectGraph() {
  const seen = new Set()
  const tsFiles = []
  const jsonFiles = []
  const queue = ENTRYPOINTS.map((e) => resolve(root, e))
  while (queue.length) {
    const file = queue.pop()
    if (seen.has(file) || !existsSync(file)) continue
    seen.add(file)
    tsFiles.push(file)
    const src = readFileSync(file, "utf8")
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2]
      if (!spec || !spec.startsWith(".")) continue
      const base = resolve(dirname(file), spec)
      const candidates = spec.endsWith(".js")
        ? [base.slice(0, -3) + ".ts"]
        : spec.endsWith(".json")
          ? [base]
          : [base + ".ts", base + ".tsx", resolve(base, "index.ts")]
      for (const cand of candidates) {
        if (!existsSync(cand)) continue
        if (cand.endsWith(".json")) jsonFiles.push(cand)
        else queue.push(cand)
        break
      }
    }
  }
  return { tsFiles, jsonFiles }
}

// Inside node_modules/.cache so bare package imports (drizzle-orm, @clerk/…)
// resolve against the repo's real node_modules when Node walks up from the
// transpiled files.
const out = resolve(root, "node_modules", ".cache", "profitsync-func-boot")
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
try {
  const { tsFiles, jsonFiles } = collectGraph()

  await build({
    entryPoints: tsFiles,
    outdir: out,
    outbase: root,
    bundle: false, // transpile only — import specifiers stay exactly as written
    format: "esm",
    platform: "node",
    sourcemap: false,
    logLevel: "silent",
  })

  for (const extra of [...jsonFiles.map(relativeToRoot), ...MODULE_SCOPE_INCLUDES]) {
    const src = resolve(root, extra)
    if (existsSync(src)) cpSync(src, join(out, extra))
  }

  let failed = false
  for (const entry of ENTRYPOINTS) {
    const compiled = join(out, entry.replace(/\.ts$/, ".js"))
    try {
      const mod = await import(pathToFileURL(compiled).href)
      const handler = mod.default ?? mod.handler
      if (typeof handler !== "function") throw new Error("module loaded but exports no handler function")
      console.log(`✓ ${entry} boots (handler ok)`)
    } catch (err) {
      failed = true
      console.error(`✗ ${entry} FAILED to boot — this is FUNCTION_INVOCATION_FAILED in production:`)
      console.error(`  ${err.code ?? ""} ${String(err.message).split("\n")[0]}`)
    }
  }
  if (failed) process.exit(1)
  console.log(`✓ all functions boot under Node ESM (${tsFiles.length} modules transpiled)`)
} finally {
  rmSync(out, { recursive: true, force: true })
}
