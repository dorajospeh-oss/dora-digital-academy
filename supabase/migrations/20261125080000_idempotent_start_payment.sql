-- Stable request key for guest checkout. This lets the browser retry after a network
-- interruption without creating a second order or a second PayCentral transaction.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS checkout_request_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS orders_checkout_request_id_uidx
  ON public.orders (checkout_request_id)
  WHERE checkout_request_id IS NOT NULL;

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

  -- Preserve legacy card values for the currently published frontend until
  -- the coordinated UI release replaces those choices with Mobile Money.
  IF v_provider NOT IN ('orange_money', 'airtel_money', 'moov_money', 'visa', 'mastercard') THEN
    RAISE EXCEPTION 'Prestataire non supporté';
  END IF;

  IF v_method <> v_provider THEN
    RAISE EXCEPTION 'Moyen de paiement incohérent';
  END IF;

  -- Serialize concurrent starts without SELECT FOR UPDATE. The orders table
  -- intentionally has no client UPDATE policy; row locking would therefore
  -- hide the row from this SECURITY INVOKER function under RLS.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_order_id::text, 0));

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
    AND user_id = v_user;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Commande introuvable';
  END IF;

  IF v_order.status NOT IN ('pending', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'Commande non payable';
  END IF;

  -- PayCentral allows a late success for 24 hours after expiry. With the
  -- 60-minute payment expiry used by the Edge Function, keep the same order
  -- closed to a new attempt for 25 hours after a failure/cancellation.
  IF v_order.status IN ('failed', 'cancelled') THEN
    SELECT *
    INTO v_payment
    FROM public.payments
    WHERE order_id = v_order.id
      AND status IN ('failed', 'expired')
    ORDER BY created_at DESC
    LIMIT 1;

    IF FOUND
       AND v_payment.created_at > now() - interval '25 hours'
       AND coalesce(v_payment.provider_response, '{}'::jsonb) ? 'transaction_id' THEN
      RAISE EXCEPTION 'Le paiement précédent peut encore être confirmé. Vérifiez son état avant une nouvelle tentative.';
    END IF;
  END IF;

  SELECT *
  INTO v_payment
  FROM public.payments
  WHERE order_id = v_order.id
    AND status = 'pending'
    AND provider IN ('orange_money', 'airtel_money', 'moov_money', 'visa', 'mastercard')
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    IF v_payment.provider = v_provider THEN
      RETURN v_payment;
    END IF;

    -- The former UI could create a local pending row for Visa/Mastercard,
    -- but those card methods were never sent to PayCentral. Leave that
    -- historical row untouched and create a new Mobile Money attempt.
    IF v_payment.provider NOT IN ('visa', 'mastercard')
       OR v_payment.provider_response IS NOT NULL THEN
      RAISE EXCEPTION 'Un paiement est déjà en cours avec un autre opérateur';
    END IF;
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
