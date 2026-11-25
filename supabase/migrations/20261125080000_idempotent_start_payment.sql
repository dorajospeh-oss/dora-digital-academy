-- Make connected checkout idempotent per order.
-- The order row is locked before an attempt is created/reused, so parallel
-- browser requests cannot create parallel pending payment records for one order.
CREATE OR REPLACE FUNCTION public.start_payment(
  p_order_id uuid,
  p_provider text,
  p_payment_method text
)
RETURNS public.payments
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_order public.orders;
  v_payment public.payments;
  v_provider text := lower(coalesce(p_provider, ''));
  v_method text := lower(coalesce(p_payment_method, ''));
  v_ref text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  IF v_provider NOT IN ('orange_money', 'airtel_money', 'moov_money') THEN
    RAISE EXCEPTION 'Prestataire PayCentral non supporté';
  END IF;

  IF v_method <> v_provider THEN
    RAISE EXCEPTION 'Moyen de paiement incohérent';
  END IF;

  -- Serializes payment-attempt creation for this order.
  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
    AND user_id = v_user
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Commande introuvable';
  END IF;

  IF v_order.status NOT IN ('pending', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'Commande non payable';
  END IF;

  -- A failed/cancelled attempt may be retried with a new payment reference.
  IF v_order.status IN ('failed', 'cancelled') THEN
    UPDATE public.orders
    SET status = 'pending',
        updated_at = now()
    WHERE id = v_order.id;
  END IF;

  -- Reuse the active attempt. An already-started gateway request must not
  -- silently switch operator while its result is still unknown.
  SELECT *
  INTO v_payment
  FROM public.payments
  WHERE order_id = v_order.id
    AND status = 'pending'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF coalesce(v_payment.provider_response, '{}'::jsonb) ? 'transaction_id' THEN
      IF v_payment.provider <> v_provider THEN
        RAISE EXCEPTION 'Un paiement est déjà en cours avec un autre opérateur';
      END IF;
      RETURN v_payment;
    END IF;

    -- Legacy start_payment rows had no provider response and never reached
    -- PayCentral, so their operator can safely be updated before initiation.
    IF v_payment.provider_response IS NULL AND v_payment.provider <> v_provider THEN
      UPDATE public.payments
      SET provider = v_provider,
          payment_method = v_method,
          user_id = v_user,
          amount = v_order.total_amount,
          currency = v_order.currency,
          updated_at = now()
      WHERE id = v_payment.id
      RETURNING * INTO v_payment;
    ELSIF v_payment.provider <> v_provider THEN
      RAISE EXCEPTION 'Un paiement est déjà en cours avec un autre opérateur';
    END IF;

    RETURN v_payment;
  END IF;

  v_ref := 'DDA-PAY-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));

  INSERT INTO public.payments (
    order_id,
    user_id,
    provider,
    payment_method,
    transaction_reference,
    amount,
    currency,
    status
  )
  VALUES (
    v_order.id,
    v_user,
    v_provider,
    v_method,
    v_ref,
    v_order.total_amount,
    v_order.currency,
    'pending'
  )
  RETURNING * INTO v_payment;

  RETURN v_payment;
END;
$function$;

REVOKE ALL ON FUNCTION public.start_payment(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_payment(uuid, text, text) TO authenticated;
