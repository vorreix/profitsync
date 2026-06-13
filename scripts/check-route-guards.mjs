#!/usr/bin/env node
// Repo-specific security sweep (CI): every API route handler must authenticate,
// and raw HTML injection stays confined to the vendored shadcn components.
// All child-process calls use execFileSync with FIXED argument lists.
//
//   node scripts/check-route-guards.mjs

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8" })
  } catch {
    return ""
  }
}

// Routes that are public BY DESIGN (review when adding to this list).
const PUBLIC_ROUTES = [
  /^api\/_routes\/public\//, // published blog + public pricing
  /^api\/_routes\/invitations\//, // token-authenticated invitation flow
]

const AUTH_MARKERS = [
  "requireAuth(",
  "requireAdminCap(",
  "getUserId(", // low-level helper (profile/organizations routes)
]

let failures = 0

const routeFiles = git(["ls-files", "api/_routes/**/*.ts"])
  .split("\n")
  .filter((f) => f && !f.endsWith(".test.ts"))

for (const file of routeFiles) {
  if (PUBLIC_ROUTES.some((re) => re.test(file))) continue
  const content = readFileSync(file, "utf8")
  if (!AUTH_MARKERS.some((m) => content.includes(m))) {
    console.error(`✗ ${file} — no auth guard found (requireAuth/requireAdminCap/getUserId)`)
    failures++
  }
}

// Raw HTML injection allowlist: only the vendored shadcn components.
const dsi = git(["grep", "-l", "dangerouslySetInnerHTML", "--", "src/"])
  .split("\n")
  .filter(Boolean)
for (const file of dsi) {
  if (!file.startsWith("src/components/ui/")) {
    console.error(`✗ ${file} — dangerouslySetInnerHTML outside the vendored ui/ components`)
    failures++
  }
}

if (failures > 0) {
  console.error(`\n${failures} security guard violation(s).`)
  process.exit(1)
}
console.log(`✓ route guards OK (${routeFiles.length} handlers checked) · raw-HTML confined to ui/`)
