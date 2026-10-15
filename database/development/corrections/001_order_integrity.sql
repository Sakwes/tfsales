-- DEVELOPMENT ONLY. Requires the guarded runner, never apply to production.
DO $$ BEGIN
  IF current_setting('sellnova.dev_project_ref', true) IS DISTINCT FROM 'qfcnaceeppgrquoszkor' THEN
    RAISE EXCEPTION 'Development runner context required';
  END IF;
END $$;

ALTER TABLE public.order_items ADD COLUMN deducted_quantity integer NOT NULL DEFAULT 0
  CHECK (deducted_quantity >= 0 AND deducted_quantity <= quantity);

-- Snapshot receipt contains no buyer PII. An unguessable request UUID plus matching
-- normalized payload is required for replay; raw phone/address are not stored here.
CREATE TABLE sellnova_dev.checkout_requests (
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  payload_hash text NOT NULL,
  receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, request_id)
);
ALTER TABLE sellnova_dev.checkout_requests ENABLE ROW LEVEL SECURITY;
CREATE TABLE sellnova_dev.rate_windows (
  scope text NOT NULL,
  subject text NOT NULL,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL CHECK (hits > 0),
  PRIMARY KEY (scope, subject, window_start)
);
ALTER TABLE sellnova_dev.rate_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA sellnova_dev FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION sellnova_dev.consume_rate(_scope text, _subject text, _limit integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE accepted integer;
BEGIN
  INSERT INTO sellnova_dev.rate_windows(scope,subject,window_start,hits)
  VALUES (_scope,_subject,date_trunc('minute',clock_timestamp()),1)
  ON CONFLICT (scope,subject,window_start) DO UPDATE
    SET hits=sellnova_dev.rate_windows.hits+1
    WHERE sellnova_dev.rate_windows.hits < _limit
  RETURNING hits INTO accepted;
  IF accepted IS NULL THEN RAISE EXCEPTION 'Too many requests; try again shortly'; END IF;
END $$;
REVOKE ALL ON FUNCTION sellnova_dev.consume_rate(text,text,integer) FROM PUBLIC,anon,authenticated,service_role;

-- Private transactional audit: status and inventory events never commit separately.
CREATE TABLE sellnova_dev.order_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  from_status text NOT NULL, to_status text NOT NULL, actor_id uuid,
  stock_movements jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sellnova_dev.order_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sellnova_dev.order_events FROM PUBLIC,anon,authenticated,service_role;

-- Caller can only update status/delivery_fee after the ACL correction. This
-- definer trigger performs stock changes with a fixed path and invariant checks.
CREATE OR REPLACE FUNCTION public.sellnova_orders_before_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE allowed text[]; item record; product public.products; movements jsonb := '[]';
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status','delivery_fee','total','updated_at','review_token','review_submitted','stock_applied','promotion_id'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','delivery_fee','total','updated_at','review_token','review_submitted','stock_applied','promotion_id']) THEN
    RAISE EXCEPTION 'Order details are immutable';
  END IF;
  -- Permit FK ON DELETE SET NULL; clients have no UPDATE grant on promotion_id.
  IF NEW.promotion_id IS DISTINCT FROM OLD.promotion_id AND NEW.promotion_id IS NOT NULL THEN
    RAISE EXCEPTION 'Promotion reference is immutable';
  END IF;
  IF NEW.stock_applied IS DISTINCT FROM OLD.stock_applied THEN
    RAISE EXCEPTION 'Stock state is server controlled';
  END IF;
  IF NEW.review_submitted IS DISTINCT FROM OLD.review_submitted THEN
    -- Only the definer review RPC has UPDATE privilege on these columns.
    IF OLD.status <> 'completed' OR OLD.review_submitted OR NOT NEW.review_submitted
       OR NEW.review_token IS NOT NULL THEN RAISE EXCEPTION 'Invalid review transition'; END IF;
  ELSIF NEW.review_token IS DISTINCT FROM OLD.review_token THEN
    RAISE EXCEPTION 'Review token is server controlled';
  END IF;
  IF NEW.delivery_fee IS NULL OR NEW.delivery_fee < 0 OR NEW.delivery_fee > 1000000000
     OR NEW.delivery_fee::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'Invalid delivery fee';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    allowed := CASE OLD.status
      WHEN 'new' THEN ARRAY['confirmed','cancelled']
      WHEN 'confirmed' THEN ARRAY['processing','cancelled']
      WHEN 'processing' THEN ARRAY['ready','cancelled']
      WHEN 'ready' THEN ARRAY['completed','cancelled'] ELSE ARRAY[]::text[] END;
    IF NEW.status IS NULL OR NOT (NEW.status=ANY(allowed)) THEN RAISE EXCEPTION 'Invalid order status transition'; END IF;
    IF NEW.status='confirmed' THEN
      PERFORM pg_advisory_xact_lock(hashtextextended(OLD.store_id::text,921));
      IF OLD.stock_applied THEN RAISE EXCEPTION 'Stock was already applied'; END IF;
      IF EXISTS(SELECT 1 FROM public.order_items WHERE order_id=OLD.id AND product_id IS NULL)
         OR NOT EXISTS(SELECT 1 FROM public.order_items WHERE order_id=OLD.id) THEN
        RAISE EXCEPTION 'An ordered product no longer exists; cancel this order';
      END IF;
      FOR item IN SELECT product_id,sum(quantity)::integer AS qty
        FROM public.order_items WHERE order_id=OLD.id GROUP BY product_id ORDER BY product_id LOOP
        SELECT * INTO product FROM public.products WHERE id=item.product_id AND store_id=OLD.store_id FOR UPDATE;
        IF NOT FOUND OR NOT product.is_available THEN RAISE EXCEPTION 'An ordered product is unavailable'; END IF;
        IF product.track_stock THEN
          IF product.stock_quantity<item.qty THEN
            RAISE EXCEPTION 'Insufficient stock for %. Need %, available %',product.name,item.qty,product.stock_quantity;
          END IF;
          UPDATE public.products SET stock_quantity=stock_quantity-item.qty WHERE id=product.id;
          UPDATE public.order_items SET deducted_quantity=quantity WHERE order_id=OLD.id AND product_id=product.id;
          movements := movements || jsonb_build_array(jsonb_build_object('product_id',product.id,'quantity',-item.qty));
        END IF;
      END LOOP;
      NEW.stock_applied := jsonb_array_length(movements)>0;
    END IF;
    IF NEW.status='cancelled' AND OLD.stock_applied THEN
      PERFORM pg_advisory_xact_lock(hashtextextended(OLD.store_id::text,921));
      FOR item IN SELECT product_id,sum(deducted_quantity)::integer AS deducted
        FROM public.order_items WHERE order_id=OLD.id AND product_id IS NOT NULL
        GROUP BY product_id ORDER BY product_id LOOP
        IF item.deducted=0 THEN CONTINUE; END IF;
        -- Restore the actual deduction regardless of current tracking/entitlement.
        PERFORM 1 FROM public.products WHERE id=item.product_id FOR UPDATE;
        IF FOUND THEN
          UPDATE public.products SET stock_quantity=stock_quantity+item.deducted WHERE id=item.product_id;
          movements := movements || jsonb_build_array(jsonb_build_object('product_id',item.product_id,'quantity',item.deducted));
        END IF;
      END LOOP;
      NEW.stock_applied := false;
    END IF;
    INSERT INTO sellnova_dev.order_events(order_id,from_status,to_status,actor_id,stock_movements)
      VALUES(OLD.id,OLD.status,NEW.status,auth.uid(),movements);
    IF NEW.status='completed' THEN
      NEW.review_token := encode(extensions.gen_random_bytes(24),'hex');
    END IF;
  END IF;
  NEW.total := greatest(OLD.subtotal-OLD.discount_total,0)+NEW.delivery_fee;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Keep private inventory and checkout ledgers out of API/table grants.
REVOKE ALL ON FUNCTION public.sellnova_orders_before_update() FROM PUBLIC,anon,authenticated;
