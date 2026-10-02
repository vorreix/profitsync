-- Reporting-currency conversion inside SQL, so every aggregate can convert a
-- ledger row at ITS OWN DATE without a join in each caller.
--
--   fx_rate_on(from, to, on_date)      -> the latest stored rate on or before
--                                        on_date (direct pair first, then the
--                                        inverse); manual snapshots win over
--                                        market ones on the same day, and a
--                                        carried-forward weekend fill loses to
--                                        a real observation. NULL = unknown.
--   reporting_amount(amount, from, on_date, to)
--                                     -> amount when the currencies match (or
--                                        the row predates currency tagging),
--                                        amount x rate rounded to cents, NULL
--                                        when no rate is stored. Callers count
--                                        the NULLs and report them as
--                                        "excluded", never as zero.
-- Both are STABLE SQL functions: the planner inlines them and uses
-- fx_rate_snapshots_pair_date_idx for the lookup.
CREATE OR REPLACE FUNCTION fx_rate_on(p_from text, p_to text, p_on date) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_from = p_to THEN 1::numeric ELSE COALESCE(
    (SELECT s.rate FROM fx_rate_snapshots s
      WHERE s.base_currency = p_from AND s.quote_currency = p_to AND s.rate_date <= p_on
      ORDER BY s.rate_date DESC, (s.source_type = 'manual') DESC, s.is_fallback ASC, s.fetched_at DESC LIMIT 1),
    (SELECT 1 / s.rate FROM fx_rate_snapshots s
      WHERE s.base_currency = p_to AND s.quote_currency = p_from AND s.rate_date <= p_on AND s.rate > 0
      ORDER BY s.rate_date DESC, (s.source_type = 'manual') DESC, s.is_fallback ASC, s.fetched_at DESC LIMIT 1)
  ) END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reporting_amount(p_amount numeric, p_from text, p_on date, p_to text) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN p_amount
    ELSE round(p_amount * fx_rate_on(p_from, p_to, p_on), 2)
  END
$$;
