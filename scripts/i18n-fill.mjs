#!/usr/bin/env node
// i18n parity backfill.
//
// Ensures every leaf key present in en.json exists in all other locale files.
// Missing keys are filled with the ENGLISH value (a safe placeholder that keeps
// `npm run i18n:check` green and interpolation placeholders intact); a human/LLM
// can translate them later. Existing translations are never overwritten. Key
// order in each locale is left untouched except for appended new keys, which are
// inserted in their natural (en) position via a structural deep-merge.
//
// Run:  node scripts/i18n-fill.mjs
import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOCALES_DIR = resolve(__dirname, "..", "src", "lib", "i18n", "locales")
const SOURCE = "en"

const isPlainObject = (v) => v && typeof v === "object" && !Array.isArray(v)

/** Deep-merge: for every key in `src`, ensure `dst` has it. Returns filled count. */
function fillMissing(src, dst, counter) {
  const out = isPlainObject(dst) ? { ...dst } : {}
  for (const key of Object.keys(src)) {
    if (isPlainObject(src[key])) {
      out[key] = fillMissing(src[key], out[key], counter)
    } else if (!(key in out)) {
      out[key] = src[key]
      counter.n++
    }
  }
  // Preserve any keys the locale has that en doesn't (the check only warns).
  if (isPlainObject(dst)) for (const key of Object.keys(dst)) if (!(key in out)) out[key] = dst[key]
  return out
}

const source = JSON.parse(readFileSync(join(LOCALES_DIR, `${SOURCE}.json`), "utf8"))
const codes = readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .filter((c) => c !== SOURCE)

let totalFilled = 0
for (const code of codes) {
  const path = join(LOCALES_DIR, `${code}.json`)
  const target = JSON.parse(readFileSync(path, "utf8"))
  const counter = { n: 0 }
  const merged = fillMissing(source, target, counter)
  if (counter.n > 0) {
    writeFileSync(path, JSON.stringify(merged, null, 2) + "\n")
    console.log(`  ${code}: filled ${counter.n} key(s) with English placeholder`)
    totalFilled += counter.n
  }
}
console.log(totalFilled === 0 ? "All locales already in parity." : `Done — filled ${totalFilled} placeholder(s) across ${codes.length} locales.`)
