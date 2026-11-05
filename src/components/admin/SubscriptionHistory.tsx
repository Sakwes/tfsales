import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SubscriptionHistory as History, formatWAT, loadAdminSubscriptionHistory } from '@/lib/adminSubscriptions';
export function SubscriptionHistory({storeId,refreshKey=0}:{storeId:string;refreshKey?:number}){
  const [page,setPage]=useState(0),[data,setData]=useState<History|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{setPage(0);},[storeId]);
  useEffect(()=>{let active=true;setError('');setData(null);void loadAdminSubscriptionHistory(storeId,page).then(result=>{if(active)setData(result);}).catch(e=>{if(active)setError(e instanceof Error?e.message:'History unavailable.');});return()=>{active=false;};},[storeId,page,refreshKey,retry]);
  return <Card className="p-5 space-y-3"><h2 className="text-xl font-semibold">Subscription change history</h2>
    {error?<p role="alert">{error}<Button variant="outline" onClick={()=>setRetry(n=>n+1)}>Retry history</Button></p>:!data?<p role="status">Loading history…</p>:<>
      {data.items.length===0&&<p>No recorded changes. Legacy details are not invented.</p>}
      <ol className="space-y-4">{data.items.map(event=><li key={event.id} className="border rounded p-4 space-y-1">
        <p className="font-semibold">{event.action} · {formatWAT(event.created_at)}</p><p>Administrator: {event.actor_label??event.actor_id??'Unknown (legacy record)'}</p>
        {event.actor_label&&event.actor_id&&<p className="text-xs">Actor ID: {event.actor_id}</p>}
        <p>Reason: {event.reason??'Not recorded (legacy)'}</p>
        <p>Before: {event.before?`${event.before.plan} · ${formatWAT(event.before.expires_at)}`:'Not recorded'}</p>
        <p>After: {event.after?`${event.after.plan} · ${formatWAT(event.after.expires_at)}`:'Not recorded'}</p><p>Source: {event.source}</p>
      </li>)}</ol>
      <div className="flex gap-3 items-center"><Button variant="outline" disabled={page===0} onClick={()=>setPage(p=>p-1)}>Previous history</Button><p>Page {page+1} · {data.total} changes</p><Button variant="outline" disabled={(page+1)*25>=data.total} onClick={()=>setPage(p=>p+1)}>Next history</Button></div>
    </>}
  </Card>;
}
