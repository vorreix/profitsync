#!/usr/bin/env node
// PostToolUse hook: catch an untranslated string at the moment it is written,
// not at the commit gate half an hour later when the context is gone.
//
// Two things go wrong, and neither looks like a bug on an English screen:
//
//   • a key added to en.json and nowhere else — or worse, PASTED into the other
//     seven files unchanged, which the old parity check happily accepted. That
//     is how ~470 keys came to sit in English in every language while CI stayed
//     green and /debts rendered half in English for anyone reading Malayalam;
//
//   • English typed straight into JSX, which never reaches a locale file at all,
//     so there is nothing to translate and every user sees English forever.
//
// It runs only after an edit that could cause either, and exits 2 so the failure
// is handed straight back to the agent while it still remembers the string.

import { execFileSync } from "node:child_process"

/** An edit to any of these can break parity. */
const LOCALE_FILE = /^src\/lib\/i18n\/(locales\/[a-z-]+\.json|identical-ok\.json)$/
/** A component edit only matters if it could have introduced visible text. */
const COMPONENT = /^src\/(?!lib\/i18n\/|components\/ui\/|landing\/).*\.tsx$/
/** Cheap pre-filter: a JSX text node or a translatable attribute with a literal. */
const LOOKS_LIKE_TEXT = /(>\s*[A-Za-z][^<>{}\n]{2,}\s*<)|((?:placeholder|aria-label|title|alt)\s*=\s*"[^"{}]{3,}")/

function run(script) {
  try {
    execFileSync("node", [script], { encoding: "utf8", stdio: "pipe" })
    return null
  } catch (err) {
    return `${err.stdout ?? ""}${err.stderr ?? ""}`.trim()
  }
}

let input = ""
for await (const chunk of process.stdin) input += chunk

let payload = {}
try {
  payload = JSON.parse(input || "{}")
} catch {
  process.exit(0) // not our business to fail on an unparsable hook payload
}

const file = payload?.tool_input?.file_path ?? ""
if (!file) process.exit(0)
const rel = file.replace(`${process.cwd()}/`, "")

const edited = `${payload?.tool_input?.content ?? ""}${payload?.tool_input?.new_string ?? ""}`
const touchedLocale = LOCALE_FILE.test(rel)
const touchedComponent = COMPONENT.test(rel) && LOOKS_LIKE_TEXT.test(edited)
if (!touchedLocale && !touchedComponent) process.exit(0)

const problems = []
if (touchedLocale) {
  const out = run("scripts/check-i18n.mjs")
  if (out) {
    problems.push(
      `Translations are incomplete after editing ${rel}:\n\n${out}\n\n` +
        `Every key in en.json must exist in all 8 locales, keep its {{placeholders}}, and be\n` +
        `ACTUALLY TRANSLATED — a value copied from English now fails this check, because a key\n` +
        `that merely exists is not a key a user can read.\n\n` +
        `If a string really is identical in that language (a brand, an international standard\n` +
        `like IBAN, sample data, or a loanword such as "Status" in German), add it to\n` +
        `src/lib/i18n/identical-ok.json with the locale and a one-line reason.\n\n` +
        `scripts/i18n-merge.mjs bulk-merges a { lang: { "dotted.key": value } } map.`,
    )
  }
}
if (touchedComponent) {
  const out = run("scripts/check-i18n-hardcoded.mjs")
  if (out) {
    problems.push(
      `New user-visible English was typed straight into JSX in ${rel}:\n\n${out}\n\n` +
        `It will render in English for every user in every language, and there is nothing in\n` +
        `a locale file to translate. Move it into src/lib/i18n/locales/en.json, translate it\n` +
        `into all 8 locales, and render it with t("your.key").`,
    )
  }
}

if (problems.length) {
  console.error(`${problems.join("\n\n")}\n\nSee the "i18n" skill for the full recipe.`)
  process.exit(2) // blocking: hand it back to the agent now
}
process.exit(0)
