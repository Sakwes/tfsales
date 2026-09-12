-- Plan-aware stock entitlement + branding entitlement (additive, no data loss)

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
  IF NEW.stock_quantity > 1000000 OR NEW.low_stock_threshold > 1000000 THEN
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

CREATE OR REPLACE FUNCTION public.sellnova_branding_before_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  eff public.plans;
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
  IF NEW.logo_path IS NOT NULL AND length(NEW.logo_path) > 400 THEN
    RAISE EXCEPTION 'Logo path is too long';
  END IF;

  eff := public.sellnova_effective_plan(NEW.store_id);
  IF NOT coalesce(eff.allow_branding, false) AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Store design is available on a paid plan';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Public storefront branding: returns saved branding only while entitled.
CREATE OR REPLACE FUNCTION public.sellnova_public_branding(_store_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  eff public.plans;
  b public.store_branding;
BEGIN
  eff := public.sellnova_effective_plan(_store_id);
  IF NOT coalesce(eff.allow_branding, false) THEN
    RETURN jsonb_build_object('entitled', false);
  END IF;

  SELECT * INTO b FROM public.store_branding WHERE store_id = _store_id;
  IF b.store_id IS NULL THEN
    RETURN jsonb_build_object('entitled', true);
  END IF;

  RETURN jsonb_build_object(
    'entitled', true,
    'primary_color', b.primary_color,
    'accent_color', b.accent_color,
    'background_color', b.background_color,
    'logo_path', b.logo_path
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sellnova_public_branding(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sellnova_public_branding(uuid) TO anon, authenticated, service_role;
