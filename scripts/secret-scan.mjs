#!/usr/bin/env node
// Secret scanner — the first stop in the pre-commit gate and a CI job.
//
//   node scripts/secret-scan.mjs            scan the STAGED diff (pre-commit)
//   node scripts/secret-scan.mjs --all      scan the working tree (CI)
//
// Curated, high-confidence patterns only (prefix + minimum body length), so
// placeholders like `whsec_...` in docs never trip it. Suppress a known-safe
// line with `secret-scan:ignore` in a trailing comment.
// Uses gitleaks instead when it's installed locally (better coverage).
// All child-process calls use execFileSync with FIXED argument lists — no
// shell, no interpolation.

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

/** [name, regex] — each must identify a REAL credential, not a placeholder. */
export const SECRET_PATTERNS = [
  ["Clerk/Stripe-style live secret key", /\bsk_live_[A-Za-z0-9]{16,}/],
  ["Clerk/Stripe-style test secret key", /\bsk_test_[A-Za-z0-9]{16,}/],
  ["Webhook signing secret", /\bwhsec_[A-Za-z0-9+/=]{16,}/],
  ["Connection string with credentials", /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@'"<>]{2,}:[^\s:@'"<>]{6,}@/i],
  ["Private key block", /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/],
  ["AWS access key id", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{36,}\b/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ["OpenAI/Anthropic API key", /\bsk-(?:proj|ant)-[A-Za-z0-9_-]{20,}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["JWT (looks real, 3 segments)", /\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/],
]

const IGNORE_MARK = "secret-scan:ignore"
// Generated/vendored files where matches are noise, not leaks.
const SKIP_PATHS = [/^package-lock\.json$/, /^\.playwright-mcp\//, /^playwright-report\//, /^test-results\//, /^e2e\/\.auth\//]

/** Pure: scan one line; returns the matched pattern name or null. */
export function matchSecret(line) {
  if (line.includes(IGNORE_MARK)) return null
  for (const [name, re] of SECRET_PATTERNS) {
    if (re.test(line)) return name
  }
  return null
}

function scanContent(path, content, findings) {
  if (SKIP_PATHS.some((re) => re.test(path))) return
  const lines = content.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const hit = matchSecret(lines[i])
    if (hit) findings.push({ path, line: i + 1, name: hit })
  }
}

function git(args, opts = {}) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts })
}

const looksBinary = (content) => content.includes("\u0000")

function main() {
  const all = process.argv.includes("--all")

  // Prefer gitleaks when available (pre-commit only; CI pins our scanner so
  // results are reproducible without external installs).
  if (!all) {
    let hasGitleaks = false
    try {
      execFileSync("gitleaks", ["version"], { stdio: "ignore" })
      hasGitleaks = true
    } catch {
      /* not installed → use the built-in scanner */
    }
    if (hasGitleaks) {
      try {
        execFileSync("gitleaks", ["protect", "--staged", "--redact", "-v"], { stdio: "inherit" })
        return
      } catch {
        process.exit(1) // gitleaks found something
      }
    }
  }

  const findings = []
  if (all) {
    const files = git(["ls-files"]).split("\n").filter(Boolean)
    for (const f of files) {
      let content
      try {
        content = readFileSync(f, "utf8")
      } catch {
        continue // unreadable
      }
      if (looksBinary(content)) continue
      scanContent(f, content, findings)
    }
  } else {
    const staged = git(["diff", "--cached", "--name-only", "--diff-filter=ACM"]).split("\n").filter(Boolean)
    for (const f of staged) {
      let content
      try {
        content = git(["show", ":" + f])
      } catch {
        continue
      }
      if (looksBinary(content)) continue
      scanContent(f, content, findings)
    }
  }

  if (findings.length > 0) {
    console.error("✗ possible secrets detected — commit blocked:\n")
    for (const f of findings) console.error(`  ${f.path}:${f.line}  →  ${f.name}`)
    console.error(`\nIf a line is a known-safe example, add a trailing "${IGNORE_MARK}" comment.`)
    process.exit(1)
  }
  console.log(`✓ secret scan clean (${all ? "full tree" : "staged diff"})`)
}

// Only run as a CLI (vitest imports the pure pieces above).
if (import.meta.url === `file://${process.argv[1]}`) main()
