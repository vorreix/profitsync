#!/usr/bin/env node
// PostToolUse hook: keep the cache policy honest at the moment it is broken,
// not twenty minutes later at the commit gate.
//
// It runs scripts/check-cache-map.mjs after an edit that could invalidate the
// map — a new API route, a new write call, or the policy tables themselves —
// and exits 2 so the failure is handed straight back to the agent to fix.
//
// Two failures it is specifically here to catch, because neither shows up as a
// broken test or a red screen:
//   • a GET route that starts materialising money but isn't in ALWAYS_FETCH —
//     the server-side work silently stops running once a cached body is fresh
//     enough to paint;
//   • a write path with no fanout rule — correct, but it purges the whole cache
//     on an unrelated write, which is the lag this system exists to remove.

import { execFileSync } from "node:child_process"

const RELEVANT = [
  /^api\/_routes\//, // a route may have gained a side effect or a new write path
  /^src\/lib\/api\.ts$/,
  /^src\/lib\/api-cache\.ts$/,
  /^src\/hooks\/use-api-query\.ts$/,
]
/** A source edit only matters here if it writes through the API client. */
const WRITE_CALL = /\bapi(?:Post|Patch|Put|Delete)\s*[<(]/

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
const relevant = RELEVANT.some((re) => re.test(rel)) || (/^src\/.*\.tsx?$/.test(rel) && WRITE_CALL.test(edited))
if (!relevant) process.exit(0)

try {
  execFileSync("node", ["scripts/check-cache-map.mjs"], { encoding: "utf8", stdio: "pipe" })
} catch (err) {
  const out = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim()
  console.error(
    `Cache policy map is out of date after editing ${rel}:\n\n${out}\n\n` +
      `Fix src/lib/api-cache.ts before continuing — see the data-fetching-and-cache skill.\n` +
      `A write path with no rule purges the entire cache; a money-materialising GET that is\n` +
      `not in ALWAYS_FETCH stops running autopay and recurring transactions.`,
  )
  process.exit(2) // blocking: hand it back to the agent now
}
process.exit(0)
