#!/usr/bin/env node
// i18n parity gate.
//
// English (`en.json`) is the single source of truth for translation keys.
// This script fails (exit 1) if any other locale is missing a key that exists
// in English, has an empty/blank value for one, breaks an interpolation
// placeholder (e.g. drops `{{count}}`), or leaves the ENGLISH TEXT IN PLACE.
//
// That last check is the one that matters most, and the one this gate was
// missing: a key that merely EXISTS is not a key that is translated. Parity
// passed for months while ~470 keys sat in English in every other language, so
// /debts read half in English for anyone using Malayalam. Copying en.json into
// a locale to "make the check pass" is now exactly what fails it.
//
// Strings that really are identical in another language — a brand, an
// international standard like IBAN, sample data, a loanword like "Status" in
// German — are listed in src/lib/i18n/identical-ok.json, per locale, with a
// reason a reviewer can read.
//
// It is wired into the husky pre-commit hook so that the moment a new key is
// added to en.json, every language must be updated before the commit can land.
//
// Run manually:  node scripts/check-i18n.mjs
// npm script:    npm run i18n:check

import { readFileSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const I18N_DIR = resolve(__dirname, "..", "src", "lib", "i18n")
const LOCALES_DIR = join(I18N_DIR, "locales")
const IDENTICAL_OK = join(I18N_DIR, "identical-ok.json")
const SOURCE = "en"

const RED = "\x1b[31m"
const YELLOW = "\x1b[33m"
const GREEN = "\x1b[32m"
const DIM = "\x1b[2m"
const BOLD = "\x1b[1m"
const RESET = "\x1b[0m"

/** Flatten a nested locale object into dotted leaf keys. */
function flatten(obj, prefix = "", out = {}) {
  for (const key of Object.keys(obj)) {
    const value = obj[key]
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flatten(value, path, out)
    } else {
      out[path] = value
    }
  }
  return out
}

/** Extract the set of `{{placeholder}}` tokens from a string value. */
function placeholders(value) {
  if (typeof value !== "string") return []
  const found = value.match(/\{\{\s*[^}]+?\s*\}\}/g) || []
  // Normalise whitespace inside the braces so `{{ count }}` === `{{count}}`.
  return [...new Set(found.map((p) => p.replace(/\s+/g, "")))].sort()
}

// i18next plural suffixes whose category maps to a fixed small count (0, 1, 2).
// In many languages the natural phrasing for these spells the number out
// ("one client", "عميل واحد") rather than interpolating {{count}}, so dropping
// the count placeholder there is legitimate — we don't flag it.
const FIXED_COUNT_PLURALS = /_(zero|one|two)$/

/** Placeholders English requires of a translation for `key`. */
function requiredPlaceholders(key, enValue) {
  let want = placeholders(enValue)
  if (FIXED_COUNT_PLURALS.test(key)) want = want.filter((p) => p !== "{{count}}")
  return want
}

/**
 * Keys allowed to stay identical to English, per locale.
 * Shape: { "<dotted.key>": { locales: ["*"] | ["de","it"], why: "..." } }
 */
function loadIdenticalOk() {
  let raw
  try {
    raw = JSON.parse(readFileSync(IDENTICAL_OK, "utf8"))
  } catch {
    return () => false
  }
  return (key, code) => {
    const entry = raw[key]
    if (!entry || !Array.isArray(entry.locales)) return false
    return entry.locales.includes("*") || entry.locales.includes(code)
  }
}

function loadLocale(code) {
  const raw = readFileSync(join(LOCALES_DIR, `${code}.json`), "utf8")
  return flatten(JSON.parse(raw))
}

function listLocaleCodes() {
  return readdirSync(LOCALES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort()
}

function main() {
  const codes = listLocaleCodes()
  if (!codes.includes(SOURCE)) {
    console.error(`${RED}✗ Source locale "${SOURCE}.json" not found in ${LOCALES_DIR}${RESET}`)
    process.exit(1)
  }

  const source = loadLocale(SOURCE)
  const sourceKeys = Object.keys(source)
  const targets = codes.filter((c) => c !== SOURCE)

  const identicalOk = loadIdenticalOk()
  let hasError = false
  let hasWarning = false

  console.log(
    `${BOLD}i18n parity check${RESET} ${DIM}(source: ${SOURCE}.json, ${sourceKeys.length} keys, ${targets.length} target locales)${RESET}\n`
  )

  for (const code of targets) {
    const target = loadLocale(code)
    const targetKeys = new Set(Object.keys(target))

    const missing = []
    const empty = []
    const placeholderIssues = []
    const untranslated = []

    for (const key of sourceKeys) {
      if (!targetKeys.has(key)) {
        missing.push(key)
        continue
      }
      const value = target[key]
      if (typeof value === "string" && value.trim() === "") {
        empty.push(key)
        continue
      }
      // Still in English. The whole point of the gate: a key that exists but
      // was copied from en.json is not translated, it only looks translated.
      if (typeof value === "string" && value === source[key] && !identicalOk(key, code)) {
        untranslated.push(key)
        continue
      }
      // Every placeholder used in English must survive translation, otherwise
      // interpolation breaks at runtime (fixed-count plural forms excepted).
      const want = requiredPlaceholders(key, source[key])
      if (want.length) {
        const got = new Set(placeholders(value))
        const dropped = want.filter((p) => !got.has(p))
        if (dropped.length) placeholderIssues.push({ key, dropped })
      }
    }

    // Keys present in the locale but absent from English — usually stale/renamed.
    const extra = [...targetKeys].filter((k) => !(k in source))

    const localeHasError = missing.length || empty.length || placeholderIssues.length || untranslated.length
    const localeHasWarning = extra.length

    if (!localeHasError && !localeHasWarning) {
      console.log(`  ${GREEN}✓${RESET} ${BOLD}${code}${RESET} ${DIM}— complete (${targetKeys.size} keys)${RESET}`)
      continue
    }

    if (localeHasError) hasError = true
    if (localeHasWarning) hasWarning = true

    const mark = localeHasError ? `${RED}✗${RESET}` : `${YELLOW}!${RESET}`
    console.log(`  ${mark} ${BOLD}${code}${RESET}`)

    if (missing.length) {
      console.log(`      ${RED}${missing.length} missing key(s):${RESET}`)
      for (const key of missing) {
        console.log(`        ${DIM}-${RESET} ${key}  ${DIM}(en: ${JSON.stringify(source[key])})${RESET}`)
      }
    }
    if (empty.length) {
      console.log(`      ${RED}${empty.length} empty value(s):${RESET}`)
      for (const key of empty) console.log(`        ${DIM}-${RESET} ${key}`)
    }
    if (untranslated.length) {
      console.log(`      ${RED}${untranslated.length} still in English:${RESET}`)
      for (const key of untranslated) {
        console.log(`        ${DIM}-${RESET} ${key}  ${DIM}${JSON.stringify(source[key])}${RESET}`)
      }
    }
    if (placeholderIssues.length) {
      console.log(`      ${RED}${placeholderIssues.length} broken placeholder(s):${RESET}`)
      for (const { key, dropped } of placeholderIssues) {
        console.log(`        ${DIM}-${RESET} ${key}  ${DIM}(missing: ${dropped.join(", ")})${RESET}`)
      }
    }
    if (extra.length) {
      console.log(`      ${YELLOW}${extra.length} extra key(s) not in en.json (warning):${RESET}`)
      for (const key of extra) console.log(`        ${DIM}-${RESET} ${key}`)
    }
  }

  console.log("")

  if (hasError) {
    console.error(
      `${RED}${BOLD}✗ i18n parity check failed.${RESET} ${RED}Every key in en.json must exist (and be non-empty, with matching placeholders) in all other locales.${RESET}`
    )
    console.error(
      `${DIM}  Add the missing translations to the locale files in src/lib/i18n/locales/ and commit again.${RESET}`
    )
    console.error(
      `${DIM}  A string that really IS the same in that language (a brand, IBAN, a loanword)${RESET}`
    )
    console.error(
      `${DIM}  goes in src/lib/i18n/identical-ok.json with the locale and a one-line reason.${RESET}`
    )
    process.exit(1)
  }

  if (hasWarning) {
    console.log(`${YELLOW}⚠ i18n parity check passed with warnings (extra keys above).${RESET}`)
  } else {
    console.log(`${GREEN}${BOLD}✓ i18n parity check passed — all locales are in sync with en.json.${RESET}`)
  }
}

main()
