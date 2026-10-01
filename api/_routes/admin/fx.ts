// FX health for platform admins (MC-127): is the daily refresh running, are
// the providers answering, which pairs in use lack a rate, and which
// workspaces have rows left out of their reports for want of one.
//   GET  /api/admin/fx                       (cap read)
//   POST /api/admin/fx { action: "refresh" } (cap settings) → one bounded runFxRefresh
// The worker's fx-refresh cron is registered with the other schedules
// (api/_lib/worker-schedules.ts, POST /api/admin/worker register-notifications).
//
// Relative imports keep the `.js` extension (unbundled ESM on @vercel/node).
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { eq, sql } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { notificationSchedulerState } from "../../../src/lib/db/schema.js"
import { todayIso } from "../../../src/lib/recurring.js"
import { requireAdminCap } from "../../_lib/admin.js"
import { fxPairsInUseSql, fxProviderHealth } from "../../_lib/fx-rates.js"
import { FX_STATE_ID, runFxRefresh } from "../cron/fx.js"

/** A `timestamp` column as ISO-8601 UTC text (raw execute rows carry no zone, so Node would read them as local time). */
const isoSql = (col: string) => sql.raw(`to_char(${col}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`)

async function health() {
  const today = todayIso()
  const [state, providers, pairs, excluded] = await Promise.all([
    db.select().from(notificationSchedulerState).where(eq(notificationSchedulerState.id, FX_STATE_ID)),
    // Who actually delivered rates, across every instance: the stored rows.
    db.execute(sql`
      select split_part(provider, '+', 1) as provider, ${isoSql("max(fetched_at)")} as last_fetch_at, max(rate_date)::text as latest_rate_date
        from fx_rate_snapshots where not is_fallback and source_type <> 'manual'
       group by 1`),
    // Per pair in use: the newest real observation either way round, the last
    // fetch, and how many of the last 10 days (since it is needed) fx_rate_on
    // — the lookup every report uses — has no rate for.
    db.execute(sql`
      select p.base, p.quote, count(*) over ()::int as total,
             (select max(s.rate_date)::text from fx_rate_snapshots s
               where not s.is_fallback and ((s.base_currency = p.base and s.quote_currency = p.quote) or (s.base_currency = p.quote and s.quote_currency = p.base))) as latest_real_date,
             (select ${isoSql("max(s.fetched_at)")} from fx_rate_snapshots s
               where (s.base_currency = p.base and s.quote_currency = p.quote) or (s.base_currency = p.quote and s.quote_currency = p.base)) as last_fetch_at,
             (select count(*)::int from generate_series(greatest(p.first_date, ${today}::date - 9), ${today}::date, interval '1 day') d
               where fx_rate_on(p.base, p.quote, d::date) is null) as missing_days
        from (${fxPairsInUseSql()}) p
       order by missing_days desc, latest_real_date asc nulls first, p.base, p.quote
       limit 100`),
    // Live rows a report leaves out (no rate on their day), per workspace.
    db.execute(sql`
      select o.id as organization_id, o.name, r.reporting, count(*)::int as excluded, count(*) over ()::int as orgs
        from transactions t
        join clients c on c.id = t.client_id
        join organizations o on o.id = c.organization_id
        cross join lateral (select upper(coalesce(o.reporting_currency, o.currency)) as reporting) r
       where t.deleted_at is null and t.currency_code is not null and t.currency_code <> r.reporting
         and fx_rate_on(t.currency_code, r.reporting, t.date) is null
       group by o.id, o.name, r.reporting
       order by excluded desc
       limit 10`),
  ])

  const instance = fxProviderHealth()
  const dbProviders = providers.rows as Array<{ provider: string; last_fetch_at: string | null; latest_rate_date: string | null }>
  const names = [...new Set([...dbProviders.map((p) => p.provider), ...Object.keys(instance.providers)])].sort()
  const pairRows = pairs.rows as Array<{ base: string; quote: string; total: number; latest_real_date: string | null; last_fetch_at: string | null; missing_days: number }>
  const excludedRows = excluded.rows as Array<{ organization_id: string; name: string; reporting: string; excluded: number; orgs: number }>
  const refresh = state[0]

  return {
    today,
    refresh: refresh ? { last_at: refresh.lastTickAt.toISOString(), pairs: refresh.lastReminders, incomplete: refresh.lastBroadcasts } : null,
    instance_since: instance.since,
    providers: names.map((name) => {
      const stored = dbProviders.find((p) => p.provider === name)
      const live = instance.providers[name]
      return {
        provider: name,
        last_fetch_at: stored?.last_fetch_at ?? null,
        latest_rate_date: stored?.latest_rate_date ?? null,
        ok: live?.ok ?? 0,
        refused: live?.refused ?? 0,
        failed: live?.failed ?? 0,
        last_error: live?.lastError ?? null,
        last_error_at: live?.lastErrorAt ?? null,
      }
    }),
    pairs_total: pairRows[0]?.total ?? 0,
    pairs: pairRows.map(({ total: _total, ...p }) => p),
    orgs_with_excluded: excludedRows[0]?.orgs ?? 0,
    excluded: excludedRows.map(({ orgs: _orgs, ...r }) => r),
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    if (!(await requireAdminCap(req, res, "read"))) return
    try {
      return res.json(await health())
    } catch (err) {
      console.error("[admin/fx] health failed", err)
      return res.status(500).json({ error: "FX health unavailable" })
    }
  }
  if (req.method === "POST") {
    if (!(await requireAdminCap(req, res, "settings"))) return
    const action = (req.body as { action?: string } | undefined)?.action
    if (action !== "refresh") return res.status(400).json({ error: "action must be 'refresh'" })
    try {
      const { previousRefreshAt: _prev, ...processed } = await runFxRefresh()
      return res.json({ ok: true, processed })
    } catch (err) {
      console.error("[admin/fx] refresh failed", err)
      return res.status(500).json({ error: "Refresh failed" })
    }
  }
  return res.status(405).json({ error: "Method not allowed" })
}
