#!/usr/bin/env node
// One-off merge helper used to fold freshly-generated translations into the
// locale files. It is NOT part of the build — it exists so the en-only keys
// could be backfilled into every language deterministically.
//
// Input: a JSON file shaped { "<lang>": { "<dotted.key>": "<translation>" } }
// (default /tmp/i18n-translations.json, or pass a path as argv[2]).
//
// TWO MODES, and picking the wrong one fails silently:
//
//   default (BACKFILL) — existing locale values are left untouched; only keys
//     MISSING from the locale are filled in. This is what the original en-only
//     backfill needed, and what keeps the diff purely additive.
//
//   --overwrite (CORRECTIONS) — a key present in the input REPLACES the
//     existing value. This is the mode for applying a native-speaker review,
//     where every key already exists and the whole point is to change it.
//     Without this flag such a run reports success and changes nothing.
//
// Either way the locale's key order is preserved and en.json remains the source
// of truth for WHICH keys exist.
//
// Input: a JSON file shaped { "<lang>": { "<dotted.key>": "<translation>" } }

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOCALES_DIR = resolve(__dirname, "..", "src", "lib", "i18n", "locales")
const args = process.argv.slice(2)
const OVERWRITE = args.includes("--overwrite")
const TRANS_PATH = args.find((a) => !a.startsWith("--")) || "/tmp/i18n-translations.json"

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v)

const en = JSON.parse(readFileSync(join(LOCALES_DIR, "en.json"), "utf8"))
const translations = JSON.parse(readFileSync(TRANS_PATH, "utf8"))

// Build a brand-new subtree from en, using the translation map (en fallback).
function buildNew(enNode, trans, prefix) {
  const out = {}
  for (const k of Object.keys(enNode)) {
    const path = prefix ? `${prefix}.${k}` : k
    const ev = enNode[k]
    out[k] = isObj(ev) ? buildNew(ev, trans, path) : path in trans ? trans[path] : ev
  }
  return out
}

/** Counters so the summary reports what actually happened, not what was asked. */
const stats = { changed: 0, added: 0, unchanged: 0, missing: [] }

// Merge en into an existing locale node: keep existing keys/order, append new.
function merge(enNode, locNode, trans, prefix) {
  const out = {}
  // 1. existing locale keys first, in their current order.
  for (const k of Object.keys(locNode)) {
    const path = prefix ? `${prefix}.${k}` : k
    const ev = enNode ? enNode[k] : undefined
    const lv = locNode[k]
    if (isObj(ev) && isObj(lv)) {
      out[k] = merge(ev, lv, trans, path)
    } else if (OVERWRITE && path in trans) {
      out[k] = trans[path]
      if (trans[path] === lv) stats.unchanged++
      else stats.changed++
    } else {
      out[k] = lv
      if (path in trans) stats.unchanged++
    }
  }
  // 2. en keys missing from the locale, appended in en's order (newly added)
  if (enNode) {
    for (const k of Object.keys(enNode)) {
      if (k in locNode) continue
      const path = prefix ? `${prefix}.${k}` : k
      const ev = enNode[k]
      out[k] = isObj(ev) ? buildNew(ev, trans, path) : path in trans ? trans[path] : ev
      if (!isObj(ev) && path in trans) stats.added++
    }
  }
  return out
}

const langs = Object.keys(translations).filter((c) => c !== "en")
let totalChanged = 0
for (const lang of langs) {
  const file = join(LOCALES_DIR, `${lang}.json`)
  const before = JSON.parse(readFileSync(file, "utf8"))
  stats.changed = 0
  stats.added = 0
  stats.unchanged = 0
  const merged = merge(en, before, translations[lang], "")
  writeFileSync(file, JSON.stringify(merged, null, 2) + "\n")
  totalChanged += stats.changed + stats.added

  // Report what CHANGED, not how many entries were supplied. The old message
  // counted the input and so read as success even when it altered nothing —
  // which is exactly how a whole review can be silently dropped.
  const supplied = Object.keys(translations[lang]).length
  const skipped = supplied - stats.changed - stats.added
  console.log(
    `✓ ${lang}.json — ${stats.changed} changed, ${stats.added} added, ${skipped} left as-is (of ${supplied} supplied)`,
  )
  if (skipped > 0 && !OVERWRITE) {
    console.log(
      `  ↳ ${skipped} key(s) already exist and were NOT overwritten. Re-run with --overwrite to apply corrections.`,
    )
  }
}

if (totalChanged === 0) {
  console.log(`\n⚠ Nothing changed.${OVERWRITE ? "" : " If these are corrections, re-run with --overwrite."}`)
} else {
  console.log(`\nDone — ${totalChanged} value(s) written across ${langs.length} locale(s).`)
}
console.log("Run `npm run i18n:check` to verify parity.")
