import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Branding } from "@/lib/branding";

const publicBranding = z.object({
  entitled: z.literal(true),
  primary_color: z.string().nullable(),
  accent_color: z.string().nullable(),
  background_color: z.string().nullable(),
  logo_path: z.string().nullable(),
});

/** Public RPC determines entitlement; private logos use RLS-authorized signed URLs. */
export function useStoreBranding(storeId: string | undefined) {
  const [branding, setBranding] = useState<Branding | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    let generation = 0;
    setBranding(null);
    setLogoUrl(null);
    if (!storeId) return;
    const refresh = async () => {
      const current = ++generation;
      try {
        const result = await supabase.rpc("sellnova_public_branding", { _store_id: storeId });
        if (disposed || current !== generation) return;
        const parsed = publicBranding.safeParse(result.error ? null : result.data);
        if (!parsed.success) { setBranding(null); setLogoUrl(null); return; }
        setBranding({
          primary_color: parsed.data.primary_color ?? null,
          accent_color: parsed.data.accent_color ?? null,
          background_color: parsed.data.background_color ?? null,
          logo_path: parsed.data.logo_path ?? null,
        });
        if (!parsed.data.logo_path) { setLogoUrl(null); return; }
        const signed = await supabase.storage.from("store-logos").createSignedUrl(parsed.data.logo_path, 600);
        if (!disposed && current === generation) setLogoUrl(signed.data?.signedUrl ?? null);
      } catch {
        if (!disposed && current === generation) { setBranding(null); setLogoUrl(null); }
      }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    void refresh();
    // Also re-evaluate expiry and renew signed URLs before their ten-minute TTL.
    const timer = window.setInterval(() => void refresh(), 60_000);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [storeId]);
  return { branding, logoUrl, clearLogo: () => setLogoUrl(null) };
}
