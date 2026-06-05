#!/usr/bin/env node
// One-off merge helper used to fold freshly-generated translations into the
// locale files. It is NOT part of the build — it exists so the en-only keys
// could be backfilled into every language deterministically.
//
// Input: a JSON file shaped { "<lang>": { "<dotted.key>": "<translation>" } }
// (default /tmp/i18n-translations.json, or pass a path as argv[2]).
//
// For each language it deep-merges the translations into
// src/lib/i18n/locales/<lang>.json, PRESERVING the existing keys and their
// order (so the diff is purely additive) and inserting any new keys following
// en.json's structure. English is the source of truth for which keys exist.

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOCALES_DIR = resolve(__dirname, "..", "src", "lib", "i18n", "locales")
const TRANS_PATH = process.argv[2] || "/tmp/i18n-translations.json"

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

// Merge en into an existing locale node: keep existing keys/order, append new.
function merge(enNode, locNode, trans, prefix) {
  const out = {}
  // 1. existing locale keys first, in their current order (values untouched)
  for (const k of Object.keys(locNode)) {
    const path = prefix ? `${prefix}.${k}` : k
    const ev = enNode ? enNode[k] : undefined
    const lv = locNode[k]
    out[k] = isObj(ev) && isObj(lv) ? merge(ev, lv, trans, path) : lv
  }
  // 2. en keys missing from the locale, appended in en's order (newly added)
  if (enNode) {
    for (const k of Object.keys(enNode)) {
      if (k in locNode) continue
      const path = prefix ? `${prefix}.${k}` : k
      const ev = enNode[k]
      out[k] = isObj(ev) ? buildNew(ev, trans, path) : path in trans ? trans[path] : ev
    }
  }
  return out
}

const langs = Object.keys(translations).filter((c) => c !== "en")
for (const lang of langs) {
  const file = join(LOCALES_DIR, `${lang}.json`)
  const before = JSON.parse(readFileSync(file, "utf8"))
  const merged = merge(en, before, translations[lang], "")
  writeFileSync(file, JSON.stringify(merged, null, 2) + "\n")
  console.log(`✓ ${lang}.json merged (${Object.keys(translations[lang]).length} translation entries applied)`)
}

console.log(`\nDone — merged ${langs.length} locale(s). Run \`npm run i18n:check\` to verify parity.`)
