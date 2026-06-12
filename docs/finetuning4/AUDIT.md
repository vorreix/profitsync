# ux4 Deep Audit — findings & dispositions (2026-06-11)

Six audit lenses (authz/tenant-isolation, injection/XSS/SSRF, billing/webhooks,
client cache coherency, DB performance, serverless runtime) ran in parallel over
the final stacked code; **every finding was then adversarially verified by an
independent agent instructed to refute it** against the real code. 36 raw
findings → **13 confirmed**, 23 refuted. Confirmed items were fixed on
`feat/ux4-12-audit-fixes` unless explicitly dispositioned otherwise below.

## Fixed on this branch

| # | Lens | Finding | Fix |
|---|------|---------|-----|
| 1 | authz | `recurring/[id].ts` mutations (PATCH active, PATCH full, DELETE) lacked `organizationId` in their WHERE clauses (the up-front load 404s cross-org ids, so not exploitable today — but every sibling route re-scopes as defense-in-depth) | Re-scoped all three mutations by `(id, organizationId)` |
| 2 | injection | Bank-logo pipeline could persist **SVG** bytes (header-trusted) which round-trip to the DOM as `data:image/svg+xml` URLs. Browsers sandbox SVG-in-`<img>`, so no direct script execution — but SVG is a script-capable format and must not be stored/rendered from third-party fetches | `fetchLogoData` now sniffs the downloaded **bytes** and only persists raster formats; `logoDataUrl` refuses to emit `image/svg+xml` (covers any previously stored SVG) — locked by tests |
| 3 | dbperf | `transactions` had **no indexes** on its hottest predicates: `client_id` (client lists + per-client quota counts), `wealth_account_id` (account ledgers + reversals), `date` (calendar + range filters) — full scans at scale | Migration **0041** adds all three btrees (verified in pg_indexes) |
| 4 | injection | `String(delta)` in the materializer's relative balance UPDATE could pass float noise (`0.30000000000000004`) into the `::numeric` cast | `delta.toFixed(2)` (amounts are 2-decimal by construction) |
| 5 | billing | Webhook signature verification had **no timestamp freshness check** — a captured payload could be replayed indefinitely (idempotent upserts limit damage, but status transitions could be re-triggered) | `verifyWebhookSignature` now rejects timestamps outside ±5 min (Standard Webhooks tolerance); locked by replay/skew/garbage-timestamp tests |
| 6 | injection | Admin billing-attempts search interpolated `%`/`_` wildcards into ILIKE (pathological-scan DoS, not injection — Drizzle parameterizes the value) | Escapes `\ % _` + caps length 100. (Same pattern pre-exists in older admin routes — follow-up, low risk: admin-only surface) |
| 7 | dbperf | Wealth accounts list inlined `logo_src` data URLs up to ~683KB base64 **per account** | `logoDataUrl` caps inline payloads at ~128KB raw; bigger logos fall back to the hotlink URL |
| 8 | serverless | Logo fetch chain on the account create/update path could block ~13.5s (3 candidates × 4.5s timeout) | Download timeout cut to 2.5s per candidate (search autocomplete keeps 4.5s — it's user-facing but non-blocking) |

## Confirmed but intentionally NOT changed (rationale recorded)

| Lens | Finding | Disposition |
|------|---------|-------------|
| billing | "Soft-deleted recurring occurrence blocks re-materialization, leaving the balance 'reversed'" (flagged high) | **Intended semantics.** Deleting a generated payment is an explicit user decision; the unique index makes that deletion final, which *prevents* the genuinely dangerous outcome (a paused/resumed rule silently re-charging a deleted occurrence). The balance invariant holds in every path: it moves exactly once on insert and exactly once on (soft-)delete; restore re-applies via the trash path. |
| billing | Currency retry loop can orphan a PENDING Dodo subscription when an earlier create partially succeeded before erroring | Accepted: orphaned **pending** checkouts never charge and their payment links expire server-side at Dodo (`expires_on`); the DB only ever tracks the successful attempt. A cleanup call would add a failure mode to the money path for cosmetic benefit. |
| serverless | Webhook handler runs ~5–9 sequential queries per event | Accepted at current scale: webhooks arrive one event per request at payment cadence (not bursts); every write is idempotent. Optimization sketch (single CTE upsert) recorded for when volume justifies touching the money path. |
| serverless | 60s in-process auth cache can serve stale org membership after removal | Accepted trade-off, documented: revocation latency is bounded at ≤60s per warm instance; the cache exists to avoid a DB round-trip on every API call. Tightening would trade hot-path latency for marginal revocation speed. |
| serverless | Admin bulk subscription actions call Dodo sequentially | Deliberate (per the billing skill): per-row independence + per-row outcomes + gentle pacing against Dodo. Parallelizing risks rate limits for an admin-only surface. |

## Notable refuted claims (the verification layer working)

- “Dashboard layout localStorage leaks across orgs” — refuted: layouts are stored per **context** (personal/business) by design, selected reactively.
- “Wealth transfers leave stale caches” — refuted: the cache **generation counter** prevents in-flight GETs from repopulating stale entries after `clearApiCache()`.
- “Materializer lacks an indexed short-circuit” — refuted: `recurring_rules_due_idx (org, active, next_due_at)` matches the query predicate order exactly.
- “ensure* writes on GET paths are a scaling problem” — refuted: both are first-access-only lazy initialization with early returns + unique-index race guards.
- “Float `Number()` in balanceDelta loses money precision” — refuted for the input domain (2-decimal amounts ≤ MAX_MONEY are exactly representable); the `toFixed(2)` fix above hardens the SQL boundary anyway.
- “Routing is O(n) over 200+ handlers” — refuted: 86 routes, length-filtered, ~7µs worst case vs 50–100ms DB calls.

Full machine-readable findings + verdict reasoning: workflow run `wf_1770df64-447`.
