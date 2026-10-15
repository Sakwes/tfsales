-- DEVELOPMENT ONLY. Explicit grants replace Supabase template defaults.
DO $$ BEGIN
  IF current_setting('sellnova.dev_project_ref', true) IS DISTINCT FROM 'qfcnaceeppgrquoszkor' THEN
    RAISE EXCEPTION 'Development runner context required';
  END IF;
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid,_role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT auth.uid() IS NOT NULL
    AND (_user_id=auth.uid() OR EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role='admin'))
    AND EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role);
$$;
-- Explicit anonymous EXECUTE is needed by public policies; anonymous role queries
-- return false. PUBLIC inheritance is removed below.
CREATE OR REPLACE FUNCTION public.sellnova_effective_plan(_store_id uuid)
RETURNS public.plans LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE p public.plans;
BEGIN
  IF EXISTS(SELECT 1 FROM public.stores WHERE id=_store_id
    AND (is_active OR seller_id=auth.uid() OR public.has_role(auth.uid(),'admin'))) THEN
    SELECT pl.* INTO p FROM public.store_subscriptions ss JOIN public.plans pl ON pl.id=ss.plan_id
      WHERE ss.store_id=_store_id AND ss.status='active' AND pl.is_active
      AND (ss.expires_at IS NULL OR ss.expires_at>now());
  END IF;
  IF p.id IS NULL THEN SELECT * INTO p FROM public.plans WHERE code='free' AND is_active; END IF;
  RETURN p;
END $$;

DO $$ DECLARE t text; f record; BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','user_roles','stores','products','store_visitors','product_views',
    'plans','platform_settings','store_subscriptions','subscription_requests','admin_audit_log',
    'promotions','orders','order_items','reviews','store_branding'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role',t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  END LOOP;
  FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND (left(p.proname,9)='sellnova_' OR p.proname IN
      ('has_role','handle_new_user','get_store_product_count','update_updated_at_column')) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
  END LOOP;
END $$;
GRANT SELECT ON public.profiles,public.user_roles TO authenticated;
GRANT UPDATE(phone) ON public.profiles TO authenticated;
GRANT SELECT ON public.stores,public.products,public.plans TO anon,authenticated;
GRANT INSERT,UPDATE,DELETE ON public.stores,public.products,public.plans TO authenticated;
GRANT SELECT ON public.store_visitors,public.product_views TO authenticated;
GRANT INSERT(store_id) ON public.store_visitors TO anon,authenticated;
GRANT INSERT(product_id,store_id) ON public.product_views TO anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.platform_settings TO authenticated;
GRANT SELECT ON public.store_subscriptions,public.subscription_requests,public.admin_audit_log TO authenticated;
GRANT INSERT(store_id,plan_id,amount,payment_reference,proof_path,status) ON public.subscription_requests TO authenticated;
GRANT SELECT ON public.orders,public.order_items TO authenticated;
GRANT UPDATE(status,delivery_fee) ON public.orders TO authenticated;
GRANT SELECT ON public.promotions,public.reviews,public.store_branding TO anon,authenticated;
GRANT INSERT(store_id,name,discount_type,value,scope,product_id,coupon_code,starts_at,ends_at,usage_limit,min_order,is_active)
  ON public.promotions TO authenticated;
GRANT UPDATE(store_id,name,discount_type,value,scope,product_id,coupon_code,starts_at,ends_at,usage_limit,min_order,is_active)
  ON public.promotions TO authenticated;
GRANT DELETE ON public.promotions TO authenticated;
GRANT UPDATE(seller_response,status) ON public.reviews TO authenticated;
GRANT INSERT,UPDATE,DELETE ON public.store_branding TO authenticated;

GRANT EXECUTE ON FUNCTION public.has_role(uuid,public.app_role),public.sellnova_effective_plan(uuid),
 public.sellnova_store_max_products(uuid),public.sellnova_public_branding(uuid),
 public.sellnova_review_context(text),public.sellnova_submit_review(text,integer,text),
 public.sellnova_create_order(uuid,text,text,text,text,jsonb,text,uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sellnova_decide_subscription(uuid,boolean,text,integer),
 public.sellnova_set_subscription_state(uuid,text,integer,text) TO authenticated;
-- discount_for, triggers, and private helpers deliberately have no direct client EXECUTE.

DROP POLICY "Anyone can read store subscription state" ON public.store_subscriptions;
CREATE POLICY "Owners read subscription state" ON public.store_subscriptions FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.stores WHERE id=store_id AND seller_id=auth.uid())
  OR public.has_role(auth.uid(),'admin'));
DROP POLICY "Branding is public" ON public.store_branding;
CREATE POLICY "Branding is public" ON public.store_branding FOR SELECT
USING (EXISTS(SELECT 1 FROM public.stores s WHERE s.id=store_id AND
  (s.seller_id=auth.uid() OR (s.is_active AND (public.sellnova_effective_plan(s.id)).allow_branding)))
  OR public.has_role(auth.uid(),'admin'));
DROP POLICY "Anyone can view live automatic promotions" ON public.promotions;
CREATE POLICY "Anyone can view live automatic promotions" ON public.promotions FOR SELECT
USING ((is_active AND coupon_code IS NULL AND (starts_at IS NULL OR starts_at<=now())
  AND (ends_at IS NULL OR ends_at>now()) AND EXISTS(SELECT 1 FROM public.stores s
    WHERE s.id=store_id AND s.is_active AND (public.sellnova_effective_plan(s.id)).allow_discounts))
  OR EXISTS(SELECT 1 FROM public.stores WHERE id=store_id AND seller_id=auth.uid())
  OR public.has_role(auth.uid(),'admin'));
DROP POLICY "Approved reviews are public" ON public.reviews;
CREATE POLICY "Approved reviews are public" ON public.reviews FOR SELECT
USING ((status='approved' AND EXISTS(SELECT 1 FROM public.stores s WHERE s.id=store_id
  AND s.is_active AND (public.sellnova_effective_plan(s.id)).allow_reviews))
  OR EXISTS(SELECT 1 FROM public.stores WHERE id=store_id AND seller_id=auth.uid())
  OR public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.sellnova_visits_rate_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.stores WHERE id=NEW.store_id AND is_active) THEN
    RAISE EXCEPTION 'Store unavailable'; END IF;
  PERFORM sellnova_dev.consume_rate('visit',NEW.store_id::text,30);
  NEW.visited_at:=now(); NEW.ip_address:=NULL; NEW.user_agent:=NULL;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.sellnova_product_views_rate_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.products p JOIN public.stores s ON s.id=p.store_id
    WHERE p.id=NEW.product_id AND p.store_id=NEW.store_id AND s.is_active) THEN
    RAISE EXCEPTION 'Product unavailable'; END IF;
  PERFORM sellnova_dev.consume_rate('product-view',NEW.product_id::text,20);
  NEW.viewed_at:=now(); NEW.ip_address:=NULL; NEW.user_agent:=NULL;
  RETURN NEW;
END $$;

CREATE FUNCTION public.sellnova_subscription_request_validate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE p public.plans;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.stores WHERE id=NEW.store_id AND seller_id=auth.uid()) THEN
    RAISE EXCEPTION 'Store ownership required'; END IF;
  SELECT * INTO p FROM public.plans WHERE id=NEW.plan_id AND code='paid' AND is_active AND price_ngn>0 FOR SHARE;
  IF NOT FOUND OR NEW.amount IS DISTINCT FROM p.price_ngn THEN RAISE EXCEPTION 'Invalid plan or amount'; END IF;
  IF NEW.payment_reference IS NULL OR length(btrim(NEW.payment_reference)) NOT BETWEEN 3 AND 100
    OR (NEW.proof_path IS NOT NULL AND (length(NEW.proof_path)>400 OR NEW.proof_path LIKE '%..%' OR split_part(NEW.proof_path,'/',1)<>auth.uid()::text)) THEN
    RAISE EXCEPTION 'Invalid payment reference or proof path'; END IF;
  IF NEW.status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'Pending status required'; END IF;
  NEW.status:='pending'; NEW.reviewed_by:=NULL; NEW.reviewed_at:=NULL;
  NEW.duration_days:=NULL; NEW.decision_reason:=NULL;
  RETURN NEW;
END $$;
CREATE TRIGGER sellnova_subscription_request_validate BEFORE INSERT ON public.subscription_requests
FOR EACH ROW EXECUTE FUNCTION public.sellnova_subscription_request_validate();
REVOKE ALL ON FUNCTION public.sellnova_subscription_request_validate() FROM PUBLIC,anon,authenticated;

-- Public branding must not expose inactive-store data through its definer route.
CREATE OR REPLACE FUNCTION public.sellnova_public_branding(_store_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE b public.store_branding;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.stores WHERE id=_store_id AND is_active)
     OR NOT coalesce((public.sellnova_effective_plan(_store_id)).allow_branding,false) THEN
    RETURN jsonb_build_object('entitled',false); END IF;
  SELECT * INTO b FROM public.store_branding WHERE store_id=_store_id;
  RETURN jsonb_build_object('entitled',true,'primary_color',b.primary_color,'accent_color',b.accent_color,
    'background_color',b.background_color,'logo_path',b.logo_path);
END $$;

-- Preserve active indefinite subscriptions and bound admin extensions.
CREATE OR REPLACE FUNCTION public.sellnova_request_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.store_subscriptions (store_id, plan_id, status, updated_at)
  VALUES (NEW.store_id, NEW.plan_id, 'pending', now())
  ON CONFLICT (store_id) DO UPDATE
    SET status = CASE WHEN public.store_subscriptions.status = 'active'
                        AND (public.store_subscriptions.expires_at IS NULL OR public.store_subscriptions.expires_at > now())
                      THEN 'active' ELSE 'pending' END,
        plan_id = CASE WHEN public.store_subscriptions.status = 'active'
                        AND (public.store_subscriptions.expires_at IS NULL OR public.store_subscriptions.expires_at > now())
                      THEN public.store_subscriptions.plan_id ELSE EXCLUDED.plan_id END,
        updated_at = now();
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.sellnova_set_subscription_state(
  _store_id uuid, _status text, _extend_days int DEFAULT NULL, _reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cur record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _extend_days IS NOT NULL AND (_extend_days < 1 OR _extend_days > 3650) THEN RAISE EXCEPTION 'Invalid extension days'; END IF;
  IF _status IS NULL THEN RAISE EXCEPTION 'Status required'; END IF;
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

-- Existing UI sends unchanged store_id on edits; grant that column but forbid moves.
CREATE OR REPLACE FUNCTION public.sellnova_promotions_before_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.store_id IS DISTINCT FROM OLD.store_id THEN RAISE EXCEPTION 'Promotion store is immutable'; END IF;
  NEW.name := trim(NEW.name);
  IF length(NEW.name) < 2 OR length(NEW.name) > 80 THEN
    RAISE EXCEPTION 'Promotion name must be between 2 and 80 characters';
  END IF;

  IF NEW.coupon_code IS NOT NULL THEN
    NEW.coupon_code := upper(regexp_replace(trim(NEW.coupon_code), '[^A-Za-z0-9-]', '', 'g'));
    IF length(NEW.coupon_code) < 3 OR length(NEW.coupon_code) > 24 THEN
      RAISE EXCEPTION 'Coupon code must be between 3 and 24 characters';
    END IF;
  END IF;

  IF NEW.discount_type = 'percent' AND (NEW.value <= 0 OR NEW.value > 90) THEN
    RAISE EXCEPTION 'Percentage discount must be between 1 and 90';
  END IF;
  IF NEW.discount_type = 'fixed' AND NEW.value > 1000000000 THEN
    RAISE EXCEPTION 'Discount amount is too large';
  END IF;

  IF NEW.starts_at IS NOT NULL AND NEW.ends_at IS NOT NULL AND NEW.ends_at <= NEW.starts_at THEN
    RAISE EXCEPTION 'Promotion end date must be after the start date';
  END IF;

  IF NEW.scope = 'product' THEN
    IF NEW.product_id IS NULL THEN
      RAISE EXCEPTION 'Select a product for a product promotion';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = NEW.product_id AND p.store_id = NEW.store_id) THEN
      RAISE EXCEPTION 'That product does not belong to this store';
    END IF;
  ELSE
    NEW.product_id := NULL;
  END IF;

  IF NOT (public.sellnova_effective_plan(NEW.store_id)).allow_discounts THEN
    RAISE EXCEPTION 'Discounts are available on a paid plan';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Internal order cancellation must restore real deductions even above the manual ceiling.
CREATE OR REPLACE FUNCTION public.sellnova_products_before_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  existing_count int;
  limit_count int;
  eff public.plans;
BEGIN
  NEW.name := trim(NEW.name);

  IF length(NEW.name) < 2 OR length(NEW.name) > 120 THEN
    RAISE EXCEPTION 'Product name must be between 2 and 120 characters';
  END IF;

  IF NEW.price IS NULL OR NEW.price <= 0 OR NEW.price > 1000000000 THEN
    RAISE EXCEPTION 'Product price must be greater than 0 and below 1,000,000,000';
  END IF;

  IF coalesce(array_length(NEW.images, 1), 0) > 3 THEN
    RAISE EXCEPTION 'A product can have at most 3 images';
  END IF;

  IF length(coalesce(NEW.description, '')) > 2000 THEN
    RAISE EXCEPTION 'Product description is too long';
  END IF;

  IF NEW.stock_quantity IS NULL OR NEW.stock_quantity < 0 THEN
    RAISE EXCEPTION 'Stock quantity cannot be negative';
  END IF;
  IF NEW.low_stock_threshold IS NULL OR NEW.low_stock_threshold < 0 THEN
    RAISE EXCEPTION 'Low stock threshold cannot be negative';
  END IF;
  IF NEW.low_stock_threshold > 1000000 OR (NEW.stock_quantity > 1000000 AND
      (TG_OP='INSERT' OR (NEW.stock_quantity>OLD.stock_quantity AND NOT
        (current_user='postgres' AND pg_trigger_depth()>1)))) THEN
    RAISE EXCEPTION 'Stock values are too large';
  END IF;

  eff := public.sellnova_effective_plan(NEW.store_id);

  -- Stock tracking is a paid capability. Saved quantities are preserved,
  -- tracking is simply switched off while the store is not entitled.
  IF NEW.track_stock AND NOT coalesce(eff.allow_stock, false) THEN
    IF TG_OP = 'UPDATE' AND OLD.track_stock THEN
      NEW.track_stock := false;
    ELSE
      NEW.track_stock := false;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.store_id IS DISTINCT FROM OLD.store_id THEN
    limit_count := coalesce(eff.max_products, 12);
    SELECT count(*) INTO existing_count FROM public.products WHERE store_id = NEW.store_id;
    IF existing_count >= limit_count THEN
      RAISE EXCEPTION 'Your plan allows a maximum of % products', limit_count;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
