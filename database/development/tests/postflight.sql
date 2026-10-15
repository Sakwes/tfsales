-- Prepared read-only catalog assertions, never run by offline/static validation.
DO $$ BEGIN
 IF current_setting('sellnova.dev_project_ref',true) IS DISTINCT FROM 'qfcnaceeppgrquoszkor' THEN
   RAISE EXCEPTION 'Guarded development context required'; END IF;
 IF has_column_privilege('authenticated','public.orders','stock_applied','UPDATE')
    OR has_column_privilege('authenticated','public.orders','customer_name','UPDATE')
    OR NOT has_column_privilege('authenticated','public.orders','status','UPDATE') THEN
   RAISE EXCEPTION 'Unexpected order column privileges'; END IF;
 IF has_table_privilege('anon','public.orders','SELECT')
    OR has_table_privilege('anon','public.order_items','INSERT') THEN
   RAISE EXCEPTION 'Public order permissions are too broad'; END IF;
 IF to_regprocedure('public.sellnova_create_order(uuid,text,text,text,text,jsonb,text)') IS NOT NULL
    OR to_regprocedure('public.sellnova_create_order(uuid,text,text,text,text,jsonb,text,uuid)') IS NULL THEN
   RAISE EXCEPTION 'Unsafe or missing checkout overload'; END IF;
 IF has_column_privilege('authenticated','public.order_items','deducted_quantity','UPDATE')
    OR to_regclass('sellnova_dev.order_events') IS NULL THEN
   RAISE EXCEPTION 'Unsafe or missing inventory audit ledger'; END IF;
 IF has_function_privilege('anon','public.sellnova_discount_for(uuid,numeric,text,jsonb)','EXECUTE') THEN
   RAISE EXCEPTION 'Internal discount helper exposed'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','sellnova_dev') AND c.relkind IN ('r','p') AND NOT c.relrowsecurity) THEN
   -- migration_history is administrative ledger, inaccessible by schema/table ACL.
   IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname IN ('public','sellnova_dev') AND c.relkind IN ('r','p') AND NOT c.relrowsecurity
       AND NOT (n.nspname='sellnova_dev' AND c.relname='migration_history')) THEN
     RAISE EXCEPTION 'RLS missing from application/private data table'; END IF;
 END IF;
 IF (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pgcrypto')
    IS DISTINCT FROM 'extensions' THEN RAISE EXCEPTION 'Unexpected pgcrypto schema'; END IF;
 IF has_schema_privilege('anon','sellnova_dev','USAGE') OR has_schema_privilege('authenticated','public','CREATE') THEN
   RAISE EXCEPTION 'Unsafe schema permissions'; END IF;
 IF (SELECT count(*) FROM public.plans WHERE code IN ('free','paid'))<>2 THEN
   RAISE EXCEPTION 'Missing baseline plans'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='payment-proofs' AND NOT public) THEN
   RAISE EXCEPTION 'Payment proofs must be private'; END IF;
END $$;
