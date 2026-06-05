#!/usr/bin/env node
// One-off helper: overwrite specific dotted keys in locale files with corrected
// values from a review pass. Unlike i18n-merge.mjs (which only ADDS missing
// keys), this OVERWRITES existing leaf values in place, preserving key order
// and nesting.
//
// Input: a JSON file shaped { "<lang>": { "<dotted.key>": "<corrected value>" } }
// (default /tmp/i18n-corrections.json, or pass a path as argv[2]).

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOCALES_DIR = resolve(__dirname, "..", "src", "lib", "i18n", "locales")
const PATH = process.argv[2] || "/tmp/i18n-corrections.json"

const corrections = JSON.parse(readFileSync(PATH, "utf8"))

function setDeep(obj, dottedKey, value) {
  const parts = dottedKey.split(".")
  let node = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]
    if (!node[p] || typeof node[p] !== "object") return false // path doesn't exist — skip
    node = node[p]
  }
  const leaf = parts[parts.length - 1]
  if (!(leaf in node)) return false
  node[leaf] = value
  return true
}

let total = 0
for (const lang of Object.keys(corrections)) {
  const entries = corrections[lang]
  const keys = Object.keys(entries)
  if (!keys.length) {
    console.log(`· ${lang}.json — no corrections`)
    continue
  }
  const file = join(LOCALES_DIR, `${lang}.json`)
  const data = JSON.parse(readFileSync(file, "utf8"))
  let applied = 0
  const skipped = []
  for (const key of keys) {
    if (setDeep(data, key, entries[key])) applied++
    else skipped.push(key)
  }
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n")
  total += applied
  console.log(`✓ ${lang}.json — ${applied}/${keys.length} corrections applied${skipped.length ? ` (skipped: ${skipped.join(", ")})` : ""}`)
}

console.log(`\nDone — ${total} correction(s) applied. Run \`npm run i18n:check\` to verify parity.`)
