-- DEVELOPMENT ONLY. Append after the original fifteen applied entries.
DO $$ BEGIN
 IF current_setting('sellnova.dev_project_ref',true) IS DISTINCT FROM 'qfcnaceeppgrquoszkor' THEN
  RAISE EXCEPTION 'Development runner context required'; END IF;
END $$;
ALTER TABLE public.platform_settings
 ADD COLUMN payment_collection_enabled boolean NOT NULL DEFAULT false,
 ADD COLUMN version bigint NOT NULL DEFAULT 1;
-- Initialize only the unconfigured development price; preserve deliberate prices.
UPDATE public.plans SET price_ngn=1500,duration_days=30 WHERE code='paid' AND price_ngn=0;
UPDATE public.plans SET max_products=CASE code WHEN 'free' THEN 12 ELSE 100 END WHERE code IN ('free','paid');
ALTER TABLE public.subscription_requests DROP CONSTRAINT subscription_requests_status_check;
ALTER TABLE public.subscription_requests ADD CONSTRAINT subscription_requests_status_check
 CHECK(status IN ('draft','pending','approved','rejected'));
ALTER TABLE public.subscription_requests
 ADD COLUMN payment_snapshot jsonb,
 ADD COLUMN settings_version bigint,
 ADD COLUMN activated_from timestamptz,
 ADD COLUMN activated_until timestamptz;
ALTER TABLE public.store_subscriptions
 ADD COLUMN source_request_id uuid REFERENCES public.subscription_requests(id),
 ADD COLUMN paid_amount numeric,
 ADD COLUMN paid_duration_days integer;
-- Legacy requests are retained, never assigned invented historical instructions.
CREATE UNIQUE INDEX subscription_one_open_quote ON public.subscription_requests(store_id)
 WHERE settings_version IS NOT NULL AND status IN ('draft','pending');
CREATE UNIQUE INDEX subscription_transfer_reference ON public.subscription_requests(lower(btrim(payment_reference)))
 WHERE settings_version IS NOT NULL AND status IN ('pending','approved','rejected');
-- All client mutations now use the narrow RPCs below. Read RLS stays intact.
REVOKE INSERT,UPDATE,DELETE ON public.plans,public.platform_settings,public.subscription_requests,
 public.store_subscriptions FROM authenticated;
-- Previous INSERT column grants must also be removed (table revokes do not remove them).
REVOKE INSERT(store_id,plan_id,amount,payment_reference,proof_path,status)
 ON public.subscription_requests FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.sellnova_decide_subscription(uuid,boolean,text,integer),
 public.sellnova_set_subscription_state(uuid,text,integer,text) FROM PUBLIC,anon,authenticated;
DROP TRIGGER sellnova_subscription_request_validate ON public.subscription_requests;
DROP TRIGGER sellnova_request_after_insert ON public.subscription_requests;
-- No pending/rejected notification mutates a store's current entitlement.

CREATE FUNCTION public.sellnova_update_payment_settings(_version bigint,_amount numeric,_days integer,
 _bank text,_name text,_number text,_instructions text,_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_settings public.platform_settings; old_plan public.plans; new_settings public.platform_settings;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Administrator required'; END IF;
 IF _amount IS NULL OR _amount NOT BETWEEN 1 AND 1000000 OR _amount='NaN'::numeric OR round(_amount,2)<>_amount
  OR _days IS NULL OR _days NOT BETWEEN 1 AND 365 OR _enabled IS NULL
  OR length(coalesce(_bank,''))>100 OR length(coalesce(_name,''))>100
  OR length(coalesce(_number,''))>30 OR length(coalesce(_instructions,''))>2000 THEN
  RAISE EXCEPTION 'Invalid payment settings'; END IF;
 IF _enabled AND (length(btrim(coalesce(_bank,'')))=0 OR length(btrim(coalesce(_name,'')))=0
  OR coalesce(_number,'') !~ '^[0-9]{10}$') THEN RAISE EXCEPTION 'Complete bank details required'; END IF;
 SELECT * INTO old_settings FROM public.platform_settings WHERE id=true FOR UPDATE;
 IF NOT FOUND OR _version IS DISTINCT FROM old_settings.version THEN RAISE EXCEPTION 'Settings changed; reload before saving'; END IF;
 SELECT * INTO STRICT old_plan FROM public.plans WHERE code='paid' FOR UPDATE;
 UPDATE public.plans SET price_ngn=_amount,duration_days=_days WHERE id=old_plan.id;
 UPDATE public.platform_settings SET bank_name=nullif(btrim(_bank),''),account_name=nullif(btrim(_name),''),
  account_number=nullif(btrim(_number),''),payment_instructions=_instructions,
  payment_collection_enabled=_enabled,version=version+1,updated_at=now() WHERE id=true RETURNING * INTO new_settings;
 INSERT INTO public.admin_audit_log(actor_id,action,details) VALUES(auth.uid(),'payment.settings.updated',
  jsonb_build_object('before',to_jsonb(old_settings),'after',to_jsonb(new_settings),
   'old_amount',old_plan.price_ngn,'old_days',old_plan.duration_days,'amount',_amount,'days',_days));
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION public.sellnova_begin_payment(_store_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.platform_settings; p public.plans; request_id uuid:=gen_random_uuid();
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 -- Store lock serializes competing quotes and approvals for a seller.
 PERFORM 1 FROM public.stores WHERE id=_store_id AND seller_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Store ownership required'; END IF;
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

CREATE FUNCTION public.sellnova_notify_payment(_request_id uuid,_reference text,_proof_path text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.subscription_requests;
BEGIN
 SELECT * INTO r FROM public.subscription_requests WHERE id=_request_id FOR UPDATE;
 IF NOT FOUND OR auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.stores WHERE id=r.store_id AND seller_id=auth.uid()) THEN
  RAISE EXCEPTION 'Payment request unavailable'; END IF;
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

CREATE FUNCTION public.sellnova_cancel_payment(_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE public.subscription_requests r SET status='rejected',decision_reason='Cancelled before payment',
  payment_reference='cancelled-'||r.id::text
 WHERE r.id=_request_id AND r.status='draft' AND EXISTS(SELECT 1 FROM public.stores s WHERE s.id=r.store_id AND s.seller_id=auth.uid());
 IF NOT FOUND THEN RAISE EXCEPTION 'Draft request unavailable'; END IF;
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION public.sellnova_review_payment(_request_id uuid,_approve boolean,_verified boolean,_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.subscription_requests; cur public.store_subscriptions; starts timestamptz; ends timestamptz; sid uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Administrator required'; END IF;
 IF _approve IS NULL OR (_approve AND _verified IS DISTINCT FROM true) THEN RAISE EXCEPTION 'Verify the bank transfer before approval'; END IF;
 IF length(coalesce(_reason,''))>1000 OR (NOT _approve AND length(btrim(coalesce(_reason,'')))=0) THEN
  RAISE EXCEPTION 'Decision reason required for rejection (maximum 1000 characters)'; END IF;
 SELECT store_id INTO sid FROM public.subscription_requests WHERE id=_request_id;
 PERFORM 1 FROM public.stores WHERE id=sid FOR UPDATE;
 SELECT * INTO r FROM public.subscription_requests WHERE id=_request_id FOR UPDATE;
 IF NOT FOUND OR r.status<>'pending' THEN RAISE EXCEPTION 'Request is unavailable or already reviewed'; END IF;
 IF _approve THEN
  IF r.payment_snapshot IS NULL OR r.settings_version IS NULL OR r.duration_days NOT BETWEEN 1 AND 365
   OR r.duration_days IS NULL OR r.amount<=0 THEN RAISE EXCEPTION 'Legacy payment requires reconciliation; reject and request a new quote'; END IF;
  SELECT * INTO cur FROM public.store_subscriptions WHERE store_id=r.store_id FOR UPDATE;
  IF cur.status='suspended' THEN RAISE EXCEPTION 'Resolve the suspended subscription before approval'; END IF;
  starts:=CASE WHEN cur.status='active' AND cur.expires_at IS NOT NULL AND cur.expires_at>now()
    THEN cur.expires_at ELSE now() END;
  IF cur.status='active' AND cur.expires_at IS NULL THEN RAISE EXCEPTION 'Indefinite legacy subscription requires reconciliation'; END IF;
  ends:=starts+make_interval(days=>r.duration_days);
  INSERT INTO public.store_subscriptions(store_id,plan_id,status,started_at,expires_at,source_request_id,paid_amount,paid_duration_days)
  VALUES(r.store_id,r.plan_id,'active',starts,ends,r.id,r.amount,r.duration_days)
  ON CONFLICT(store_id) DO UPDATE SET plan_id=EXCLUDED.plan_id,status='active',
   started_at=CASE WHEN public.store_subscriptions.status='active' AND public.store_subscriptions.expires_at>now()
    THEN public.store_subscriptions.started_at ELSE EXCLUDED.started_at END,
   expires_at=ends,source_request_id=r.id,paid_amount=r.amount,paid_duration_days=r.duration_days,updated_at=now();
 END IF;
 UPDATE public.subscription_requests SET status=CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
  reviewed_by=auth.uid(),reviewed_at=now(),decision_reason=_reason,
  activated_from=starts,activated_until=ends WHERE id=r.id;
 INSERT INTO public.admin_audit_log(actor_id,store_id,action,details) VALUES(auth.uid(),r.store_id,
  CASE WHEN _approve THEN 'payment.approved' ELSE 'payment.rejected' END,
  jsonb_build_object('request_id',r.id,'amount',r.amount,'days',r.duration_days,'verified',_verified,'reason',_reason,'expires_at',ends));
 RETURN jsonb_build_object('ok',true);
END $$;
-- New functions default to PUBLIC EXECUTE unless explicitly revoked.
REVOKE ALL ON FUNCTION public.sellnova_update_payment_settings(bigint,numeric,integer,text,text,text,text,boolean),
 public.sellnova_begin_payment(uuid),public.sellnova_notify_payment(uuid,text,text),
 public.sellnova_cancel_payment(uuid),public.sellnova_review_payment(uuid,boolean,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sellnova_update_payment_settings(bigint,numeric,integer,text,text,text,text,boolean),
 public.sellnova_begin_payment(uuid),public.sellnova_notify_payment(uuid,text,text),
 public.sellnova_cancel_payment(uuid),public.sellnova_review_payment(uuid,boolean,boolean,text) TO authenticated;
-- Fail closed if inherited/column privileges leave an alternative client path.
DO $$ DECLARE t text; f text; BEGIN
 FOREACH t IN ARRAY ARRAY['plans','platform_settings','subscription_requests','store_subscriptions'] LOOP
  IF has_table_privilege('authenticated','public.'||t,'INSERT,UPDATE,DELETE')
   OR has_any_column_privilege('authenticated','public.'||t,'INSERT,UPDATE') THEN
   RAISE EXCEPTION 'Unexpected direct billing mutation privilege on %',t; END IF;
 END LOOP;
 FOREACH f IN ARRAY ARRAY['sellnova_update_payment_settings(bigint,numeric,integer,text,text,text,text,boolean)',
  'sellnova_begin_payment(uuid)','sellnova_notify_payment(uuid,text,text)',
  'sellnova_cancel_payment(uuid)','sellnova_review_payment(uuid,boolean,boolean,text)'] LOOP
  IF has_function_privilege('anon','public.'||f,'EXECUTE')
   OR NOT has_function_privilege('authenticated','public.'||f,'EXECUTE') THEN
   RAISE EXCEPTION 'Unexpected billing function ACL'; END IF;
 END LOOP;
 IF has_function_privilege('authenticated','public.sellnova_decide_subscription(uuid,boolean,text,integer)','EXECUTE')
  OR has_function_privilege('authenticated','public.sellnova_set_subscription_state(uuid,text,integer,text)','EXECUTE') THEN
  RAISE EXCEPTION 'Legacy client activation path remains'; END IF;
END $$;
