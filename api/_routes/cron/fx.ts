// Daily FX refresh (MC-104, MC-039): today's rate and the missing history for
// every currency pair some workspace converts, OFF the request path. Report
// requests only top up their last REQUEST_FILL_DAYS (api/_lib/fx-rates.ts);
// everything older lands here.
//
// Authenticated by the shared service token, like /api/cron/notifications. The
// Go worker's `fx-refresh` schedule drives it daily (worker/Makefile `register`);
// .github/workflows/fx-refresh.yml is the fallback, and /admin → Worker →
// Exchange rates can run it on demand. Idempotent: every write is an upsert, so
// two drivers at once only repeat work.
//
// Bounded: one call works for at most FX_REFRESH_BUDGET_MS (the worker's HTTP
// client gives up at 30 s) and reports `remaining` — pairs still filling — so a
// caller may simply call again.
//
// Relative imports keep the `.js` extension (unbundled ESM on @vercel/node).
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { eq, sql } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { notificationSchedulerState } from "../../../src/lib/db/schema.js"
import { requireServiceToken } from "../../_lib/auth.js"
import { addDays, todayUtc } from "../../../src/lib/budget.js"
import { REQUEST_FILL_DAYS, currentRate, ensureHistoricalRates, fxPairsInUseSql, fxProviderHealth } from "../../_lib/fx-rates.js"

const BUDGET_MS = Number(process.env.FX_REFRESH_BUDGET_MS) || 15_000
const CONCURRENCY = 4
/**
 * No pair or fill starts with less budget left than this (the request path's
 * archive wait): one started a moment before the deadline gets no archive
 * answer at all, and would read as a pair no provider serves.
 */
const MIN_STEP_MS = 3000
/** The ECB series starts here; no provider serves an earlier day, so asking for one only repeats a miss. */
const FIRST_RATE_DAY = "1999-01-04"
/**
 * The refresh heartbeat shares the scheduler-state table with the notification
 * tick (which reads only id 'default'), so no migration is needed: on this row
 * last_tick_at = the last refresh, last_reminders = pairs in use,
 * last_broadcasts = pairs left incomplete by it.
 */
export const FX_STATE_ID = "fx"

export type FxRefreshResult = { pairs: number; complete: number; incomplete: number; remaining: number; previousRefreshAt: string | null }

export async function runFxRefresh(budgetMs = BUDGET_MS): Promise<FxRefreshResult> {
  const startedAt = new Date()
  const deadline = startedAt.getTime() + budgetMs

  let previousRefreshAt: string | null = null
  try {
    const [state] = await db.select().from(notificationSchedulerState).where(eq(notificationSchedulerState.id, FX_STATE_ID))
    previousRefreshAt = state?.lastTickAt ? state.lastTickAt.toISOString() : null
  } catch {
    /* observability only — never fail the refresh */
  }

  const { rows } = await db.execute(sql`select base, quote, first_date::text as first_date from (${fxPairsInUseSql()}) p order by 1, 2`)
  const pairs = rows as Array<{ base: string; quote: string; first_date: string }>

  const hasTime = () => deadline - Date.now() >= MIN_STEP_MS
  const inLanes = async (step: (p: (typeof pairs)[number], first: string) => Promise<void>) => {
    let next = 0
    const lane = async () => {
      while (next < pairs.length) {
        const p = pairs[next++]
        const first = String(p.first_date).slice(0, 10)
        await step(p, first < FIRST_RATE_DAY ? FIRST_RATE_DAY : first)
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, lane))
  }

  // Pass 1, EVERY pair: today's rate and the window report requests top up
  // themselves (the same bounded fill). Done first so a few deep backfills
  // cannot hold the lanes all budget long while later pairs get nothing.
  const recentFrom = addDays(todayUtc(), -REQUEST_FILL_DAYS)
  await inLanes(async (p, first) => {
    if (!hasTime()) return
    await Promise.all([
      currentRate(p.base, p.quote).catch(() => null),
      ensureHistoricalRates(p.base, p.quote, first < recentFrom ? recentFrom : first).catch(() => null),
    ])
  })

  // Pass 2: the rest of the history, back to the first day each pair is needed.
  let complete = 0
  let incomplete = 0
  let remaining = 0
  await inLanes(async (p, from) => {
    // The daily archive is read a bounded batch per call (as in
    // scripts/fx-backfill.ts): keep calling while calls still fill days.
    let r: { covered: boolean; written?: number } = { covered: false, written: 1 }
    while (!r.covered && (r.written ?? 0) > 0 && hasTime()) {
      r = await ensureHistoricalRates(p.base, p.quote, from, { floor: from, deadline }).catch(() => ({ covered: false }))
    }
    if (r.covered) complete++
    // Still filling, never started, or cut off by the deadline: a caller may call again.
    else if ((r.written ?? 0) > 0 || Date.now() >= deadline) remaining++
    else incomplete++ // no provider serves the rest (yet): those rows stay excluded
  })

  try {
    const values = { lastTickAt: startedAt, lastReminders: pairs.length, lastBroadcasts: incomplete + remaining, updatedAt: new Date() }
    await db
      .insert(notificationSchedulerState)
      .values({ id: FX_STATE_ID, ...values })
      .onConflictDoUpdate({ target: notificationSchedulerState.id, set: values })
  } catch (err) {
    console.error("[cron/fx] heartbeat write failed", err)
  }

  return { pairs: pairs.length, complete, incomplete, remaining, previousRefreshAt }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!requireServiceToken(req, res)) return
  try {
    const { previousRefreshAt, ...processed } = await runFxRefresh()
    return res.json({
      ok: true,
      processed,
      previous_refresh_at: previousRefreshAt,
      previous_refresh_age_seconds: previousRefreshAt ? Math.round((Date.now() - new Date(previousRefreshAt).getTime()) / 1000) : null,
      providers: fxProviderHealth().providers,
    })
  } catch (err) {
    console.error("[cron/fx] refresh failed", err)
    return res.status(500).json({ error: "Refresh failed" })
  }
}
