-- 1. Slug support (additive, backfilled)
CREATE OR REPLACE FUNCTION public.sellnova_slugify(_input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT trim(both '-' from regexp_replace(regexp_replace(lower(coalesce(_input,'')), '[^a-z0-9]+', '-', 'g'), '-{2,}', '-', 'g'));
$$;

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS slug text;

-- 2. Normalized WhatsApp phone (additive)
CREATE OR REPLACE FUNCTION public.sellnova_normalize_phone(_input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  raw text;
  digits text;
BEGIN
  raw := trim(coalesce(_input, ''));
  IF raw = '' THEN RETURN ''; END IF;

  digits := regexp_replace(raw, '[^0-9]', '', 'g');
  IF digits = '' THEN RETURN ''; END IF;

  -- +234... or 234... -> 234...
  IF left(digits, 3) = '234' THEN
    RETURN digits;
  END IF;

  -- local 0-prefixed Nigerian number -> 234...
  IF left(digits, 1) = '0' THEN
    RETURN '234' || substring(digits from 2);
  END IF;

  -- explicit international number, keep as dialled
  IF left(raw, 1) = '+' THEN
    RETURN digits;
  END IF;

  -- bare 10-digit Nigerian subscriber number
  IF length(digits) = 10 THEN
    RETURN '234' || digits;
  END IF;

  RETURN digits;
END;
$$;

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS whatsapp_phone text;

-- 3. Backfill slug + whatsapp_phone for existing stores (part of the additive change)
UPDATE public.stores s
SET slug = COALESCE(
      s.slug,
      CASE
        WHEN (SELECT count(*) FROM public.stores o
              WHERE public.sellnova_slugify(o.store_name) = public.sellnova_slugify(s.store_name)) > 1
          THEN public.sellnova_slugify(s.store_name) || '-' || left(replace(s.id::text, '-', ''), 6)
        ELSE public.sellnova_slugify(s.store_name)
      END
    ),
    whatsapp_phone = COALESCE(s.whatsapp_phone, public.sellnova_normalize_phone(s.contact_phone));

-- Fall back to an id-suffixed slug if slugify produced an empty string
UPDATE public.stores
SET slug = 'store-' || left(replace(id::text, '-', ''), 8)
WHERE slug IS NULL OR slug = '';

CREATE UNIQUE INDEX IF NOT EXISTS stores_slug_unique_idx ON public.stores (slug);
CREATE UNIQUE INDEX IF NOT EXISTS stores_store_name_lower_unique_idx ON public.stores (lower(store_name));

-- 4. Store validation + slug/phone maintenance trigger
CREATE OR REPLACE FUNCTION public.sellnova_stores_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  base_slug text;
  candidate text;
  n int := 1;
BEGIN
  NEW.store_name := trim(NEW.store_name);

  IF length(NEW.store_name) < 3 OR length(NEW.store_name) > 50 THEN
    RAISE EXCEPTION 'Store name must be between 3 and 50 characters';
  END IF;

  IF NEW.store_name !~ '^[A-Za-z0-9][A-Za-z0-9 ''&.-]*$' THEN
    RAISE EXCEPTION 'Store name contains invalid characters';
  END IF;

  NEW.whatsapp_phone := public.sellnova_normalize_phone(NEW.contact_phone);

  IF length(NEW.whatsapp_phone) < 10 OR length(NEW.whatsapp_phone) > 15 THEN
    RAISE EXCEPTION 'Contact phone number is not valid';
  END IF;

  IF TG_OP = 'INSERT' OR NEW.store_name IS DISTINCT FROM OLD.store_name OR NEW.slug IS NULL THEN
    base_slug := public.sellnova_slugify(NEW.store_name);
    IF base_slug = '' THEN
      base_slug := 'store';
    END IF;
    candidate := base_slug;
    WHILE EXISTS (
      SELECT 1 FROM public.stores
      WHERE slug = candidate AND (TG_OP = 'INSERT' OR id <> NEW.id)
    ) LOOP
      n := n + 1;
      candidate := base_slug || '-' || n;
    END LOOP;
    NEW.slug := candidate;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sellnova_stores_before_write ON public.stores;
CREATE TRIGGER sellnova_stores_before_write
BEFORE INSERT OR UPDATE ON public.stores
FOR EACH ROW EXECUTE FUNCTION public.sellnova_stores_before_write();

-- 5. Product limits: 12 per store, 3 images, sane price
CREATE OR REPLACE FUNCTION public.sellnova_products_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  existing_count int;
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

  IF TG_OP = 'INSERT' OR NEW.store_id IS DISTINCT FROM OLD.store_id THEN
    SELECT count(*) INTO existing_count FROM public.products WHERE store_id = NEW.store_id;
    IF existing_count >= 12 THEN
      RAISE EXCEPTION 'A store can have at most 12 products';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sellnova_products_before_write ON public.products;
CREATE TRIGGER sellnova_products_before_write
BEFORE INSERT OR UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.sellnova_products_before_write();

-- 6. Analytics anti-abuse: cap inserts per store per short window
CREATE INDEX IF NOT EXISTS store_visitors_store_time_idx ON public.store_visitors (store_id, visited_at DESC);
CREATE INDEX IF NOT EXISTS product_views_store_time_idx ON public.product_views (store_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS product_views_product_time_idx ON public.product_views (product_id, viewed_at DESC);

CREATE OR REPLACE FUNCTION public.sellnova_visits_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  recent int;
BEGIN
  SELECT count(*) INTO recent
  FROM public.store_visitors
  WHERE store_id = NEW.store_id
    AND visited_at > now() - interval '1 minute';

  IF recent >= 30 THEN
    RETURN NULL; -- silently drop suspected inflation
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sellnova_visits_rate_limit ON public.store_visitors;
CREATE TRIGGER sellnova_visits_rate_limit
BEFORE INSERT ON public.store_visitors
FOR EACH ROW EXECUTE FUNCTION public.sellnova_visits_rate_limit();

CREATE OR REPLACE FUNCTION public.sellnova_product_views_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  recent int;
  owner_ok boolean;
BEGIN
  -- product must actually belong to the claimed store
  SELECT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = NEW.product_id AND p.store_id = NEW.store_id
  ) INTO owner_ok;

  IF NOT owner_ok THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO recent
  FROM public.product_views
  WHERE product_id = NEW.product_id
    AND viewed_at > now() - interval '1 minute';

  IF recent >= 20 THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sellnova_product_views_rate_limit ON public.product_views;
CREATE TRIGGER sellnova_product_views_rate_limit
BEFORE INSERT ON public.product_views
FOR EACH ROW EXECUTE FUNCTION public.sellnova_product_views_rate_limit();

-- 7. Storage: ownership-scoped uploads for product images
DROP POLICY IF EXISTS "Authenticated users can upload product images" ON storage.objects;
CREATE POLICY "Sellers upload into their own folder"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'product-images'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

-- 8. Linter hygiene: fix mutable search paths and lock down definer functions
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
ALTER FUNCTION public.get_store_product_count(uuid) SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.get_store_product_count(uuid) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.sellnova_stores_before_write() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.sellnova_products_before_write() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.sellnova_visits_rate_limit() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.sellnova_product_views_rate_limit() FROM anon, authenticated, public;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon;
