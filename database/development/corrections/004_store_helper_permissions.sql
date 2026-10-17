-- DEVELOPMENT ONLY. Invoker store validation needs these pure text helpers.
DO $$ BEGIN
  IF current_setting('sellnova.dev_project_ref', true) IS DISTINCT FROM 'qfcnaceeppgrquoszkor' THEN
    RAISE EXCEPTION 'Development runner context required';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.sellnova_normalize_phone(text),
  public.sellnova_slugify(text) TO authenticated;
