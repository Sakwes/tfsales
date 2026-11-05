import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { AdminSubscription, PendingManualAction, formatWAT, listAdminSubscriptions, readManualAction } from '@/lib/adminSubscriptions';
import { ManualSubscriptionDialog } from '@/components/admin/ManualSubscriptionDialog';
import { SubscriptionHistory } from '@/components/admin/SubscriptionHistory';

export default function SellerSubscriptions(){
  const {user}=useAuth();const [params,setParams]=useSearchParams();
  const target=params.get('store');
  const [search,setSearch]=useState(''),[query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[page,setPage]=useState(0);
  const [rows,setRows]=useState<AdminSubscription[]>([]),[total,setTotal]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [recovery,setRecovery]=useState<PendingManualAction|null>(null),[recoveryError,setRecoveryError]=useState('');
  const [dialog,setDialog]=useState<{record:AdminSubscription;action:'paid'|'free';recovery?:PendingManualAction}|null>(null);
  const [history,setHistory]=useState<AdminSubscription|null>(null),[refreshKey,setRefreshKey]=useState(0);
  const readRecovery=useCallback(()=>{
    if(!user)return;
    try{setRecovery(readManualAction(user.id));setRecoveryError('');}catch(e){setRecoveryError(e instanceof Error?e.message:'Recovery unavailable.');}
  },[user]);
  useEffect(()=>{readRecovery();},[readRecovery]);
  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      if(target&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target))throw new Error('Invalid store link. Clear the store filter.');
      const result=await listAdminSubscriptions(query,filter,page,target);setRows(result.items);setTotal(result.total);
    }catch(e){setRows([]);setError(e instanceof Error?e.message:'Seller subscription access is unavailable.');}
    finally{setLoading(false);}
  },[query,filter,page,target]);
  useEffect(()=>{void load();},[load]);
  const applied=async()=>{readRecovery();setRefreshKey(k=>k+1);await load();};
  const close=()=>{setDialog(null);readRecovery();void load();};
  return <main className="max-w-6xl mx-auto p-4 md:p-8 space-y-6">
    <header><Link className="underline" to="/admin/subscriptions">Back to payments and settings</Link><h1 className="text-3xl font-bold mt-4">Seller subscription access</h1>
      <p>Administrative grants are separate from bank-transfer payments. Free allows 12 products; Paid allows 50. Saved catalogs are never deleted by these actions.</p></header>
    {recoveryError&&<p role="alert">{recoveryError}</p>}
    {recovery&&<Card className="p-4 space-y-2"><h2 className="font-semibold">Unconfirmed administrative action</h2><p>{recovery.record.store_name}: {recovery.command._action} · operation {recovery.command._operation_id}</p>
      <p>Recover this same request before starting another change. Retrying does not apply it twice.</p><div className="flex gap-3"><Button onClick={()=>setDialog({record:recovery.record,action:recovery.command._action,recovery})}>Recover same request</Button>
        <Button variant="outline" onClick={()=>setHistory(recovery.record)}>Inspect recovery history</Button></div></Card>}
    <form onSubmit={e=>{e.preventDefault();setQuery(search);setPage(0);}} className="flex flex-wrap gap-3 items-end">
      <div><Label htmlFor="seller-search">Search all sellers and stores</Label><Input id="seller-search" value={search} onChange={e=>setSearch(e.target.value)} maxLength={200} /></div>
      <div><Label htmlFor="subscription-filter">Effective subscription</Label><select id="subscription-filter" className="border rounded p-2 block" value={filter} onChange={e=>{setFilter(e.target.value);setPage(0);}}>{['all','free','paid','expired'].map(value=><option key={value} value={value}>{value}</option>)}</select></div>
      <Button type="submit">Search sellers</Button><Button type="button" variant="outline" onClick={()=>void load()}>Refresh access</Button>
      {target&&<Button type="button" variant="outline" onClick={()=>{setParams({});setPage(0);}}>Clear store filter</Button>}
    </form>
    {error&&<p role="alert">{error}</p>}
    {loading?<p role="status">Loading seller access…</p>:!error&&<><p>{total} matching stores · page {page+1}</p>
      <div className="space-y-4">{rows.map(row=><Card key={row.store_id} className="p-5 space-y-2">
        <h2 className="text-xl font-semibold">{row.store_name}</h2><p>{row.seller_email??row.seller_id}</p><p className="text-xs">Store ID: {row.store_id}</p>
        <p>Effective access: {row.plan==='paid'?'Paid':'Free'} · {row.effective_status} · expiry: {formatWAT(row.expires_at)}</p>
        <p>{row.saved_count} saved · {row.visible_count} publicly visible · allowance {row.allowance}</p><p>Entitlement source: {row.source}</p>
        {row.saved_count>row.allowance&&<p>{row.saved_count} saved products are preserved. Only up to {row.allowance} may be public; owners can change their selection.</p>}
        {row.stored_status==='suspended'&&<p role="alert">Subscription suspended. Resolve moderation separately; this screen will not clear it.</p>}
        <div className="flex flex-wrap gap-3"><Button disabled={Boolean(recovery)||Boolean(recoveryError)||row.stored_status==='suspended'} onClick={()=>setDialog({record:row,action:'paid'})}>Grant Paid / set expiry</Button>
          <Button variant="outline" disabled={Boolean(recovery)||Boolean(recoveryError)||row.stored_status==='suspended'||row.source==='implicit_free'||row.stored_status==='free'} onClick={()=>setDialog({record:row,action:'free'})}>Downgrade to Free</Button>
          <Button variant="outline" onClick={()=>setHistory(row)}>View subscription history</Button></div>
      </Card>)}</div>
      {rows.length===0&&<p>No matching sellers.</p>}<div className="flex items-center gap-3"><Button variant="outline" disabled={page===0} onClick={()=>setPage(p=>p-1)}>Previous sellers</Button><Button variant="outline" disabled={(page+1)*25>=total} onClick={()=>setPage(p=>p+1)}>Next sellers</Button></div>
    </>}
    {history&&<section aria-label="Selected seller history"><h2 className="text-xl font-semibold mb-3">History for {history.store_name}</h2><SubscriptionHistory key={history.store_id} storeId={history.store_id} refreshKey={refreshKey} /></section>}
    {dialog&&user&&<ManualSubscriptionDialog key={dialog.record.store_id+dialog.action+(dialog.recovery?.command._operation_id??dialog.record.revision)} {...dialog} actor={user.id} onClose={close} onApplied={applied} />}
  </main>;
}
