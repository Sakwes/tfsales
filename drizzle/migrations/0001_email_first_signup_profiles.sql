-- Allow email-first signup: phone becomes optional, blanks become NULL
ALTER TABLE public.profiles ALTER COLUMN phone DROP NOT NULL;

UPDATE public.profiles SET phone = NULL WHERE phone IS NOT NULL AND btrim(phone) = '';

UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE u.id = p.id
  AND (p.email IS NULL OR btrim(p.email) = '')
  AND u.email IS NOT NULL;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  raw_phone text;
  norm_phone text;
BEGIN
  raw_phone := btrim(coalesce(new.raw_user_meta_data->>'phone', new.phone, ''));

  IF raw_phone = '' THEN
    norm_phone := NULL;
  ELSE
    norm_phone := nullif(public.sellnova_normalize_phone(raw_phone), '');
  END IF;

  INSERT INTO public.profiles (id, phone, email)
  VALUES (new.id, norm_phone, new.email)
  ON CONFLICT (id) DO UPDATE
    SET email = COALESCE(EXCLUDED.email, public.profiles.email),
        phone = COALESCE(public.profiles.phone, EXCLUDED.phone);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (new.id, 'seller')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN new;
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO service_role;
GRANT ALL ON public.user_roles TO service_role;
