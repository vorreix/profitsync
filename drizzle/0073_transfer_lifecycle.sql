-- Transfer lifecycle: one-reversal uniqueness, logical deletion state, and
-- row-locked database functions for atomic completion, legal unsettled
-- transitions and logical trash/restore. Each function is its own chunk —
-- the neon-http migrator sends every a statement-breakpoint marker chunk as ONE
-- query, and the $$ bodies must never be split.
CREATE UNIQUE INDEX IF NOT EXISTS "transfers_one_reversal_idx" ON "transfers" ("reverses_transfer_id") WHERE "reverses_transfer_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION complete_transfer(
  p_transfer_id uuid,
  p_organization_id uuid,
  p_client_id uuid,
  p_actor_user_id text,
  p_out_description text,
  p_in_description text,
  p_out_card_id uuid DEFAULT NULL,
  p_in_card_id uuid DEFAULT NULL
) RETURNS TABLE(out_leg_id uuid, in_leg_id uuid, fee_leg_id uuid)
LANGUAGE plpgsql
AS $$
DECLARE
  tr transfers%ROWTYPE;
  previous_status text;
  source_account wealth_accounts%ROWTYPE;
  destination_account wealth_accounts%ROWTYPE;
BEGIN
  SELECT * INTO tr FROM transfers
  WHERE id = p_transfer_id AND organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND OR tr.status NOT IN ('planned', 'pending') THEN
    RAISE EXCEPTION 'invalid_transfer_transition' USING ERRCODE = 'P0001';
  END IF;
  previous_status := tr.status;

  SELECT * INTO source_account FROM wealth_accounts
  WHERE id = tr.source_account_id AND organization_id = p_organization_id AND archived_at IS NULL;
  SELECT * INTO destination_account FROM wealth_accounts
  WHERE id = tr.destination_account_id AND organization_id = p_organization_id AND archived_at IS NULL;

  IF source_account.id IS NULL OR destination_account.id IS NULL THEN
    RAISE EXCEPTION 'transfer_account_unavailable' USING ERRCODE = 'P0001';
  END IF;
  IF source_account.currency_code IS DISTINCT FROM tr.source_currency
     OR destination_account.currency_code IS DISTINCT FROM tr.destination_currency THEN
    RAISE EXCEPTION 'transfer_account_currency_changed' USING ERRCODE = 'P0001';
  END IF;

  UPDATE transfers
  SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE id = tr.id;

  INSERT INTO transactions (
    client_id, wealth_account_id, card_id, transfer_id, group_id, kind, type,
    amount, currency_code, description, category, date, created_by, updated_by
  ) VALUES (
    p_client_id, tr.source_account_id, p_out_card_id, tr.id, tr.group_id, 'transfer', 'outgoing',
    tr.source_amount, tr.source_currency, p_out_description, 'Transfer', tr.transfer_date, p_actor_user_id, p_actor_user_id
  ) RETURNING id INTO out_leg_id;

  INSERT INTO transactions (
    client_id, wealth_account_id, card_id, transfer_id, group_id, kind, type,
    amount, currency_code, description, category, date, created_by, updated_by
  ) VALUES (
    p_client_id, tr.destination_account_id, p_in_card_id, tr.id, tr.group_id, 'transfer', 'incoming',
    tr.destination_amount, tr.destination_currency, p_in_description, 'Transfer', tr.transfer_date, p_actor_user_id, p_actor_user_id
  ) RETURNING id INTO in_leg_id;

  IF tr.source_fee_amount > 0 THEN
    INSERT INTO transactions (
      client_id, wealth_account_id, transfer_id, kind, type, amount, currency_code,
      description, category, date, created_by, updated_by
    ) VALUES (
      p_client_id, tr.source_account_id, tr.id, 'standard', 'outgoing', tr.source_fee_amount,
      tr.source_currency, 'Transfer fee', 'Transfer Fee', tr.transfer_date, p_actor_user_id, p_actor_user_id
    ) RETURNING id INTO fee_leg_id;
  END IF;

  UPDATE wealth_accounts
  SET current_balance = current_balance - tr.source_amount - tr.source_fee_amount,
      updated_by = p_actor_user_id, updated_at = now()
  WHERE id = tr.source_account_id;
  UPDATE wealth_accounts
  SET current_balance = current_balance + tr.destination_amount,
      updated_by = p_actor_user_id, updated_at = now()
  WHERE id = tr.destination_account_id;

  INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, actor_user_id, changes)
  VALUES
    (p_organization_id, 'transfer', tr.id, 'update', p_actor_user_id, jsonb_build_object('status', jsonb_build_object('from', previous_status, 'to', 'completed'))),
    (p_organization_id, 'transaction', out_leg_id, 'create', p_actor_user_id, '{}'::jsonb),
    (p_organization_id, 'transaction', in_leg_id, 'create', p_actor_user_id, '{}'::jsonb);
  IF fee_leg_id IS NOT NULL THEN
    INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, actor_user_id, changes)
    VALUES (p_organization_id, 'transaction', fee_leg_id, 'create', p_actor_user_id, '{}'::jsonb);
  END IF;

  RETURN NEXT;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_transfer_trashed(
  p_transfer_id uuid,
  p_organization_id uuid,
  p_restore boolean,
  p_actor_user_id text
) RETURNS SETOF transfers
LANGUAGE plpgsql
AS $$
DECLARE
  tr transfers%ROWTYPE;
BEGIN
  SELECT * INTO tr FROM transfers
  WHERE id = p_transfer_id AND organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND OR tr.status <> 'completed' THEN
    RAISE EXCEPTION 'transfer_not_found_or_incomplete' USING ERRCODE = 'P0001';
  END IF;
  IF tr.reverses_transfer_id IS NOT NULL OR EXISTS (SELECT 1 FROM transfers r WHERE r.reverses_transfer_id = tr.id) THEN
    RAISE EXCEPTION 'reversal_linked_transfer_is_immutable' USING ERRCODE = 'P0001';
  END IF;
  IF (p_restore AND tr.deleted_at IS NULL) OR (NOT p_restore AND tr.deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid_transfer_trash_state' USING ERRCODE = 'P0001';
  END IF;

  UPDATE wealth_accounts wa
  SET current_balance = wa.current_balance + effects.shift,
      updated_by = p_actor_user_id, updated_at = now()
  FROM (
    SELECT wealth_account_id,
      sum(CASE
        WHEN p_restore AND type = 'incoming' THEN amount
        WHEN p_restore AND type = 'outgoing' THEN -amount
        WHEN NOT p_restore AND type = 'incoming' THEN -amount
        ELSE amount
      END)::numeric AS shift
    FROM transactions
    WHERE transfer_id = tr.id
      AND ((p_restore AND deleted_at IS NOT NULL) OR (NOT p_restore AND deleted_at IS NULL))
    GROUP BY wealth_account_id
  ) effects
  WHERE wa.id = effects.wealth_account_id;

  UPDATE transactions SET deleted_at = CASE WHEN p_restore THEN NULL ELSE now() END,
    updated_by = p_actor_user_id, updated_at = now()
  WHERE transfer_id = tr.id
    AND ((p_restore AND deleted_at IS NOT NULL) OR (NOT p_restore AND deleted_at IS NULL));
  UPDATE transfers SET deleted_at = CASE WHEN p_restore THEN NULL ELSE now() END, updated_at = now()
  WHERE id = tr.id RETURNING * INTO tr;
  INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, actor_user_id, changes)
  VALUES (p_organization_id, 'transfer', tr.id, CASE WHEN p_restore THEN 'reopen' ELSE 'delete' END, p_actor_user_id, '{}'::jsonb);
  RETURN NEXT tr;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION transition_unsettled_transfer(
  p_transfer_id uuid,
  p_organization_id uuid,
  p_target_status text,
  p_actor_user_id text
) RETURNS SETOF transfers
LANGUAGE plpgsql
AS $$
DECLARE
  tr transfers%ROWTYPE;
  previous_status text;
BEGIN
  SELECT * INTO tr FROM transfers
  WHERE id = p_transfer_id AND organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transfer_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF NOT (
    (tr.status = 'planned' AND p_target_status IN ('pending', 'cancelled')) OR
    (tr.status = 'pending' AND p_target_status = 'cancelled')
  ) THEN
    RAISE EXCEPTION 'invalid_transfer_transition' USING ERRCODE = 'P0001';
  END IF;
  previous_status := tr.status;

  UPDATE transfers SET status = p_target_status, updated_at = now()
  WHERE id = tr.id RETURNING * INTO tr;
  INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, actor_user_id, changes)
  VALUES (p_organization_id, 'transfer', tr.id, 'update', p_actor_user_id,
    jsonb_build_object('status', jsonb_build_object('from', previous_status, 'to', p_target_status)));
  RETURN NEXT tr;
END;
$$;
