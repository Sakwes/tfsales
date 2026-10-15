-- DEVELOPMENT ONLY. Metadata/policies only; never copy real objects or proofs.
DO $$ BEGIN
  IF current_setting('sellnova.dev_project_ref', true) IS DISTINCT FROM 'qfcnaceeppgrquoszkor' THEN
    RAISE EXCEPTION 'Development runner context required';
  END IF;
END $$;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES
 ('product-images','product-images',true,5242880,ARRAY['image/jpeg','image/png','image/webp']),
 ('store-logos','store-logos',false,2097152,ARRAY['image/jpeg','image/png','image/webp']),
 ('payment-proofs','payment-proofs',false,5242880,ARRAY['image/jpeg','image/png','application/pdf'])
ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,public=EXCLUDED.public,
 file_size_limit=EXCLUDED.file_size_limit,allowed_mime_types=EXCLUDED.allowed_mime_types;

-- Product images are public assets. All mutations remain owner-folder scoped;
-- explicitly check the new path on UPDATE as well as the old path.
DROP POLICY "Users can update their own images" ON storage.objects;
CREATE POLICY "Users can update their own images" ON storage.objects FOR UPDATE TO authenticated
USING(bucket_id='product-images' AND (storage.foldername(name))[1]=auth.uid()::text)
WITH CHECK(bucket_id='product-images' AND (storage.foldername(name))[1]=auth.uid()::text);
-- Existing insert/delete policies already scope the user folder after Release 1.
-- Logos use signed URLs from a private bucket, but are intentionally readable only
-- for active entitled stores, or by the owner/admin (not all uploaded files).
DROP POLICY "Store logos are readable" ON storage.objects;
CREATE POLICY "Store logos are readable" ON storage.objects FOR SELECT TO anon,authenticated
USING(bucket_id='store-logos' AND (
 (storage.foldername(name))[1]=auth.uid()::text OR public.has_role(auth.uid(),'admin')
 OR EXISTS(SELECT 1 FROM public.stores s WHERE s.seller_id::text=(storage.foldername(name))[1]
   AND s.is_active AND (public.sellnova_effective_plan(s.id)).allow_branding)));
-- Payment proof bucket stays private. Historical insert/select policies permit
-- own-folder uploads and owner/admin reads; no public SELECT or client UPDATE.
