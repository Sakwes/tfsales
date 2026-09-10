-- Public checkout, review submission and subscription decision helpers

CREATE OR REPLACE FUNCTION public.sellnova_discount_for(
  _store_id uuid, _subtotal numeric, _coupon text, _items jsonb
) RETURNS TABLE (promotion_id uuid, discount numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  promo record;
  best_id uuid := NULL;
  best_amount numeric := 0;
  base numeric;
  amount numeric;
  coupon_clean text := upper(nullif(trim(coalesce(_coupon, '')), ''));
BEGIN
  IF NOT (public.sellnova_effective_plan(_store_id)).allow_discounts THEN
    RETURN QUERY SELECT NULL::uuid, 0::numeric; RETURN;
  END IF;

  FOR promo IN
    SELECT * FROM public.promotions p
    WHERE p.store_id = _store_id
      AND p.is_active
      AND (p.starts_at IS NULL OR p.starts_at <= now())
      AND (p.ends_at IS NULL OR p.ends_at > now())
      AND (p.usage_limit IS NULL OR p.used_count < p.usage_limit)
      AND p.min_order <= _subtotal
      -- exactly one rule applies: a valid coupon when supplied, otherwise automatic promotions
      AND ((coupon_clean IS NOT NULL AND upper(p.coupon_code) = coupon_clean)
        OR (coupon_clean IS NULL AND p.coupon_code IS NULL))
  LOOP
    IF promo.scope = 'product' THEN
      SELECT COALESCE(sum((i->>'line_total')::numeric), 0) INTO base
      FROM jsonb_array_elements(_items) i
      WHERE (i->>'product_id')::uuid = promo.product_id;
    ELSE
      base := _subtotal;
    END IF;

    IF base > 0 THEN
      amount := CASE WHEN promo.discount_type = 'percent'
        THEN round(base * promo.value / 100.0, 2)
        ELSE LEAST(promo.value, base) END;
      IF amount > best_amount THEN
        best_amount := amount;
        best_id := promo.id;
      END IF;
    END IF;
  END LOOP;

  RETURN QUERY SELECT best_id, LEAST(best_amount, _subtotal);
END;
$$;

REVOKE ALL ON FUNCTION public.sellnova_discount_for(uuid, numeric, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sellnova_discount_for(uuid, numeric, text, jsonb) TO anon, authenticated, service_role;

-- ---------- Public checkout ----------
CREATE OR REPLACE FUNCTION public.sellnova_create_order(
  _store_id uuid,
  _customer_name text,
  _customer_phone text,
  _delivery_address text,
  _customer_note text,
  _items jsonb,
  _coupon text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  it jsonb;
  prod record;
  qty int;
  priced jsonb := '[]'::jsonb;
  subtotal numeric := 0;
  disc_id uuid;
  disc numeric := 0;
  ref text;
  new_id uuid;
  recent int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = _store_id AND is_active) THEN
    RAISE EXCEPTION 'This store is not available';
  END IF;

  IF length(trim(coalesce(_customer_name,''))) < 2 THEN RAISE EXCEPTION 'Please enter your full name'; END IF;
  IF length(public.sellnova_normalize_phone(coalesce(_customer_phone,''))) < 10 THEN
    RAISE EXCEPTION 'Please enter a valid WhatsApp number';
  END IF;
  IF length(trim(coalesce(_delivery_address,''))) < 5 THEN RAISE EXCEPTION 'Please enter a delivery address'; END IF;
  IF length(coalesce(_customer_note,'')) > 500 THEN RAISE EXCEPTION 'Note is too long'; END IF;
  IF jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Your cart is empty';
  END IF;
  IF jsonb_array_length(_items) > 50 THEN RAISE EXCEPTION 'Too many items in one order'; END IF;

  SELECT count(*) INTO recent FROM public.orders
    WHERE store_id = _store_id AND created_at > now() - interval '1 minute';
  IF recent >= 10 THEN RAISE EXCEPTION 'Too many orders just now, please try again shortly'; END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    qty := GREATEST(COALESCE((it->>'quantity')::int, 0), 0);
    IF qty = 0 THEN CONTINUE; END IF;
    IF qty > 999 THEN RAISE EXCEPTION 'Quantity is too large'; END IF;

    SELECT * INTO prod FROM public.products
      WHERE id = (it->>'product_id')::uuid AND store_id = _store_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'One of the items is no longer available'; END IF;
    IF NOT prod.is_available THEN RAISE EXCEPTION '% is currently unavailable', prod.name; END IF;
    IF prod.track_stock AND prod.stock_quantity < qty THEN
      RAISE EXCEPTION 'Only % left of %', prod.stock_quantity, prod.name;
    END IF;

    subtotal := subtotal + (prod.price * qty);
    priced := priced || jsonb_build_object(
      'product_id', prod.id, 'product_name', prod.name,
      'unit_price', prod.price, 'quantity', qty,
      'line_total', prod.price * qty);
  END LOOP;

  IF jsonb_array_length(priced) = 0 THEN RAISE EXCEPTION 'Your cart is empty'; END IF;

  SELECT d.promotion_id, d.discount INTO disc_id, disc
    FROM public.sellnova_discount_for(_store_id, subtotal, _coupon, priced) d;
  disc := COALESCE(disc, 0);

  ref := 'SN-' || upper(encode(extensions.gen_random_bytes(5), 'hex'));

  INSERT INTO public.orders (
    store_id, order_reference, customer_name, customer_phone, delivery_address,
    customer_note, subtotal, discount_total, delivery_fee, total, promotion_id, coupon_code
  ) VALUES (
    _store_id, ref, trim(_customer_name), public.sellnova_normalize_phone(_customer_phone),
    trim(_delivery_address), nullif(trim(coalesce(_customer_note,'')), ''),
    subtotal, disc, 0, GREATEST(subtotal - disc, 0), disc_id,
    CASE WHEN disc_id IS NOT NULL THEN nullif(upper(trim(coalesce(_coupon,''))), '') END
  ) RETURNING id INTO new_id;

  INSERT INTO public.order_items (order_id, product_id, product_name, unit_price, quantity, line_total)
  SELECT new_id, (i->>'product_id')::uuid, i->>'product_name',
         (i->>'unit_price')::numeric, (i->>'quantity')::int, (i->>'line_total')::numeric
  FROM jsonb_array_elements(priced) i;

  IF disc_id IS NOT NULL THEN
    UPDATE public.promotions SET used_count = used_count + 1 WHERE id = disc_id;
  END IF;

  RETURN jsonb_build_object(
    'order_reference', ref,
    'subtotal', subtotal,
    'discount_total', disc,
    'total', GREATEST(subtotal - disc, 0),
    'items', priced
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sellnova_create_order(uuid, text, text, text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sellnova_create_order(uuid, text, text, text, text, jsonb, text) TO anon, authenticated, service_role;

-- ---------- Review by single-use token ----------
CREATE OR REPLACE FUNCTION public.sellnova_review_context(_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE o record; st record;
BEGIN
  IF length(coalesce(_token,'')) < 20 THEN RETURN jsonb_build_object('valid', false); END IF;
  SELECT * INTO o FROM public.orders WHERE review_token = _token AND status = 'completed';
  IF NOT FOUND OR o.review_submitted THEN RETURN jsonb_build_object('valid', false); END IF;
  SELECT store_name, slug INTO st FROM public.stores WHERE id = o.store_id;
  RETURN jsonb_build_object('valid', true, 'store_name', st.store_name,
    'store_slug', st.slug, 'order_reference', o.order_reference);
END;
$$;

REVOKE ALL ON FUNCTION public.sellnova_review_context(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sellnova_review_context(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sellnova_submit_review(_token text, _rating int, _comment text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o record;
BEGIN
  IF _rating IS NULL OR _rating < 1 OR _rating > 5 THEN RAISE EXCEPTION 'Please choose a rating from 1 to 5'; END IF;
  IF length(coalesce(_comment,'')) > 1000 THEN RAISE EXCEPTION 'Your review is too long'; END IF;

  SELECT * INTO o FROM public.orders
    WHERE review_token = _token AND status = 'completed' FOR UPDATE;
  IF NOT FOUND OR o.review_submitted THEN RAISE EXCEPTION 'This review link is no longer valid'; END IF;

  INSERT INTO public.reviews (store_id, order_id, rating, comment, customer_name, status)
  VALUES (o.store_id, o.id, _rating, nullif(trim(coalesce(_comment,'')), ''), o.customer_name, 'pending');

  UPDATE public.orders SET review_submitted = true, review_token = NULL WHERE id = o.id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.sellnova_submit_review(text, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sellnova_submit_review(text, int, text) TO anon, authenticated, service_role;

-- ---------- Admin subscription decisions ----------
CREATE OR REPLACE FUNCTION public.sellnova_decide_subscription(
  _request_id uuid, _approve boolean, _reason text DEFAULT NULL, _duration_days int DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; pl record; days int; ends timestamptz;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not allowed'; END IF;

  SELECT * INTO r FROM public.subscription_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'This request has already been reviewed'; END IF;

  SELECT * INTO pl FROM public.plans WHERE id = r.plan_id;
  days := COALESCE(_duration_days, pl.duration_days);
  IF days < 1 OR days > 3650 THEN RAISE EXCEPTION 'Duration must be between 1 and 3650 days'; END IF;

  IF _approve THEN
    ends := now() + make_interval(days => days);
    INSERT INTO public.store_subscriptions (store_id, plan_id, status, started_at, expires_at, updated_at)
    VALUES (r.store_id, r.plan_id, 'active', now(), ends, now())
    ON CONFLICT (store_id) DO UPDATE
      SET plan_id = EXCLUDED.plan_id, status = 'active',
          started_at = now(), expires_at = ends, updated_at = now();
    UPDATE public.subscription_requests
      SET status = 'approved', duration_days = days, reviewed_by = auth.uid(),
          reviewed_at = now(), decision_reason = _reason
      WHERE id = _request_id;
  ELSE
    UPDATE public.subscription_requests
      SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
          decision_reason = COALESCE(_reason, 'No reason provided')
      WHERE id = _request_id;
    UPDATE public.store_subscriptions SET status = 'rejected', updated_at = now()
      WHERE store_id = r.store_id AND status = 'pending';
  END IF;

  INSERT INTO public.admin_audit_log (actor_id, store_id, action, details)
  VALUES (auth.uid(), r.store_id,
    CASE WHEN _approve THEN 'subscription.approved' ELSE 'subscription.rejected' END,
    jsonb_build_object('request_id', _request_id, 'plan', pl.code,
      'days', days, 'reason', _reason));

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.sellnova_decide_subscription(uuid, boolean, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sellnova_decide_subscription(uuid, boolean, text, int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sellnova_set_subscription_state(
  _store_id uuid, _status text, _extend_days int DEFAULT NULL, _reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cur record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _status NOT IN ('active','suspended','expired','free') THEN RAISE EXCEPTION 'Unknown status'; END IF;

  SELECT * INTO cur FROM public.store_subscriptions WHERE store_id = _store_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This store has no paid subscription record'; END IF;

  UPDATE public.store_subscriptions
    SET status = _status,
        expires_at = CASE
          WHEN _extend_days IS NOT NULL
            THEN GREATEST(COALESCE(expires_at, now()), now()) + make_interval(days => _extend_days)
          ELSE expires_at END,
        updated_at = now()
    WHERE store_id = _store_id;

  INSERT INTO public.admin_audit_log (actor_id, store_id, action, details)
  VALUES (auth.uid(), _store_id, 'subscription.' || _status,
    jsonb_build_object('extend_days', _extend_days, 'reason', _reason));

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.sellnova_set_subscription_state(uuid, text, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sellnova_set_subscription_state(uuid, text, int, text) TO authenticated, service_role;

-- keep a pending marker when a seller submits a payment
CREATE OR REPLACE FUNCTION public.sellnova_request_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.store_subscriptions (store_id, plan_id, status, updated_at)
  VALUES (NEW.store_id, NEW.plan_id, 'pending', now())
  ON CONFLICT (store_id) DO UPDATE
    SET status = CASE WHEN public.store_subscriptions.status = 'active'
                        AND public.store_subscriptions.expires_at > now()
                      THEN 'active' ELSE 'pending' END,
        plan_id = CASE WHEN public.store_subscriptions.status = 'active'
                        AND public.store_subscriptions.expires_at > now()
                      THEN public.store_subscriptions.plan_id ELSE EXCLUDED.plan_id END,
        updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sellnova_request_after_insert ON public.subscription_requests;
CREATE TRIGGER sellnova_request_after_insert AFTER INSERT ON public.subscription_requests
  FOR EACH ROW EXECUTE FUNCTION public.sellnova_request_after_insert();
