#!/usr/bin/env node
// Hardcoded-English gate.
//
// The parity check (scripts/check-i18n.mjs) only sees strings that made it into
// en.json. It is blind to the other half of the problem: English typed straight
// into JSX, which never reaches a locale file at all and so renders in English
// for every user in every language, with nothing to translate.
//
// This scans src/ for user-visible text that never passes through t():
//   • JSX text nodes            <p>Nothing owed</p>
//   • translatable attributes   placeholder="Search…"  aria-label="Close"
//
// RATCHET, NOT A CLIFF. There is already a backlog (mostly /admin). Failing on
// all of it would mean nobody could commit, so the count per file is recorded in
// src/lib/i18n/hardcoded-baseline.json and this fails when a file goes ABOVE its
// number or a file appears that is not in it. Existing debt is frozen; new debt
// is refused. Lower a number whenever you fix something and it can never come back.
//
// Run:          node scripts/check-i18n-hardcoded.mjs
// Re-baseline:  node scripts/check-i18n-hardcoded.mjs --write   (review the diff!)
// npm script:   npm run i18n:hardcoded

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..")
const SRC = join(ROOT, "src")
const BASELINE = join(SRC, "lib", "i18n", "hardcoded-baseline.json")

const RED = "\x1b[31m"
const YELLOW = "\x1b[33m"
const GREEN = "\x1b[32m"
const DIM = "\x1b[2m"
const BOLD = "\x1b[1m"
const RESET = "\x1b[0m"

/**
 * Directories this gate does not police, each for its own reason.
 *  - components/ui: vendored shadcn, replaced wholesale by the CLI.
 *  - landing + blog: the marketing site, which carries its own isolated i18n.
 *  - lib/i18n: the locale files themselves.
 */
const SKIP = ["components/ui/", "landing/", "lib/i18n/"]

/** Attributes whose string value is read out or read by a user. */
const ATTRS = ["placeholder", "aria-label", "title", "alt", "aria-description"]

// A JSX text node between tags: >Some words<. Deliberately narrow — it must
// start with a capital letter or a digit-free word and contain a space or be a
// known word-ish token, so `>{x}<`, `>·<` and `>{" "}<` never match.
const TEXT_NODE = />\s*([A-Za-z][^<>{}\n]{2,80}?)\s*</g
const ATTR_RE = new RegExp(`\\b(${ATTRS.join("|")})\\s*=\\s*"([^"{}]{2,80})"`, "g")

/** Text that is not really a sentence for a human to read. */
function ignorable(s) {
  const t = s.trim()
  if (t.length < 3) return true
  // No letters at all, or a lone token with no vowel (units, codes).
  if (!/[A-Za-z]/.test(t)) return true
  // Tailwind/class-ish, camelCase identifiers, paths, urls, mime types.
  if (/^[a-z]+([A-Z][a-z]*)+$/.test(t)) return true
  if (/^[\w-]+\/[\w-]+$/.test(t)) return true
  if (/^https?:|^\/|^#|^@/.test(t)) return true
  // A single all-caps token is usually a code (PDF, CSV, EUR).
  if (/^[A-Z0-9.\-/]+$/.test(t)) return true
  return false
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (full.endsWith(".tsx")) out.push(full)
  }
  return out
}

function scanFile(full) {
  const rel = relative(SRC, full).split("\\").join("/")
  if (SKIP.some((s) => rel.startsWith(s))) return null
  const src = readFileSync(full, "utf8")
  const hits = []
  src.split("\n").forEach((line, i) => {
    // A line that is a comment, or that already calls t(), is left alone: the
    // literal on it is nearly always a fallback or a key, not the shown text.
    const code = line.replace(/\/\/.*$/, "")
    if (/\bt\(/.test(code)) return
    for (const m of code.matchAll(TEXT_NODE)) {
      if (!ignorable(m[1])) hits.push({ line: i + 1, kind: "text", text: m[1].trim() })
    }
    for (const m of code.matchAll(ATTR_RE)) {
      if (!ignorable(m[2])) hits.push({ line: i + 1, kind: m[1], text: m[2].trim() })
    }
  })
  return { file: `src/${rel}`, hits }
}

function main() {
  const write = process.argv.includes("--write")
  const results = walk(SRC).map(scanFile).filter((r) => r && r.hits.length > 0)
  const counts = Object.fromEntries(results.map((r) => [r.file, r.hits.length]))
  const total = Object.values(counts).reduce((a, b) => a + b, 0)

  if (write) {
    const payload = {
      _readme: [
        "Files with English typed straight into JSX, and how many strings each still has.",
        "",
        "This is a RATCHET: scripts/check-i18n-hardcoded.mjs fails when a file goes above",
        "its number, or when a file appears here that is not listed. Existing debt is",
        "frozen; new debt is refused.",
        "",
        "When you move a string into en.json and all eight locales, LOWER the number.",
        "When a file reaches zero, delete its line. Never raise a number to make the",
        "check pass — that is the check working.",
        "",
        "Regenerate with: node scripts/check-i18n-hardcoded.mjs --write (and read the diff)",
      ],
      files: Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))),
    }
    writeFileSync(BASELINE, `${JSON.stringify(payload, null, 2)}\n`)
    console.log(`${GREEN}✓${RESET} baseline written: ${total} strings across ${results.length} files`)
    return
  }

  let baseline
  try {
    baseline = JSON.parse(readFileSync(BASELINE, "utf8")).files ?? {}
  } catch {
    console.error(`${RED}✗ ${relative(ROOT, BASELINE)} is missing. Create it with --write.${RESET}`)
    process.exit(1)
  }

  const over = []
  const isNew = []
  for (const r of results) {
    const allowed = baseline[r.file]
    if (allowed === undefined) isNew.push(r)
    else if (r.hits.length > allowed) over.push({ ...r, allowed })
  }
  const fixed = Object.entries(baseline).filter(([f, n]) => (counts[f] ?? 0) < n)

  console.log(
    `${BOLD}hardcoded-English check${RESET} ${DIM}(${total} strings in ${results.length} files; baseline allows ${Object.values(baseline).reduce((a, b) => a + b, 0)})${RESET}\n`
  )

  for (const r of isNew) {
    console.log(`  ${RED}✗${RESET} ${BOLD}${r.file}${RESET} ${DIM}— not in the baseline, ${r.hits.length} string(s)${RESET}`)
    for (const h of r.hits.slice(0, 8)) console.log(`      ${DIM}${h.line}${RESET} [${h.kind}] ${JSON.stringify(h.text)}`)
    if (r.hits.length > 8) console.log(`      ${DIM}… and ${r.hits.length - 8} more${RESET}`)
  }
  for (const r of over) {
    console.log(`  ${RED}✗${RESET} ${BOLD}${r.file}${RESET} ${DIM}— ${r.hits.length}, baseline allows ${r.allowed}${RESET}`)
    for (const h of r.hits.slice(0, 8)) console.log(`      ${DIM}${h.line}${RESET} [${h.kind}] ${JSON.stringify(h.text)}`)
  }

  if (isNew.length || over.length) {
    console.error(
      `\n${RED}${BOLD}✗ New user-visible English was typed straight into JSX.${RESET}`
    )
    console.error(`${DIM}  Move it into src/lib/i18n/locales/en.json, translate it into all 8 locales,${RESET}`)
    console.error(`${DIM}  and render it with t("your.key"). See the "i18n" skill for the full recipe.${RESET}`)
    process.exit(1)
  }

  if (fixed.length) {
    console.log(`${YELLOW}${fixed.length} file(s) now have FEWER than the baseline — lower them:${RESET}`)
    for (const [f, n] of fixed) console.log(`  ${DIM}-${RESET} ${f}: ${counts[f] ?? 0} (baseline ${n})`)
    console.log(`${DIM}  node scripts/check-i18n-hardcoded.mjs --write${RESET}\n`)
  }
  console.log(`${GREEN}${BOLD}✓ no new hardcoded English.${RESET}`)
}

main()
