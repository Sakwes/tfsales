-- DEVELOPMENT ONLY. Preserve existing quotes/history; prohibit new active-Paid payments.
DO $$ BEGIN
 IF current_setting('sellnova.dev_project_ref',true) IS DISTINCT FROM 'qfcnaceeppgrquoszkor' THEN
  RAISE EXCEPTION 'Development runner context required'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.sellnova_begin_payment(_store_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.platform_settings; p public.plans; request_id uuid:=gen_random_uuid();
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 -- Store lock serializes competing quotes and approvals for a seller.
 PERFORM 1 FROM public.stores WHERE id=_store_id AND seller_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Store ownership required'; END IF;
 IF EXISTS(SELECT 1 FROM public.store_subscriptions ss JOIN public.plans pl ON pl.id=ss.plan_id
  WHERE ss.store_id=_store_id AND pl.code='paid' AND ss.status='active'
    AND (ss.expires_at IS NULL OR ss.expires_at>now())) THEN
  RAISE EXCEPTION 'Paid subscription is already active'; END IF;
 IF EXISTS(SELECT 1 FROM public.subscription_requests WHERE store_id=_store_id AND status IN ('draft','pending')) THEN
  RAISE EXCEPTION 'An open payment request already exists'; END IF;
 SELECT * INTO STRICT s FROM public.platform_settings WHERE id=true FOR SHARE;
 SELECT * INTO STRICT p FROM public.plans WHERE code='paid' AND is_active FOR SHARE;
 IF NOT s.payment_collection_enabled OR p.price_ngn<=0 OR s.bank_name IS NULL OR s.account_name IS NULL
  OR coalesce(s.account_number,'') !~ '^[0-9]{10}$' THEN RAISE EXCEPTION 'Payment collection is unavailable'; END IF;
 INSERT INTO public.subscription_requests(id,store_id,plan_id,amount,payment_reference,status,duration_days,settings_version,payment_snapshot)
 VALUES(request_id,_store_id,p.id,p.price_ngn,'quote-'||request_id::text,'draft',p.duration_days,s.version,
  jsonb_build_object('price_ngn',p.price_ngn,'duration_days',p.duration_days,'bank_name',s.bank_name,
   'account_name',s.account_name,'account_number',s.account_number,'payment_instructions',s.payment_instructions));
 RETURN request_id;
END $$;

CREATE OR REPLACE FUNCTION public.sellnova_notify_payment(_request_id uuid,_reference text,_proof_path text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.subscription_requests; sid uuid;
BEGIN
 SELECT store_id INTO sid FROM public.subscription_requests WHERE id=_request_id;
 -- Consistent store-then-request lock order with approval and quote creation.
 PERFORM 1 FROM public.stores WHERE id=sid AND seller_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment request unavailable'; END IF;
 SELECT * INTO r FROM public.subscription_requests WHERE id=_request_id FOR UPDATE;
 IF NOT FOUND OR auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.stores WHERE id=r.store_id AND seller_id=auth.uid()) THEN
  RAISE EXCEPTION 'Payment request unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM public.store_subscriptions ss JOIN public.plans pl ON pl.id=ss.plan_id
  WHERE ss.store_id=r.store_id AND pl.code='paid' AND ss.status='active'
    AND (ss.expires_at IS NULL OR ss.expires_at>now())) THEN
  RAISE EXCEPTION 'Paid subscription is already active'; END IF;
 IF r.status<>'draft' OR r.settings_version IS NULL THEN RAISE EXCEPTION 'Request cannot be notified again'; END IF;
 IF length(btrim(coalesce(_reference,''))) NOT BETWEEN 4 AND 80 THEN RAISE EXCEPTION 'Invalid transfer reference'; END IF;
 IF _proof_path IS NOT NULL AND (length(_proof_path)>400 OR _proof_path LIKE '%..%'
  OR split_part(_proof_path,'/',1)<>auth.uid()::text OR NOT EXISTS(
   SELECT 1 FROM storage.objects WHERE bucket_id='payment-proofs' AND name=_proof_path)) THEN
  RAISE EXCEPTION 'Invalid payment proof'; END IF;
 UPDATE public.subscription_requests SET payment_reference=btrim(_reference),proof_path=_proof_path,status='pending'
  WHERE id=r.id;
 RETURN jsonb_build_object('ok',true);
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Transfer reference already submitted';
END $$;
