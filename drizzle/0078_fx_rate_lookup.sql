-- One rate lookup that cannot pick a stale or worse rate (replaces 0074's
-- fx_rate_on; same signatures, so every caller keeps working).
--
--   fx_rate_on(from, to, on_date)  -> the rate of the NEWEST observation dated
--     within the 10 calendar days up to on_date, whichever way round the pair
--     was stored (an inverse row is inverted). On the same day: a manual rate
--     beats a market one, a real observation beats a carried-forward weekend
--     fill (is_fallback), the STRONG side (stored rate >= 1, inverted) beats
--     the weak one, then the direct pair, then the newest fetch. Nothing in
--     that window -> NULL ("excluded", never a guess).
--
-- Why each rule:
--   * MC-098: 0074 read the inverse pair only when NO direct row existed at any
--     earlier date, so a 16-day-old EUR->INR placeholder (110.77) beat the real
--     INR->EUR observation of the same day (1/0.00919 = 108.81).
--   * MC-099: 0074 had no age limit — an AED row was converted at a 21-day-old
--     rate with no flag. A rate may be carried over a weekend or a holiday run,
--     at most 10 days; older is no rate. A stored carried-forward fill
--     (is_fallback) is dated on the day it FILLS, not on the day of the rate it
--     carries, so it counts only on its own day: carrying is the window's job,
--     over real observations. Otherwise a fill (itself up to 10 days after its
--     observation) would be carried 10 more and a 20-day-old rate would pass.
--     A future-dated row (a bill logged ahead) has no rate on its own date;
--     the floor is taken from the earlier of on_date and today, so it gets
--     the newest rate of the last 10 days — as 0074 did — instead of NULL.
--   * Precision: an old fetcher stored the weak side as the provider rounded
--     it (INR->USD 0.01048, IDR->USD 0.000056 = 2 significant digits); the
--     inverse of the strong side of the same day (USD->INR 95.11) is exact to
--     the provider's own digits, so it is preferred whichever way was asked.
--   * MC-167: Postgres never inlines a scalar SQL function that reads a table
--     (inline_function rejects sub-selects), so fx_rate_on stays one call per
--     foreign row. The lookup is one statement over a bounded range of
--     fx_rate_snapshots_pair_date_idx (both directions are index ranges, ≤ 11
--     days each for a row dated up to today). Measured on the dev DB (PG17)
--     the per-call cost is the SQL function executor itself (~15–25 µs, same
--     as 0074), not the lookup; the
--     real fix is a per-(currency, date) join at the aggregate call sites.
--     reporting_amount() has no sub-select and IS inlined (EXPLAIN VERBOSE
--     shows its CASE). Both are PARALLEL SAFE (they only read), so an
--     aggregate that calls them may still use a parallel plan — 0074's default
--     PARALLEL UNSAFE forced every such query serial.
--
-- reporting_amount() is unchanged in meaning, including MC-123: a NULL
-- currency is taken as already in the target currency (rows from before
-- currency tagging; on the dev DB only deleted orgs still have any).
CREATE OR REPLACE FUNCTION fx_rate_on(p_from text, p_to text, p_on date) RETURNS numeric
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN p_from = p_to THEN 1::numeric ELSE (
    SELECT c.rate FROM (
      SELECT s.rate, s.rate AS stored, s.rate_date, s.source_type, s.is_fallback, s.fetched_at, true AS direct
        FROM fx_rate_snapshots s
       WHERE s.base_currency = p_from AND s.quote_currency = p_to
         AND s.rate_date BETWEEN least(p_on, current_date) - 10 AND p_on
         AND (NOT s.is_fallback OR s.rate_date = p_on)
      UNION ALL
      SELECT 1 / s.rate, s.rate, s.rate_date, s.source_type, s.is_fallback, s.fetched_at, false
        FROM fx_rate_snapshots s
       WHERE s.base_currency = p_to AND s.quote_currency = p_from
         AND s.rate_date BETWEEN least(p_on, current_date) - 10 AND p_on
         AND (NOT s.is_fallback OR s.rate_date = p_on)
    ) c
    ORDER BY c.rate_date DESC, (c.source_type = 'manual') DESC, c.is_fallback ASC, (c.stored >= 1) DESC, c.direct DESC, c.fetched_at DESC
    LIMIT 1
  ) END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reporting_amount(p_amount numeric, p_from text, p_on date, p_to text) RETURNS numeric
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN p_amount
    ELSE round(p_amount * fx_rate_on(p_from, p_to, p_on), 2)
  END
$$;
