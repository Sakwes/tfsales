import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { usePublicationState } from "@/hooks/use-publication-state";
import { PublicationState } from "@/lib/publication";
import { message } from "@/lib/billing";

export function PublicationControls({ storeId, products, onState, onSaved }: {
  storeId: string; products: { id: string; name: string }[];
  onState: (state: PublicationState | null) => void; onSaved: () => Promise<void>;
}) {
  const { state, error, refresh } = usePublicationState(storeId);
  const [chosen, setChosen] = useState<string[]>([]);
  const [version, setVersion] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => { onState(error ? null : state); }, [state, error, onState]);
  useEffect(() => {
    if (!state || dirty) return;
    // Until explicitly saved, over-limit Paid selections stay preserved in the DB.
    setChosen(state.selected_ids.length > state.allowance ? state.visible_ids : state.selected_ids);
    setVersion(state.version);
  }, [state, dirty]);
  const save = async () => {
    if (!state) return;
    setBusy(true); setNotice("");
    try {
      const result = await supabase.rpc("sellnova_set_publication", { _store_id: storeId, _selected: chosen, _version: version });
      if (result.error) throw result.error;
      setDirty(false); await refresh(); await onSaved(); setNotice("Publication selection saved. No products or images were deleted.");
    } catch (e) { setNotice(message(e)); await refresh(); } finally { setBusy(false); }
  };
  return <Card className="p-6 mb-6 space-y-4">
    <h2 className="text-xl font-semibold">Product publication</h2>
    {error ? <div role="alert">{error}<Button variant="outline" onClick={() => void refresh()}>Refresh publication</Button></div> : !state ? <p role="status">Checking publication allowance…</p> : <>
      <p>Current plan: {state.plan === "paid" ? "Paid" : "Free"}{state.status === "expired" ? " — Paid subscription expired" : ""}</p>
      <p>{state.saved_count} saved · {state.visible_ids.length} publicly visible · allowance {state.allowance}</p>
      {state.plan === "free" && <p>Free access has no time limit. <Link className="underline" to="/seller/subscription">Upgrade for up to 100 products</Link>.</p>}
      <p>Choose which products customers can see. Uncheck one before selecting a replacement. Saving replaces your publication selection; it never deletes products or images.</p>
      {state.selected_ids.length > state.allowance && <p role="status">Your earlier selection is preserved. The oldest {state.allowance} selected products are visible until you save a different selection.</p>}
      {dirty && state.version !== version && <p role="alert">Products or your plan changed. Reload the selection before saving.</p>}
      <fieldset disabled={busy || Boolean(error)} className="grid sm:grid-cols-2 gap-3"><legend className="font-medium mb-2">Products selected for publication ({chosen.length}/{state.allowance})</legend>
        {products.map(p => <label key={p.id} className="border rounded p-3 flex gap-2 items-start">
          <input type="checkbox" checked={chosen.includes(p.id)} disabled={!chosen.includes(p.id) && chosen.length >= state.allowance}
            onChange={e => { setChosen(ids => e.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id)); setDirty(true); setNotice(""); }} />
          <span>{p.name}<span className="block text-sm text-muted-foreground">{state.visible_ids.includes(p.id) ? "Publicly visible" : state.selected_ids.includes(p.id) ? "Hidden by plan limit" : "Hidden by you"}</span></span>
        </label>)}
      </fieldset>
      <div className="flex gap-3"><Button disabled={busy || !dirty || chosen.length > state.allowance || state.version !== version} onClick={() => void save()}>{busy ? "Saving…" : "Save publication selection"}</Button>
        <Button variant="outline" disabled={busy} onClick={() => { setDirty(false); void refresh(); }}>Reload selection</Button></div>
    </>}
    {notice && <p role="status">{notice}</p>}
  </Card>;
}
