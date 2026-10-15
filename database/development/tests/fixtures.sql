-- Synthetic database integration fixtures only, not an Auth API signup substitute.
DO $$ BEGIN
 IF current_setting('sellnova.dev_project_ref',true) IS DISTINCT FROM 'qfcnaceeppgrquoszkor'
    OR current_setting('sellnova.test_run',true) IS NULL THEN RAISE EXCEPTION 'Guarded synthetic test context required'; END IF;
END $$;
INSERT INTO auth.users(id,email,aud,role,raw_user_meta_data)
SELECT current_setting('sellnova.test_'||v.kind)::uuid,
 v.kind||'+'||current_setting('sellnova.test_run')||'@example.test','authenticated','authenticated',
 jsonb_build_object('sellnova_synthetic_test',true,'sellnova_test_run',current_setting('sellnova.test_run'))
FROM (VALUES ('seller_a'),('seller_b'),('admin')) v(kind);
INSERT INTO public.user_roles(user_id,role)
VALUES(current_setting('sellnova.test_admin')::uuid,'admin');
INSERT INTO public.stores(id,seller_id,store_name,contact_phone)
VALUES
 (current_setting('sellnova.test_store_a')::uuid,current_setting('sellnova.test_seller_a')::uuid,
  'Fixture A '||left(current_setting('sellnova.test_run'),8),'2348030000001'),
 (current_setting('sellnova.test_store_b')::uuid,current_setting('sellnova.test_seller_b')::uuid,
  'Fixture B '||left(current_setting('sellnova.test_run'),8),'2348030000002');
INSERT INTO public.store_subscriptions(store_id,plan_id,status,expires_at)
SELECT current_setting('sellnova.test_store_a')::uuid,id,'active',now()+interval '1 day'
FROM public.plans WHERE code='paid';
INSERT INTO public.products(id,store_id,name,price,track_stock,stock_quantity)
VALUES(current_setting('sellnova.test_product')::uuid,current_setting('sellnova.test_store_a')::uuid,
 'Synthetic shirt',1000,true,20);
