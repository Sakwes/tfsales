-- Create product_views table to track individual product views
CREATE TABLE public.product_views (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  ip_address inet,
  user_agent text,
  viewed_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.product_views ENABLE ROW LEVEL SECURITY;

-- Anyone can insert product views (for tracking)
CREATE POLICY "Anyone can insert product views"
ON public.product_views
FOR INSERT
WITH CHECK (true);

-- Store owners can view their product views
CREATE POLICY "Store owners can view their product views"
ON public.product_views
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM stores
    WHERE stores.id = product_views.store_id
    AND stores.seller_id = auth.uid()
  )
  OR has_role(auth.uid(), 'admin'::app_role)
);

-- Create policy for anyone to insert store visitors
CREATE POLICY "Anyone can insert store visitors"
ON public.store_visitors
FOR INSERT
WITH CHECK (true);

-- Admins can view all store visitors
CREATE POLICY "Admins can view all visitors"
ON public.store_visitors
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Add email column to profiles table for admin dashboard
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;

-- Update profiles RLS to allow admins to view all profiles
CREATE POLICY "Admins can view all profiles"
ON public.profiles
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));