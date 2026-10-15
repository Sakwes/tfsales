-- DEVELOPMENT ONLY. No trials or real billing. Paid price=0 disables purchase UI.
DO $$ BEGIN
  IF current_setting('sellnova.dev_project_ref', true) IS DISTINCT FROM 'qfcnaceeppgrquoszkor' THEN
    RAISE EXCEPTION 'Development runner context required';
  END IF;
END $$;
INSERT INTO public.plans(code,name,description,price_ngn,duration_days,max_products,
  allow_stock,allow_discounts,allow_reviews,allow_branding,allow_advanced_orders,is_core,is_active,sort_order)
VALUES
  ('free','Free','Development Free baseline; no trial',0,3650,12,false,false,false,false,false,true,true,1),
  ('paid','Paid','Development entitlement fixture; billing is unconfigured',0,30,100,true,true,true,true,true,true,true,2)
ON CONFLICT(code) DO NOTHING;
-- Preserve later deliberate development settings on replay. No banking details.
INSERT INTO public.platform_settings(id,payment_instructions,support_email)
VALUES(true,'Development only. Do not send money. Paid billing is not configured.','support@example.test')
ON CONFLICT(id) DO NOTHING;
-- The future 30-day trial and NGN 1,500/month model is NOT implemented here.
-- Paid duration=30 is a fixture period, not a trial. Paid cap=100 is a dev fixture.
