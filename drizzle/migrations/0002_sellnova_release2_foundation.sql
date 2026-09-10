-- =========================================================
-- SellNova Release 2 — additive foundation
-- Plans, subscriptions, stock, orders, promotions, reviews, branding
-- =========================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ---------- Plans ----------
CREATE TABLE IF NOT EXISTS public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  price_ngn numeric NOT NULL DEFAULT 0 CHECK (price_ngn >= 0),
  duration_days integer NOT NULL DEFAULT 30 CHECK (duration_days > 0),
  max_products integer NOT NULL DEFAULT 12 CHECK (max_products > 0),
  allow_stock boolean NOT NULL DEFAULT false,
  allow_discounts boolean NOT NULL DEFAULT false,
  allow_reviews boolean NOT NULL DEFAULT false,
  allow_branding boolean NOT NULL DEFAULT false,
  allow_advanced_orders boolean NOT NULL DEFAULT false,
  is_core boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.plans TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.plans TO authenticated;
GRANT ALL ON public.plans TO service_role;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view active plans" ON public.plans;
CREATE POLICY "Anyone can view active plans" ON public.plans
  FOR SELECT USING (is_active = true OR public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Admins manage plans" ON public.plans;
CREATE POLICY "Admins manage plans" ON public.plans
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- core plans can never be deleted or deactivated
CREATE OR REPLACE FUNCTION public.sellnova_protect_core_plans()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_core THEN
      RAISE EXCEPTION 'Core plans cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.is_core THEN
    NEW.code := OLD.code;
    NEW.is_core := true;
    NEW.is_active := true;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sellnova_protect_core_plans_upd ON public.plans;
CREATE TRIGGER sellnova_protect_core_plans_upd BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.sellnova_protect_core_plans();
DROP TRIGGER IF EXISTS sellnova_protect_core_plans_del ON public.plans;
CREATE TRIGGER sellnova_protect_core_plans_del BEFORE DELETE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.sellnova_protect_core_plans();

-- ---------- Platform settings (bank details) ----------
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  bank_name text,
  account_name text,
  account_number text,
  payment_instructions text,
  support_email text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.platform_settings TO authenticated;
GRANT INSERT, UPDATE ON public.platform_settings TO authenticated;
GRANT ALL ON public.platform_settings TO service_role;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Signed-in users can view payment settings" ON public.platform_settings;
CREATE POLICY "Signed-in users can view payment settings" ON public.platform_settings
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins manage settings" ON public.platform_settings;
CREATE POLICY "Admins manage settings" ON public.platform_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ---------- Store subscriptions ----------
CREATE TABLE IF NOT EXISTS public.store_subscriptions (
  store_id uuid PRIMARY KEY REFERENCES public.stores(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plans(id),
  status text NOT NULL DEFAULT 'free'
    CHECK (status IN ('free','pending','active','rejected','expired','suspended')),
  started_at timestamptz,
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.store_subscriptions TO anon, authenticated;
GRANT INSERT, UPDATE ON public.store_subscriptions TO authenticated;
GRANT ALL ON public.store_subscriptions TO service_role;
ALTER TABLE public.store_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read store subscription state" ON public.store_subscriptions;
CREATE POLICY "Anyone can read store subscription state" ON public.store_subscriptions
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admins manage subscriptions" ON public.store_subscriptions;
CREATE POLICY "Admins manage subscriptions" ON public.store_subscriptions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ---------- Subscription payment requests ----------
CREATE TABLE IF NOT EXISTS public.subscription_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plans(id),
  amount numeric NOT NULL DEFAULT 0 CHECK (amount >= 0),
  payment_reference text NOT NULL,
  proof_path text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  decision_reason text,
  duration_days integer,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.subscription_requests TO authenticated;
GRANT UPDATE ON public.subscription_requests TO authenticated;
GRANT ALL ON public.subscription_requests TO service_role;
ALTER TABLE public.subscription_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Sellers view their own requests" ON public.subscription_requests;
CREATE POLICY "Sellers view their own requests" ON public.subscription_requests
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.seller_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );
DROP POLICY IF EXISTS "Sellers create their own requests" ON public.subscription_requests;
CREATE POLICY "Sellers create their own requests" ON public.subscription_requests
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.seller_id = auth.uid())
    AND status = 'pending'
  );
DROP POLICY IF EXISTS "Admins manage requests" ON public.subscription_requests;
CREATE POLICY "Admins manage requests" ON public.subscription_requests
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS subscription_requests_store_idx ON public.subscription_requests(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS subscription_requests_status_idx ON public.subscription_requests(status, created_at DESC);

-- ---------- Admin audit ----------
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  store_id uuid,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.admin_audit_log TO authenticated;
GRANT ALL ON public.admin_audit_log TO service_role;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read audit log" ON public.admin_audit_log;
CREATE POLICY "Admins read audit log" ON public.admin_audit_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Admins write audit log" ON public.admin_audit_log;
CREATE POLICY "Admins write audit log" ON public.admin_audit_log
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') AND actor_id = auth.uid());

CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON public.admin_audit_log(created_at DESC);

-- ---------- Effective plan helpers ----------
CREATE OR REPLACE FUNCTION public.sellnova_effective_plan(_store_id uuid)
RETURNS public.plans
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.plans;
BEGIN
  SELECT pl.* INTO p
  FROM public.store_subscriptions ss
  JOIN public.plans pl ON pl.id = ss.plan_id
  WHERE ss.store_id = _store_id
    AND ss.status = 'active'
    AND (ss.expires_at IS NULL OR ss.expires_at > now());

  IF p.id IS NULL THEN
    SELECT * INTO p FROM public.plans WHERE code = 'free' LIMIT 1;
  END IF;

  RETURN p;
END;
$$;

REVOKE ALL ON FUNCTION public.sellnova_effective_plan(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sellnova_effective_plan(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sellnova_store_max_products(_store_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((public.sellnova_effective_plan(_store_id)).max_products, 12);
$$;

REVOKE ALL ON FUNCTION public.sellnova_store_max_products(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sellnova_store_max_products(uuid) TO anon, authenticated, service_role;

-- ---------- Products: stock and availability ----------
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS track_stock boolean NOT NULL DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stock_quantity integer NOT NULL DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS low_stock_threshold integer NOT NULL DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_available boolean NOT NULL DEFAULT true;

-- plan-aware product limit replaces the fixed 12
CREATE OR REPLACE FUNCTION public.sellnova_products_before_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  existing_count int;
  limit_count int;
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

  IF NEW.stock_quantity < 0 THEN
    RAISE EXCEPTION 'Stock quantity cannot be negative';
  END IF;
  IF NEW.low_stock_threshold < 0 THEN
    RAISE EXCEPTION 'Low stock threshold cannot be negative';
  END IF;

  IF TG_OP = 'INSERT' OR NEW.store_id IS DISTINCT FROM OLD.store_id THEN
    limit_count := public.sellnova_store_max_products(NEW.store_id);
    SELECT count(*) INTO existing_count FROM public.products WHERE store_id = NEW.store_id;
    IF existing_count >= limit_count THEN
      RAISE EXCEPTION 'Your plan allows a maximum of % products', limit_count;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------- Promotions ----------
CREATE TABLE IF NOT EXISTS public.promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name text NOT NULL,
  discount_type text NOT NULL CHECK (discount_type IN ('percent','fixed')),
  value numeric NOT NULL CHECK (value > 0),
  scope text NOT NULL DEFAULT 'store' CHECK (scope IN ('store','product')),
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  coupon_code text,
  starts_at timestamptz,
  ends_at timestamptz,
  usage_limit integer CHECK (usage_limit IS NULL OR usage_limit > 0),
  used_count integer NOT NULL DEFAULT 0,
  min_order numeric NOT NULL DEFAULT 0 CHECK (min_order >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS promotions_store_coupon_idx
  ON public.promotions(store_id, lower(coupon_code)) WHERE coupon_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS promotions_store_idx ON public.promotions(store_id);

GRANT SELECT ON public.promotions TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.promotions TO authenticated;
GRANT ALL ON public.promotions TO service_role;
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view live automatic promotions" ON public.promotions;
CREATE POLICY "Anyone can view live automatic promotions" ON public.promotions
  FOR SELECT USING (
    (is_active = true
      AND coupon_code IS NULL
      AND (starts_at IS NULL OR starts_at <= now())
      AND (ends_at IS NULL OR ends_at > now()))
    OR EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.seller_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );
DROP POLICY IF EXISTS "Sellers manage their promotions" ON public.promotions;
CREATE POLICY "Sellers manage their promotions" ON public.promotions
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.seller_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.seller_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE OR REPLACE FUNCTION public.sellnova_promotions_before_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
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

DROP TRIGGER IF EXISTS sellnova_promotions_before_write ON public.promotions;
CREATE TRIGGER sellnova_promotions_before_write BEFORE INSERT OR UPDATE ON public.promotions
  FOR EACH ROW EXECUTE FUNCTION public.sellnova_promotions_before_write();

-- ---------- Orders ----------
CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  order_reference text NOT NULL UNIQUE,
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  delivery_address text NOT NULL,
  customer_note text,
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','confirmed','processing','ready','completed','cancelled')),
  subtotal numeric NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_total numeric NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  delivery_fee numeric NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  total numeric NOT NULL DEFAULT 0 CHECK (total >= 0),
  promotion_id uuid REFERENCES public.promotions(id) ON DELETE SET NULL,
  coupon_code text,
  stock_applied boolean NOT NULL DEFAULT false,
  review_token text,
  review_submitted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_store_idx ON public.orders(store_id, created_at DESC);

GRANT SELECT, UPDATE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Sellers view their store orders" ON public.orders;
CREATE POLICY "Sellers view their store orders" ON public.orders
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.seller_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );
DROP POLICY IF EXISTS "Sellers update their store orders" ON public.orders;
CREATE POLICY "Sellers update their store orders" ON public.orders
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.seller_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.seller_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE TABLE IF NOT EXISTS public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  unit_price numeric NOT NULL CHECK (unit_price >= 0),
  quantity integer NOT NULL CHECK (quantity > 0),
  line_total numeric NOT NULL CHECK (line_total >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_items_order_idx ON public.order_items(order_id);

GRANT SELECT ON public.order_items TO authenticated;
GRANT ALL ON public.order_items TO service_role;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Sellers view their order items" ON public.order_items;
CREATE POLICY "Sellers view their order items" ON public.order_items
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.stores s ON s.id = o.store_id
      WHERE o.id = order_id AND (s.seller_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );

-- order status transitions + stock movement
CREATE OR REPLACE FUNCTION public.sellnova_orders_before_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  allowed text[];
  item record;
  available int;
BEGIN
  NEW.order_reference := OLD.order_reference;
  NEW.store_id := OLD.store_id;
  NEW.subtotal := OLD.subtotal;
  NEW.discount_total := OLD.discount_total;
  NEW.review_token := OLD.review_token;

  IF NEW.delivery_fee < 0 OR NEW.delivery_fee > 1000000000 THEN
    RAISE EXCEPTION 'Delivery fee is not valid';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    allowed := CASE OLD.status
      WHEN 'new' THEN ARRAY['confirmed','cancelled']
      WHEN 'confirmed' THEN ARRAY['processing','cancelled']
      WHEN 'processing' THEN ARRAY['ready','cancelled']
      WHEN 'ready' THEN ARRAY['completed','cancelled']
      ELSE ARRAY[]::text[]
    END;
    IF NOT (NEW.status = ANY (allowed)) THEN
      RAISE EXCEPTION 'Cannot move an order from % to %', OLD.status, NEW.status;
    END IF;

    -- decrement stock once, when the order is accepted
    IF NEW.status = 'confirmed' AND NOT OLD.stock_applied THEN
      FOR item IN
        SELECT oi.product_id, oi.quantity, oi.product_name
        FROM public.order_items oi WHERE oi.order_id = NEW.id AND oi.product_id IS NOT NULL
      LOOP
        SELECT stock_quantity INTO available FROM public.products
          WHERE id = item.product_id AND track_stock = true FOR UPDATE;
        IF FOUND THEN
          IF available < item.quantity THEN
            RAISE EXCEPTION 'Not enough stock for %', item.product_name;
          END IF;
          UPDATE public.products SET stock_quantity = stock_quantity - item.quantity
            WHERE id = item.product_id;
        END IF;
      END LOOP;
      NEW.stock_applied := true;
    END IF;

    -- restore stock once, if an accepted order is cancelled
    IF NEW.status = 'cancelled' AND OLD.stock_applied THEN
      FOR item IN
        SELECT oi.product_id, oi.quantity FROM public.order_items oi
        WHERE oi.order_id = NEW.id AND oi.product_id IS NOT NULL
      LOOP
        UPDATE public.products SET stock_quantity = stock_quantity + item.quantity
          WHERE id = item.product_id AND track_stock = true;
      END LOOP;
      NEW.stock_applied := false;
    END IF;

    -- single-use review token on completion
    IF NEW.status = 'completed' AND NEW.review_token IS NULL THEN
      NEW.review_token := encode(extensions.gen_random_bytes(24), 'hex');
    END IF;
  END IF;

  NEW.total := GREATEST(NEW.subtotal - NEW.discount_total, 0) + NEW.delivery_fee;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sellnova_orders_before_update ON public.orders;
CREATE TRIGGER sellnova_orders_before_update BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.sellnova_orders_before_update();

-- ---------- Reviews ----------
CREATE TABLE IF NOT EXISTS public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  customer_name text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','hidden')),
  seller_response text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reviews_store_idx ON public.reviews(store_id, created_at DESC);

GRANT SELECT ON public.reviews TO anon, authenticated;
GRANT UPDATE ON public.reviews TO authenticated;
GRANT ALL ON public.reviews TO service_role;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Approved reviews are public" ON public.reviews;
CREATE POLICY "Approved reviews are public" ON public.reviews
  FOR SELECT USING (
    status = 'approved'
    OR EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.seller_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );
DROP POLICY IF EXISTS "Sellers and admins update reviews" ON public.reviews;
CREATE POLICY "Sellers and admins update reviews" ON public.reviews
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.seller_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.seller_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

-- sellers may only respond; rating/comment are immutable, moderation is admin-only
CREATE OR REPLACE FUNCTION public.sellnova_reviews_before_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.rating := OLD.rating;
  NEW.comment := OLD.comment;
  NEW.order_id := OLD.order_id;
  NEW.store_id := OLD.store_id;
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    NEW.status := OLD.status;
  END IF;
  IF NEW.seller_response IS NOT NULL AND length(NEW.seller_response) > 1000 THEN
    RAISE EXCEPTION 'Response is too long';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sellnova_reviews_before_update ON public.reviews;
CREATE TRIGGER sellnova_reviews_before_update BEFORE UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.sellnova_reviews_before_update();

-- ---------- Storefront branding ----------
CREATE TABLE IF NOT EXISTS public.store_branding (
  store_id uuid PRIMARY KEY REFERENCES public.stores(id) ON DELETE CASCADE,
  primary_color text,
  accent_color text,
  background_color text,
  logo_path text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.store_branding TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.store_branding TO authenticated;
GRANT ALL ON public.store_branding TO service_role;
ALTER TABLE public.store_branding ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Branding is public" ON public.store_branding;
CREATE POLICY "Branding is public" ON public.store_branding FOR SELECT USING (true);
DROP POLICY IF EXISTS "Sellers manage their branding" ON public.store_branding;
CREATE POLICY "Sellers manage their branding" ON public.store_branding
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.seller_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.seller_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE OR REPLACE FUNCTION public.sellnova_branding_before_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.primary_color IS NOT NULL AND NEW.primary_color !~ '^#[0-9A-Fa-f]{6}$' THEN
    RAISE EXCEPTION 'Primary colour must be a hex value like #060318';
  END IF;
  IF NEW.accent_color IS NOT NULL AND NEW.accent_color !~ '^#[0-9A-Fa-f]{6}$' THEN
    RAISE EXCEPTION 'Accent colour must be a hex value like #C8940B';
  END IF;
  IF NEW.background_color IS NOT NULL AND NEW.background_color !~ '^#[0-9A-Fa-f]{6}$' THEN
    RAISE EXCEPTION 'Background colour must be a hex value';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sellnova_branding_before_write ON public.store_branding;
CREATE TRIGGER sellnova_branding_before_write BEFORE INSERT OR UPDATE ON public.store_branding
  FOR EACH ROW EXECUTE FUNCTION public.sellnova_branding_before_write();
