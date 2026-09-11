-- Store logos: readable by everyone (via signed URLs), writable only by the owning seller folder
DROP POLICY IF EXISTS "Store logos are readable" ON storage.objects;
CREATE POLICY "Store logos are readable"
ON storage.objects FOR SELECT TO anon, authenticated
USING (bucket_id = 'store-logos');

DROP POLICY IF EXISTS "Sellers upload their store logo" ON storage.objects;
CREATE POLICY "Sellers upload their store logo"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'store-logos'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Sellers update their store logo" ON storage.objects;
CREATE POLICY "Sellers update their store logo"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'store-logos' AND (auth.uid())::text = (storage.foldername(name))[1])
WITH CHECK (bucket_id = 'store-logos' AND (auth.uid())::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Sellers delete their store logo" ON storage.objects;
CREATE POLICY "Sellers delete their store logo"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'store-logos' AND (auth.uid())::text = (storage.foldername(name))[1]);

-- Payment proofs: private. Seller writes/reads own folder, admins read all.
DROP POLICY IF EXISTS "Sellers upload payment proof" ON storage.objects;
CREATE POLICY "Sellers upload payment proof"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'payment-proofs'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Sellers read own payment proof" ON storage.objects;
CREATE POLICY "Sellers read own payment proof"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'payment-proofs'
  AND (
    (auth.uid())::text = (storage.foldername(name))[1]
    OR public.has_role(auth.uid(), 'admin')
  )
);

-- Allow a seller to set branding row automatically when missing
CREATE INDEX IF NOT EXISTS reviews_status_idx ON public.reviews(store_id, status);
CREATE INDEX IF NOT EXISTS promotions_store_active_idx ON public.promotions(store_id, is_active);
CREATE INDEX IF NOT EXISTS orders_status_idx ON public.orders(status, created_at DESC);