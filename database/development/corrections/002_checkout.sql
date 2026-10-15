-- DEVELOPMENT ONLY. Request UUID is intentionally mandatory for writes.
DO $$ BEGIN
  IF current_setting('sellnova.dev_project_ref', true) IS DISTINCT FROM 'qfcnaceeppgrquoszkor' THEN
    RAISE EXCEPTION 'Development runner context required';
  END IF;
END $$;

-- No legacy non-idempotent overload remains reachable.
DROP FUNCTION public.sellnova_create_order(uuid,text,text,text,text,jsonb,text);
CREATE FUNCTION public.sellnova_create_order(
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
    IF NOT FOUND OR NOT product.is_available THEN RAISE EXCEPTION 'Product unavailable'; END IF;
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
REVOKE ALL ON FUNCTION public.sellnova_create_order(uuid,text,text,text,text,jsonb,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sellnova_create_order(uuid,text,text,text,text,jsonb,text,uuid) TO anon,authenticated,service_role;
