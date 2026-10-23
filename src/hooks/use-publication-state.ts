import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { message } from "@/lib/billing";
import { PublicationState, publicationStateSchema } from "@/lib/publication";

export function usePublicationState(storeId: string | null | undefined) {
  const [state, setState] = useState<PublicationState | null>(null);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (!storeId) return;
    const token = ++generation.current;
    try {
      const result = await supabase.rpc("sellnova_publication_state", { _store_id: storeId });
      if (token !== generation.current) return;
      if (result.error) throw result.error;
      const parsed = publicationStateSchema.parse(result.data) as PublicationState;
      setState(parsed); setError("");
      return parsed;
    } catch (e) { if (token === generation.current) setError(message(e)); }
  }, [storeId]);
  const invalidate = useCallback(() => { generation.current++; }, []);
  useEffect(() => {
    setState(null); setError(""); void refresh();
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(visible, 15_000);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => { invalidate(); window.clearInterval(timer); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); };
  }, [refresh, invalidate]);
  useEffect(() => {
    if (!state?.expires_at) return;
    const remaining = Date.parse(state.expires_at) - Date.parse(state.server_time);
    if (remaining <= 0 || remaining > 2_147_480_000) return;
    const timer = window.setTimeout(() => void refresh(), remaining + 100);
    return () => window.clearTimeout(timer);
  }, [state, refresh]);
  return { state, error, refresh };
}
