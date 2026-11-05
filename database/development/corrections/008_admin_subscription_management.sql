-- DEVELOPMENT ONLY. Proposed manifest entry 19; unapplied pending ledger verification/review.
DO $$ BEGIN
 IF current_setting('sellnova.dev_project_ref',true) IS DISTINCT FROM 'qfcnaceeppgrquoszkor' THEN
  RAISE EXCEPTION 'Development runner context required'; END IF;
 IF (SELECT count(*) FROM sellnova_dev.migration_history)<>18 OR EXISTS(
  SELECT 1 FROM sellnova_dev.migration_history WHERE project_ref<>'qfcnaceeppgrquoszkor') OR NOT EXISTS(
  SELECT 1 FROM sellnova_dev.migration_history
  WHERE path='database/development/corrections/007_product_publication.sql'
   AND sha256='6df14582f2b9e8f876afae34b1ac6ff77a34745fa5782dc0fd67ec7aedfab30f') THEN
  RAISE EXCEPTION 'Expected eighteen-entry development history; use the checksummed runner'; END IF;
 IF (SELECT count(*) FROM public.plans WHERE code IN ('free','paid') AND is_active)<>2 THEN
  RAISE EXCEPTION 'Active Free and Paid plans required'; END IF;
END $$;

-- No catalog, payment, order, subscription expiry or publication-selection backfill.
UPDATE public.plans SET max_products=CASE code WHEN 'free' THEN 12 ELSE 50 END
 WHERE code IN ('free','paid');
ALTER TABLE public.store_subscriptions
 ADD COLUMN revision uuid NOT NULL DEFAULT gen_random_uuid(),
 ADD COLUMN latest_source text NOT NULL DEFAULT 'legacy' CHECK(latest_source IN ('admin','payment','legacy'));
-- Opaque revision changes even for a same-plan expiry edit by an existing trusted writer.
CREATE FUNCTION sellnova_dev.subscription_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.store_id IS DISTINCT FROM OLD.store_id THEN
  RAISE EXCEPTION 'Subscription store identity is immutable'; END IF;
 -- Also serialize trusted inserts when no subscription row exists yet. Raw trusted
 -- updates must take this lock before row locks to avoid a fail-closed deadlock.
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.store_id::text,921));
 NEW.revision:=gen_random_uuid();
 RETURN NEW;
END $$;
CREATE TRIGGER sellnova_subscription_revision BEFORE INSERT OR UPDATE ON public.store_subscriptions
 FOR EACH ROW EXECUTE FUNCTION sellnova_dev.subscription_revision();

-- Receipts outlive users/stores: no cascade deletes or invented payment transactions.
CREATE TABLE sellnova_dev.subscription_operations(
 operation_id uuid PRIMARY KEY, actor_id uuid NOT NULL, store_id uuid NOT NULL,
 payload jsonb NOT NULL, receipt jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE sellnova_dev.subscription_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE sellnova_dev.subscription_operations FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX subscription_operations_store ON sellnova_dev.subscription_operations(store_id,created_at);
CREATE INDEX sellnova_subscription_audit_store ON public.admin_audit_log(store_id,created_at DESC,id);

-- Recheck the stored role, not user-editable JWT metadata; hold it through the action.
CREATE FUNCTION sellnova_dev.require_subscription_admin()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.user_roles WHERE user_id=auth.uid() AND role='admin' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
END $$;

-- Wall-clock expiry, including long-running pooled sessions; Free is indefinite.
CREATE OR REPLACE FUNCTION public.sellnova_effective_plan(_store_id uuid)
RETURNS public.plans LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.plans;
BEGIN
 IF EXISTS(SELECT 1 FROM public.stores WHERE id=_store_id
  AND (is_active OR seller_id=auth.uid() OR public.has_role(auth.uid(),'admin'))) THEN
  SELECT pl.* INTO p FROM public.store_subscriptions ss JOIN public.plans pl ON pl.id=ss.plan_id
   WHERE ss.store_id=_store_id AND ss.status='active' AND pl.is_active
    AND (ss.expires_at IS NULL OR ss.expires_at>clock_timestamp());
 END IF;
 IF p.id IS NULL THEN SELECT * INTO p FROM public.plans WHERE code='free' AND is_active; END IF;
 RETURN p;
END $$;
CREATE OR REPLACE FUNCTION public.sellnova_publication_limit(_store_id uuid)
RETURNS integer LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN EXISTS(SELECT 1 FROM public.store_subscriptions ss JOIN public.plans pl ON pl.id=ss.plan_id
  WHERE ss.store_id=_store_id AND ss.status='active' AND pl.code='paid' AND pl.is_active
   AND (ss.expires_at IS NULL OR ss.expires_at>clock_timestamp())) THEN 50 ELSE 12 END;
$$;
CREATE OR REPLACE FUNCTION public.sellnova_store_max_products(_store_id uuid)
RETURNS integer LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT public.sellnova_publication_limit(_store_id);
$$;
CREATE OR REPLACE FUNCTION public.sellnova_publication_state(_store_id uuid)
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
 RETURN jsonb_build_object('plan',CASE WHEN allowance=50 THEN 'paid' ELSE 'free' END,
  'status',CASE WHEN sub.status='active' AND sub.expires_at<=clock_timestamp() THEN 'expired' ELSE coalesce(sub.status,'free') END,
  'expires_at',sub.expires_at,'server_time',clock_timestamp(),'allowance',allowance,'saved_count',saved,
  'selected_ids',selected,'visible_ids',visible,'version',revision);
END $$;

-- Private row adapter; public callers must authorize before entering this helper.
CREATE FUNCTION sellnova_dev.subscription_row(_store_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.stores; sub public.store_subscriptions; allowance integer; effective text; saved integer;
 selected integer; visible integer; pending integer; email text;
BEGIN
 SELECT * INTO s FROM public.stores WHERE id=_store_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Store unavailable'; END IF;
 SELECT * INTO sub FROM public.store_subscriptions WHERE store_id=_store_id;
 allowance:=public.sellnova_publication_limit(_store_id);
 effective:=CASE WHEN sub.status='active' AND sub.expires_at<=clock_timestamp() THEN 'expired'
  ELSE coalesce(sub.status,'free') END;
 SELECT count(*),count(*) FILTER(WHERE publication_selected) INTO saved,selected FROM public.products WHERE store_id=_store_id;
 visible:=CASE WHEN s.is_active THEN least(selected,allowance) ELSE 0 END;
 SELECT count(*) INTO pending FROM public.subscription_requests WHERE store_id=_store_id AND status IN ('draft','pending');
 SELECT u.email INTO email FROM auth.users u WHERE u.id=s.seller_id;
 RETURN jsonb_build_object('store_id',s.id,'seller_id',s.seller_id,'store_name',s.store_name,'seller_email',email,
  'plan',CASE WHEN allowance=50 THEN 'paid' ELSE 'free' END,'stored_status',coalesce(sub.status,'free'),
  'effective_status',effective,'expires_at',sub.expires_at,
  'stored_plan_id',sub.plan_id,'started_at',sub.started_at,'source_request_id',sub.source_request_id,
  'paid_amount',sub.paid_amount,'paid_duration_days',sub.paid_duration_days,
  'source',CASE WHEN sub.store_id IS NULL THEN 'implicit_free' WHEN sub.latest_source='legacy' AND sub.source_request_id IS NOT NULL
   THEN 'payment' ELSE sub.latest_source END,
  'revision',coalesce(sub.revision::text,'implicit:'||s.id::text)||':'||allowance::text||':'||effective,
  'saved_count',saved,'selected_count',selected,'visible_count',visible,'allowance',allowance,
  'is_active',s.is_active,'pending_count',pending);
END $$;
CREATE FUNCTION sellnova_dev.subscription_snapshot(_row jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('plan',_row->'plan','status',_row->'effective_status','expires_at',_row->'expires_at',
  'stored_plan_id',_row->'stored_plan_id','stored_status',_row->'stored_status','started_at',_row->'started_at',
  'source',_row->'source','source_request_id',_row->'source_request_id','paid_amount',_row->'paid_amount',
  'paid_duration_days',_row->'paid_duration_days');
$$;

CREATE FUNCTION public.sellnova_admin_list_subscriptions(_search text DEFAULT '',_filter text DEFAULT 'all',
 _offset integer DEFAULT 0,_limit integer DEFAULT 25,_store_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM sellnova_dev.require_subscription_admin();
 IF _search IS NULL OR length(_search)>200 OR _filter IS NULL OR _filter NOT IN ('all','free','paid','expired')
  OR _offset IS NULL OR _offset NOT BETWEEN 0 AND 1000000 OR _limit IS NULL OR _limit NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'Invalid subscription list parameters'; END IF;
 WITH candidates AS MATERIALIZED(
  SELECT s.id,sellnova_dev.subscription_row(s.id) item FROM public.stores s
  LEFT JOIN auth.users u ON u.id=s.seller_id
  WHERE (_store_id IS NULL OR s.id=_store_id)
   AND (btrim(_search)='' OR strpos(lower(s.store_name||' '||coalesce(u.email,'')||' '||s.seller_id::text),lower(btrim(_search)))>0)
 ), filtered AS MATERIALIZED(
  SELECT * FROM candidates WHERE _filter='all' OR (_filter IN ('free','paid') AND item->>'plan'=_filter)
   OR (_filter='expired' AND item->>'effective_status'='expired')
 ), page AS (SELECT * FROM filtered ORDER BY lower(item->>'store_name'),id OFFSET _offset LIMIT _limit)
 SELECT jsonb_build_object('schema_version',1,'total',(SELECT count(*) FROM filtered),
  'items',coalesce((SELECT jsonb_agg(item ORDER BY lower(item->>'store_name'),id) FROM page),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;

CREATE FUNCTION public.sellnova_admin_subscription_history(_store_id uuid,_offset integer DEFAULT 0,_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM sellnova_dev.require_subscription_admin();
 IF _store_id IS NULL OR _offset IS NULL OR _offset NOT BETWEEN 0 AND 1000000 OR _limit IS NULL OR _limit NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'Invalid history parameters'; END IF;
 WITH events AS MATERIALIZED(
  SELECT a.id,a.created_at,jsonb_build_object('id',a.id,'actor_id',a.actor_id,
   'actor_label',coalesce(a.details->>'actor_label',u.email),'action',a.action,'created_at',a.created_at,
   'reason',a.details->>'reason','before',a.details->'before','after',a.details->'after',
   'source',CASE WHEN a.action IN ('payment.approved','payment.rejected') THEN 'payment' ELSE coalesce(a.details->>'source','legacy') END) item
  FROM public.admin_audit_log a LEFT JOIN auth.users u ON u.id=a.actor_id
  WHERE a.store_id=_store_id AND (a.action LIKE 'subscription.%' OR a.action IN ('payment.approved','payment.rejected'))
 ), page AS (SELECT * FROM events ORDER BY created_at DESC,id DESC OFFSET _offset LIMIT _limit)
 SELECT jsonb_build_object('total',(SELECT count(*) FROM events),
  'items',coalesce((SELECT jsonb_agg(item ORDER BY created_at DESC,id DESC) FROM page),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;

CREATE FUNCTION public.sellnova_admin_set_subscription(_store_id uuid,_action text,_expires_at timestamptz,
 _reason text,_expected_revision text,_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE payload jsonb; prior record; before_row jsonb; after_row jsonb;
 result jsonb; pid uuid; actor_label text;
BEGIN
 PERFORM sellnova_dev.require_subscription_admin();
 IF _store_id IS NULL OR _operation_id IS NULL THEN RAISE EXCEPTION 'Store and operation UUID required'; END IF;
 payload:=jsonb_build_object('store_id',_store_id,'action',_action,'expires_at',_expires_at AT TIME ZONE 'UTC',
  'reason',_reason,'expected_revision',_expected_revision);
 -- Global operation scope rejects reuse across stores and administrators, without revealing receipts.
 PERFORM pg_advisory_xact_lock(hashtextextended(_operation_id::text,922));
 SELECT * INTO prior FROM sellnova_dev.subscription_operations WHERE operation_id=_operation_id;
 IF FOUND THEN
  IF prior.actor_id<>auth.uid() OR prior.payload IS DISTINCT FROM payload THEN
   RAISE EXCEPTION 'Operation UUID already used for a different command'; END IF;
  -- Replay before time/revision checks: recovery remains valid after expiry or newer changes.
  RETURN prior.receipt||jsonb_build_object('replayed',true);
 END IF;
 IF _action IS NULL OR _action NOT IN ('paid','free') OR length(btrim(coalesce(_reason,''))) NOT BETWEEN 1 AND 1000
  OR _expected_revision IS NULL OR length(_expected_revision) NOT BETWEEN 1 AND 200
  OR (_action='paid' AND (_expires_at IS NULL OR NOT isfinite(_expires_at) OR _expires_at<=clock_timestamp()))
  OR (_action='free' AND _expires_at IS NOT NULL) THEN RAISE EXCEPTION 'Invalid manual subscription command'; END IF;
 -- Same store lock as product insertion/selection/checkout, then bank-workflow row lock.
 PERFORM pg_advisory_xact_lock(hashtextextended(_store_id::text,921));
 PERFORM 1 FROM public.stores WHERE id=_store_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Store unavailable'; END IF;
 PERFORM 1 FROM public.store_subscriptions WHERE store_id=_store_id FOR UPDATE;
 before_row:=sellnova_dev.subscription_row(_store_id);
 IF before_row->>'revision' IS DISTINCT FROM _expected_revision THEN RAISE EXCEPTION 'Subscription changed; reload before saving'; END IF;
 IF before_row->>'stored_status'='suspended' THEN RAISE EXCEPTION 'Resolve the suspended subscription separately'; END IF;
 -- Recheck after lock waits; never install an already expired grant.
 IF _action='paid' AND _expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Paid expiry must be in the future'; END IF;
 SELECT id INTO STRICT pid FROM public.plans WHERE code=_action AND is_active;
 INSERT INTO public.store_subscriptions(store_id,plan_id,status,started_at,expires_at,latest_source)
 VALUES(_store_id,pid,CASE WHEN _action='paid' THEN 'active' ELSE 'free' END,
  CASE WHEN _action='paid' THEN clock_timestamp() ELSE NULL END,_expires_at,'admin')
 ON CONFLICT(store_id) DO UPDATE SET plan_id=EXCLUDED.plan_id,status=EXCLUDED.status,
  started_at=CASE WHEN _action='paid' AND before_row->>'plan'='paid' AND public.store_subscriptions.status='active'
   AND (public.store_subscriptions.expires_at IS NULL OR public.store_subscriptions.expires_at>clock_timestamp())
   THEN public.store_subscriptions.started_at ELSE EXCLUDED.started_at END,
  expires_at=EXCLUDED.expires_at,latest_source='admin',updated_at=clock_timestamp();
 -- source_request_id/paid_amount/paid_duration_days retain payment provenance; latest_source distinguishes grants.
 after_row:=sellnova_dev.subscription_row(_store_id);
 SELECT email INTO actor_label FROM auth.users WHERE id=auth.uid();
 INSERT INTO public.admin_audit_log(actor_id,store_id,action,details,created_at)
 VALUES(auth.uid(),_store_id,'subscription.manual.'||_action,jsonb_build_object('source','admin','operation_id',_operation_id,
  'actor_label',actor_label,'reason',btrim(_reason),'before',sellnova_dev.subscription_snapshot(before_row),
  'after',sellnova_dev.subscription_snapshot(after_row),'before_revision',before_row->>'revision','after_revision',after_row->>'revision'),clock_timestamp());
 result:=jsonb_build_object('operation_id',_operation_id,'replayed',false,'subscription',after_row);
 INSERT INTO sellnova_dev.subscription_operations(operation_id,actor_id,store_id,payload,receipt)
 VALUES(_operation_id,auth.uid(),_store_id,payload,result);
 RETURN result;
END $$;

-- Preserve bank quote snapshots, ownership/proof validation and active-Paid guards.
CREATE OR REPLACE FUNCTION public.sellnova_begin_payment(_store_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.platform_settings; p public.plans; request_id uuid:=gen_random_uuid();
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 -- Advisory-then-store order also coordinates manual grants and publication.
 PERFORM pg_advisory_xact_lock(hashtextextended(_store_id::text,921));
 PERFORM 1 FROM public.stores WHERE id=_store_id AND seller_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Store ownership required'; END IF;
 IF EXISTS(SELECT 1 FROM public.store_subscriptions ss JOIN public.plans pl ON pl.id=ss.plan_id
  WHERE ss.store_id=_store_id AND pl.code='paid' AND ss.status='active'
    AND (ss.expires_at IS NULL OR ss.expires_at>clock_timestamp())) THEN
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
 PERFORM pg_advisory_xact_lock(hashtextextended(sid::text,921));
 -- Same advisory/store/request order as approval and manual changes.
 PERFORM 1 FROM public.stores WHERE id=sid AND seller_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment request unavailable'; END IF;
 SELECT * INTO r FROM public.subscription_requests WHERE id=_request_id FOR UPDATE;
 IF NOT FOUND OR auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.stores WHERE id=r.store_id AND seller_id=auth.uid()) THEN
  RAISE EXCEPTION 'Payment request unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM public.store_subscriptions ss JOIN public.plans pl ON pl.id=ss.plan_id
  WHERE ss.store_id=r.store_id AND pl.code='paid' AND ss.status='active'
    AND (ss.expires_at IS NULL OR ss.expires_at>clock_timestamp())) THEN
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
-- Same signature and verified-transfer requirement; never accept an amount from the caller.
CREATE OR REPLACE FUNCTION public.sellnova_review_payment(_request_id uuid,_approve boolean,_verified boolean,_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.subscription_requests; cur public.store_subscriptions; starts timestamptz; ends timestamptz; sid uuid;
 before_row jsonb; after_row jsonb; actor_label text; current_paid boolean; at_time timestamptz;
BEGIN
 PERFORM sellnova_dev.require_subscription_admin();
 IF _approve IS NULL OR (_approve AND _verified IS DISTINCT FROM true) THEN RAISE EXCEPTION 'Verify the bank transfer before approval'; END IF;
 IF length(coalesce(_reason,''))>1000 OR (NOT _approve AND length(btrim(coalesce(_reason,'')))=0) THEN
  RAISE EXCEPTION 'Decision reason required for rejection (maximum 1000 characters)'; END IF;
 SELECT store_id INTO sid FROM public.subscription_requests WHERE id=_request_id;
 IF sid IS NULL THEN RAISE EXCEPTION 'Payment request unavailable'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(sid::text,921));
 PERFORM 1 FROM public.stores WHERE id=sid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Store unavailable'; END IF;
 SELECT * INTO r FROM public.subscription_requests WHERE id=_request_id FOR UPDATE;
 IF NOT FOUND OR r.status<>'pending' THEN RAISE EXCEPTION 'Request is unavailable or already reviewed'; END IF;
 before_row:=sellnova_dev.subscription_row(sid);
 IF _approve THEN
  IF r.payment_snapshot IS NULL OR r.settings_version IS NULL OR r.duration_days NOT BETWEEN 1 AND 365
   OR r.duration_days IS NULL OR r.amount IS NULL OR r.amount<=0 OR NOT EXISTS(
    SELECT 1 FROM public.plans WHERE id=r.plan_id AND code='paid' AND is_active) THEN
   RAISE EXCEPTION 'Legacy payment requires reconciliation; reject and request a new quote'; END IF;
  SELECT * INTO cur FROM public.store_subscriptions WHERE store_id=r.store_id FOR UPDATE;
  IF cur.status='suspended' THEN RAISE EXCEPTION 'Resolve the suspended subscription before approval'; END IF;
  at_time:=clock_timestamp();
  current_paid:=cur.status='active' AND EXISTS(SELECT 1 FROM public.plans WHERE id=cur.plan_id AND code='paid' AND is_active);
  IF current_paid AND cur.expires_at IS NULL THEN RAISE EXCEPTION 'Indefinite legacy subscription requires reconciliation'; END IF;
  starts:=CASE WHEN current_paid AND cur.expires_at>at_time THEN cur.expires_at ELSE at_time END;
  ends:=starts+make_interval(days=>r.duration_days);
  INSERT INTO public.store_subscriptions(store_id,plan_id,status,started_at,expires_at,source_request_id,paid_amount,paid_duration_days,latest_source)
  VALUES(r.store_id,r.plan_id,'active',starts,ends,r.id,r.amount,r.duration_days,'payment')
  ON CONFLICT(store_id) DO UPDATE SET plan_id=EXCLUDED.plan_id,status='active',
   started_at=CASE WHEN current_paid AND public.store_subscriptions.expires_at>at_time
    THEN public.store_subscriptions.started_at ELSE EXCLUDED.started_at END,
   expires_at=ends,source_request_id=r.id,paid_amount=r.amount,paid_duration_days=r.duration_days,
   latest_source='payment',updated_at=clock_timestamp();
 END IF;
 UPDATE public.subscription_requests SET status=CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
  reviewed_by=auth.uid(),reviewed_at=clock_timestamp(),decision_reason=_reason,
  activated_from=starts,activated_until=ends WHERE id=r.id;
 after_row:=sellnova_dev.subscription_row(sid);
 SELECT email INTO actor_label FROM auth.users WHERE id=auth.uid();
 INSERT INTO public.admin_audit_log(actor_id,store_id,action,details,created_at) VALUES(auth.uid(),r.store_id,
  CASE WHEN _approve THEN 'payment.approved' ELSE 'payment.rejected' END,
  jsonb_build_object('request_id',r.id,'amount',r.amount,'days',r.duration_days,'verified',_verified,'reason',_reason,
   'expires_at',ends,'actor_label',actor_label,'source','payment','before',sellnova_dev.subscription_snapshot(before_row),
   'after',sellnova_dev.subscription_snapshot(after_row),'before_revision',before_row->>'revision','after_revision',after_row->>'revision'),clock_timestamp());
 RETURN jsonb_build_object('ok',true);
END $$;

-- No frontend access to private helpers, receipts, trigger or legacy setters.
REVOKE ALL ON FUNCTION sellnova_dev.subscription_revision(),sellnova_dev.require_subscription_admin(),
 sellnova_dev.subscription_row(uuid),sellnova_dev.subscription_snapshot(jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.sellnova_admin_list_subscriptions(text,text,integer,integer,uuid),
 public.sellnova_admin_subscription_history(uuid,integer,integer),
 public.sellnova_admin_set_subscription(uuid,text,timestamptz,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sellnova_admin_list_subscriptions(text,text,integer,integer,uuid),
 public.sellnova_admin_subscription_history(uuid,integer,integer),
 public.sellnova_admin_set_subscription(uuid,text,timestamptz,text,text,uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.sellnova_set_subscription_state(uuid,text,integer,text),
 public.sellnova_decide_subscription(uuid,boolean,text,integer) FROM PUBLIC,anon,authenticated;

-- Roll back the entire migration if a previously inherited privilege reopens a write path.
DO $$ DECLARE t text; f text; BEGIN
 FOREACH t IN ARRAY ARRAY['plans','platform_settings','store_subscriptions','subscription_requests','admin_audit_log'] LOOP
  IF has_table_privilege('authenticated','public.'||t,'INSERT,UPDATE,DELETE')
   OR has_any_column_privilege('authenticated','public.'||t,'INSERT,UPDATE') THEN
   RAISE EXCEPTION 'Unexpected direct subscription/audit mutation privilege'; END IF;
 END LOOP;
 FOREACH f IN ARRAY ARRAY['sellnova_admin_list_subscriptions(text,text,integer,integer,uuid)',
  'sellnova_admin_subscription_history(uuid,integer,integer)',
  'sellnova_admin_set_subscription(uuid,text,timestamptz,text,text,uuid)'] LOOP
  IF has_function_privilege('anon','public.'||f,'EXECUTE')
   OR NOT has_function_privilege('authenticated','public.'||f,'EXECUTE') THEN
   RAISE EXCEPTION 'Unexpected admin RPC ACL'; END IF;
 END LOOP;
 IF has_function_privilege('authenticated','public.sellnova_set_subscription_state(uuid,text,integer,text)','EXECUTE')
  OR has_function_privilege('authenticated','public.sellnova_decide_subscription(uuid,boolean,text,integer)','EXECUTE')
  OR has_schema_privilege('authenticated','sellnova_dev','USAGE')
  OR has_table_privilege('authenticated','sellnova_dev.subscription_operations','SELECT,INSERT,UPDATE,DELETE')
  OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='sellnova_dev.subscription_operations'::regclass)
  OR (SELECT max_products FROM public.plans WHERE code='paid')<>50
  OR (SELECT max_products FROM public.plans WHERE code='free')<>12 THEN
  RAISE EXCEPTION 'Unexpected legacy/private/plan access'; END IF;
END $$;
