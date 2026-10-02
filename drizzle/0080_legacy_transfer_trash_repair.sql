-- Legacy transfers that were in Trash before 0071 get a trashed header (MC-116).
--
-- 0071's backfill made a 'completed' header for every unambiguous two-leg
-- group with no deleted_at filter, and 0073 added transfers.deleted_at as NULL
-- with no backfill. So a transfer the user had ALREADY trashed (both legs
-- deleted_at set, balances reversed by the old group delete) came out with a
-- LIVE header over trashed rows. Restoring it from Trash calls
-- set_transfer_trashed(restore => true), which refuses a live header with
-- invalid_transfer_trash_state (409) — the transfer could be purged but never
-- restored.
--
-- Fix: give such a header the trash state its rows already have, stamped with
-- the latest row's deleted_at (when the transfer actually went to Trash).
-- Restore then re-applies the rows' balances once, as for any trashed
-- transfer. Balances are not touched here: the rows' effect was reversed when
-- they were trashed.
--
-- Only WHOLE transfers whose EVERY row is trashed qualify: exactly two legs,
-- fee rows summing to the header's fee (0071 headers carry fee 0 and no fee
-- row). A header missing a leg would restore one side only, and one with a
-- live and a trashed row is one-sided — both need a human and are reported by
-- scripts/audit-balances.mjs, never guessed at. Row-less headers are left to
-- that script's --apply too (they have no deleted_at to copy).
--
-- Re-runnable: a repaired header has deleted_at set and no longer matches.

UPDATE "transfers" h
SET "deleted_at" = r."trashed_at"
FROM (
  SELECT t."transfer_id", max(t."deleted_at") AS "trashed_at",
    coalesce(sum(t."amount") FILTER (WHERE t."kind" <> 'transfer' AND t."type" = 'outgoing'), 0) AS "fee_rows"
  FROM "transactions" t
  WHERE t."transfer_id" IS NOT NULL
  GROUP BY t."transfer_id"
  HAVING bool_and(t."deleted_at" IS NOT NULL)
    AND count(*) FILTER (WHERE t."kind" = 'transfer') = 2
) r
WHERE h."id" = r."transfer_id"
  AND h."status" = 'completed'
  AND h."deleted_at" IS NULL
  AND r."fee_rows" = h."source_fee_amount";
