-- DEVELOPMENT ONLY. No deletion or expiry-driven rewrite of saved records.
DO $$ BEGIN
 IF current_setting('sellnova.dev_project_ref',true) IS DISTINCT FROM 'qfcnaceeppgrquoszkor' THEN
  RAISE EXCEPTION 'Development runner context required'; END IF;
END $$;
ALTER TABLE public.products ADD COLUMN publication_selected boolean NOT NULL DEFAULT true;
CREATE INDEX products_publication_order ON public.products(store_id,created_at,id) WHERE publication_selected;

-- Wall-clock entitlement, never JWT claims or a client-provided limit.
CREATE FUNCTION public.sellnova_publication_limit(_store_id uuid)
RETURNS integer LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN EXISTS(SELECT 1 FROM public.store_subscriptions ss JOIN public.plans pl ON pl.id=ss.plan_id
  WHERE ss.store_id=_store_id AND ss.status='active' AND pl.code='paid' AND pl.is_active
   AND (ss.expires_at IS NULL OR ss.expires_at>clock_timestamp())) THEN 100 ELSE 12 END;
$$;
CREATE FUNCTION public.sellnova_public_product_ids(_store_id uuid)
RETURNS SETOF uuid LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT p.id FROM public.products p JOIN public.stores s ON s.id=p.store_id
 WHERE s.id=_store_id AND s.is_active AND p.publication_selected
 ORDER BY p.created_at,p.id LIMIT public.sellnova_publication_limit(_store_id);
$$;
-- A public-only route even for an owner/admin visiting their own storefront.
CREATE FUNCTION public.sellnova_storefront_products(_store_id uuid)
RETURNS SETOF public.products LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT p.* FROM public.products p WHERE p.id IN(SELECT public.sellnova_public_product_ids(_store_id))
 ORDER BY p.created_at DESC,p.id;
$$;
DROP POLICY "Anyone can view products from active stores" ON public.products;
CREATE POLICY "Effective public products and authorized management" ON public.products FOR SELECT
 USING(EXISTS(SELECT 1 FROM public.stores s WHERE s.id=store_id AND s.seller_id=auth.uid())
  OR public.has_role(auth.uid(),'admin') OR id IN(SELECT public.sellnova_public_product_ids(store_id)));

CREATE FUNCTION public.sellnova_publication_state(_store_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE allowance integer; selected uuid[]; visible uuid[]; saved integer; revision text; sub public.store_subscriptions;
BEGIN
 IF auth.uid() IS NULL OR NOT (EXISTS(SELECT 1 FROM public.stores WHERE id=_store_id AND seller_id=auth.uid())
  OR public.has_role(auth.uid(),'admin')) THEN RAISE EXCEPTION 'Store ownership required'; END IF;
 allowance:=public.sellnova_publication_limit(_store_id);
 SELECT count(*),coalesce(array_agg(id ORDER BY created_at,id) FILTER(WHERE publication_selected),'{}'::uuid[]),
  md5(allowance::text||coalesce(jsonb_agg(jsonb_build_array(id,publication_selected) ORDER BY id)::text,'[]'))
  INTO saved,selected,revision FROM public.products WHERE store_id=_store_id;
 SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO visible FROM public.sellnova_public_product_ids(_store_id) id;
 SELECT * INTO sub FROM public.store_subscriptions WHERE store_id=_store_id;
 RETURN jsonb_build_object('plan',CASE WHEN allowance=100 THEN 'paid' ELSE 'free' END,
  'status',CASE WHEN sub.status='active' AND sub.expires_at<=clock_timestamp() THEN 'expired' ELSE coalesce(sub.status,'free') END,
  'expires_at',sub.expires_at,'server_time',clock_timestamp(),'allowance',allowance,'saved_count',saved,
  'selected_ids',selected,'visible_ids',visible,'version',revision);
END $$;

-- Publication changes are atomic, optimistic and serialized with checkout/confirmation.
CREATE FUNCTION public.sellnova_set_publication(_store_id uuid,_selected uuid[],_version text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE state jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(_store_id::text,921));
 state:=public.sellnova_publication_state(_store_id); -- Authorization before any mutation.
 IF _version IS DISTINCT FROM state->>'version' THEN RAISE EXCEPTION 'Products or plan changed; reload your selection'; END IF;
 IF _selected IS NULL OR cardinality(_selected)>(state->>'allowance')::integer THEN RAISE EXCEPTION 'Publication allowance exceeded'; END IF;
 IF (SELECT count(DISTINCT id) FROM unnest(_selected) id)<>cardinality(_selected)
  OR (SELECT count(*) FROM public.products WHERE store_id=_store_id AND id=ANY(_selected))<>cardinality(_selected) THEN
  RAISE EXCEPTION 'Selection must contain distinct products from this store'; END IF;
 UPDATE public.products SET publication_selected=(id=ANY(_selected)),updated_at=now()
  WHERE store_id=_store_id AND publication_selected IS DISTINCT FROM (id=ANY(_selected));
 -- A concurrent deletion cannot silently turn a chosen replacement into a missing product.
 IF (SELECT count(*) FROM public.products WHERE store_id=_store_id AND id=ANY(_selected))<>cardinality(_selected) THEN
  RAISE EXCEPTION 'Products changed; reload your selection'; END IF;
 RETURN public.sellnova_publication_state(_store_id);
END $$;

-- Keep normal content/stock writes; publication and identity fields are not client-writable.
REVOKE INSERT,UPDATE ON public.products FROM authenticated;
GRANT INSERT(id,store_id,name,description,price,images,is_available,track_stock,stock_quantity,low_stock_threshold)
 ON public.products TO authenticated;
GRANT UPDATE(store_id,name,description,price,images,is_available,track_stock,stock_quantity,low_stock_threshold)
 ON public.products TO authenticated;
CREATE FUNCTION public.sellnova_publication_product_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
   RAISE EXCEPTION 'Product identity and creation order are immutable'; END IF;
 ELSE
  IF auth.uid() IS NOT NULL AND NOT (EXISTS(SELECT 1 FROM public.stores WHERE id=NEW.store_id AND seller_id=auth.uid())
   OR public.has_role(auth.uid(),'admin')) THEN RAISE EXCEPTION 'Store ownership required'; END IF;
  -- BEFORE INSERT takes the same lock before count checks, including direct REST inserts.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.store_id::text,921));
  IF (SELECT count(*) FROM public.products WHERE store_id=NEW.store_id)>=public.sellnova_publication_limit(NEW.store_id) THEN
   RAISE EXCEPTION 'Saved product allowance reached; upgrade to add more'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sellnova_00_publication_guard BEFORE INSERT OR UPDATE ON public.products
 FOR EACH ROW EXECUTE FUNCTION public.sellnova_publication_product_guard();
-- Publication-only changes must not rewrite saved stock-tracking preferences on expiry.
DROP TRIGGER sellnova_products_before_write ON public.products;
CREATE TRIGGER sellnova_products_before_write BEFORE INSERT OR UPDATE OF store_id,name,description,price,images,
 is_available,track_stock,stock_quantity,low_stock_threshold ON public.products
 FOR EACH ROW EXECUTE FUNCTION public.sellnova_products_before_write();

REVOKE ALL ON FUNCTION public.sellnova_publication_limit(uuid),public.sellnova_public_product_ids(uuid),
 public.sellnova_storefront_products(uuid),public.sellnova_publication_state(uuid),
 public.sellnova_set_publication(uuid,uuid[],text),public.sellnova_publication_product_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sellnova_public_product_ids(uuid),public.sellnova_storefront_products(uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sellnova_publication_state(uuid),public.sellnova_set_publication(uuid,uuid[],text) TO authenticated;

-- Preserve checkout idempotency, promotion, order history and inventory behavior.
CREATE OR REPLACE FUNCTION public.sellnova_create_order(
  _store_id uuid, _customer_name text, _customer_phone text,
  _delivery_address text, _customer_note text, _items jsonb,
  _coupon text DEFAULT NULL, _request_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  line record; product public.products; prior record;
  normalized jsonb; priced jsonb := '[]'; payload text; phone text;
  subtotal numeric := 0; discount numeric := 0; promotion uuid; ref text; order_id uuid;
  result jsonb; input jsonb;
BEGIN
  IF _request_id IS NULL THEN RAISE EXCEPTION 'A stable checkout request UUID is required'; END IF;
  IF _customer_name IS NULL OR length(btrim(_customer_name)) NOT BETWEEN 2 AND 100
     OR _delivery_address IS NULL OR length(btrim(_delivery_address)) NOT BETWEEN 5 AND 500
     OR length(coalesce(_customer_note,'')) > 500
     OR _customer_phone IS NULL OR length(_customer_phone)>30
     OR length(coalesce(_coupon,''))>24 THEN RAISE EXCEPTION 'Invalid buyer details'; END IF;
  phone := public.sellnova_normalize_phone(_customer_phone);
  IF phone !~ '^[0-9]{10,15}$' THEN RAISE EXCEPTION 'Invalid WhatsApp number'; END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' THEN RAISE EXCEPTION 'Invalid cart'; END IF;
  IF jsonb_array_length(_items) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Cart must contain 1 to 50 lines'; END IF;
  FOR input IN SELECT value FROM jsonb_array_elements(_items) LOOP
    IF jsonb_typeof(input) <> 'object'
       OR coalesce(input->>'product_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR jsonb_typeof(input->'quantity') IS DISTINCT FROM 'number'
       OR coalesce(input->>'quantity','') !~ '^[0-9]{1,3}$' THEN RAISE EXCEPTION 'Invalid cart item'; END IF;
    IF (input->>'quantity')::integer NOT BETWEEN 1 AND 999 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
  END LOOP;
  SELECT jsonb_agg(jsonb_build_object('product_id',x.id,'quantity',x.qty) ORDER BY x.id)
    INTO normalized FROM (
      SELECT (value->>'product_id')::uuid id, sum((value->>'quantity')::integer)::integer qty
      FROM jsonb_array_elements(_items) GROUP BY (value->>'product_id')::uuid
    ) x;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(normalized) WHERE (value->>'quantity')::integer>999) THEN
    RAISE EXCEPTION 'Combined quantity exceeds 999';
  END IF;
  payload := encode(extensions.digest(convert_to(jsonb_build_object(
    'name',btrim(_customer_name),'phone',phone,'address',btrim(_delivery_address),
    'note',btrim(coalesce(_customer_note,'')),'coupon',upper(btrim(coalesce(_coupon,''))),
    'items',normalized)::text,'UTF8'),'sha256'),'hex');
  -- One store lock serializes checkout/confirmation/cancellation and coupon consumption.
  -- Acquire product locks in UUID order too; all stock changes are transactional.
  PERFORM pg_advisory_xact_lock(hashtextextended(_store_id::text,921));
  SELECT * INTO prior FROM sellnova_dev.checkout_requests WHERE store_id=_store_id AND request_id=_request_id;
  IF FOUND THEN
    IF prior.payload_hash <> payload THEN RAISE EXCEPTION 'Request UUID was used for a different checkout'; END IF;
    RETURN prior.receipt;
  END IF;
  PERFORM 1 FROM public.stores WHERE id=_store_id AND is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Store unavailable'; END IF;
  PERFORM sellnova_dev.consume_rate('checkout-store',_store_id::text,10);
  PERFORM sellnova_dev.consume_rate('checkout-buyer',_store_id::text||':'||encode(extensions.digest(phone,'sha256'),'hex'),3);
  FOR line IN SELECT (value->>'product_id')::uuid id,(value->>'quantity')::integer qty
      FROM jsonb_array_elements(normalized) ORDER BY (value->>'product_id')::uuid LOOP
    SELECT * INTO product FROM public.products WHERE id=line.id AND store_id=_store_id FOR UPDATE;
    IF NOT FOUND OR NOT product.is_available OR NOT EXISTS(SELECT 1 FROM public.sellnova_public_product_ids(_store_id) id WHERE id=product.id) THEN RAISE EXCEPTION 'Product unavailable'; END IF;
    IF product.track_stock AND product.stock_quantity<line.qty THEN RAISE EXCEPTION 'Insufficient stock'; END IF;
    subtotal := subtotal+product.price*line.qty;
    priced := priced || jsonb_build_array(jsonb_build_object(
      'product_id',line.id,'product_name',product.name,'unit_price',product.price,
      'quantity',line.qty,'line_total',product.price*line.qty));
  END LOOP;
  -- Lock every eligible promotion before calculating the best one; a seller's
  -- concurrent update cannot change terms between calculation and usage update.
  PERFORM 1 FROM public.promotions WHERE store_id=_store_id ORDER BY id FOR UPDATE;
  SELECT d.promotion_id,d.discount INTO promotion,discount
    FROM public.sellnova_discount_for(_store_id,subtotal,_coupon,priced) d;
  discount := coalesce(discount,0);
  ref := 'SN-'||upper(encode(extensions.gen_random_bytes(10),'hex'));
  INSERT INTO public.orders(store_id,order_reference,customer_name,customer_phone,delivery_address,
    customer_note,subtotal,discount_total,total,promotion_id,coupon_code,stock_applied)
  VALUES (_store_id,ref,btrim(_customer_name),phone,btrim(_delivery_address),nullif(btrim(_customer_note),''),
    subtotal,discount,greatest(subtotal-discount,0),promotion,
    CASE WHEN promotion IS NOT NULL THEN nullif(upper(btrim(_coupon)),'') END,false)
  RETURNING id INTO order_id;
  INSERT INTO public.order_items(order_id,product_id,product_name,unit_price,quantity,line_total)
    SELECT order_id,(v->>'product_id')::uuid,v->>'product_name',(v->>'unit_price')::numeric,
      (v->>'quantity')::integer,(v->>'line_total')::numeric
    FROM jsonb_array_elements(priced) v;
  INSERT INTO sellnova_dev.order_events(order_id,from_status,to_status,actor_id,stock_movements)
    VALUES(order_id,'checkout','new',auth.uid(),'[]'::jsonb);
  IF promotion IS NOT NULL THEN UPDATE public.promotions SET used_count=used_count+1 WHERE id=promotion; END IF;
  result := jsonb_build_object('order_reference',ref,'subtotal',subtotal,'discount_total',discount,
    'total',greatest(subtotal-discount,0),'items',priced);
  INSERT INTO sellnova_dev.checkout_requests(store_id,request_id,payload_hash,receipt)
    VALUES(_store_id,_request_id,payload,result);
  RETURN result;
END $$;

DO $$ BEGIN
 IF has_column_privilege('authenticated','public.products','publication_selected','UPDATE')
  OR has_column_privilege('authenticated','public.products','publication_selected','INSERT')
  OR has_function_privilege('anon','public.sellnova_publication_state(uuid)','EXECUTE')
  OR has_function_privilege('anon','public.sellnova_set_publication(uuid,uuid[],text)','EXECUTE') THEN
  RAISE EXCEPTION 'Unexpected publication mutation or management privileges'; END IF;
END $$;
