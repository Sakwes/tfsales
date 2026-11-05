import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AdminSubscription, AdminSubscriptionError, ManualCommand, PendingManualAction, applyManualSubscription, clearManualAction, formatWAT, parseWATInput, persistManualAction, toWATInput } from '@/lib/adminSubscriptions';

export function ManualSubscriptionDialog({record,action,actor,recovery,onClose,onApplied}:{
  record:AdminSubscription;action:'paid'|'free';actor:string;recovery?:PendingManualAction;onClose:()=>void;onApplied:()=>Promise<void>;
}){
  const [expiry,setExpiry]=useState(recovery?.command._expires_at?toWATInput(recovery.command._expires_at):record.plan==='paid'?toWATInput(record.expires_at):'');
  const [reason,setReason]=useState(recovery?.command._reason??'');
  const [acknowledged,setAcknowledged]=useState(Boolean(recovery));
  const [command,setCommand]=useState<ManualCommand|null>(recovery?.command??null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const inFlight=useRef(false),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const parsed=action==='paid'?Date.parse(expiry+':00+01:00'):null;
  const shortening=action==='paid'&&record.plan==='paid'&&record.expires_at&&Number.isFinite(parsed)&&parsed!<Date.parse(record.expires_at);
  const needsAck=action==='free'||Boolean(shortening);
  const apply=async(event:React.FormEvent)=>{
    event.preventDefault();if(inFlight.current)return;
    if(record.stored_status==='suspended'){setError('Resolve the suspended subscription separately before changing access.');return;}
    inFlight.current=true;setBusy(true);setError('');
    try{
      let request=command;
      if(!request){
        if(!reason.trim()||reason.trim().length>1000)throw new Error('A reason of 1–1000 characters is required.');
        if(needsAck&&!acknowledged)throw new Error('Confirm the effect on existing Paid access.');
        request={_store_id:record.store_id,_action:action,_expires_at:action==='paid'?parseWATInput(expiry):null,
          _reason:reason.trim(),_expected_revision:record.revision,_operation_id:crypto.randomUUID()};
        // Persist before sending, including the original revision, to recover ambiguous responses.
        persistManualAction({actor,record,command:request});setCommand(request);
      }
      const result=await applyManualSubscription(request);
      try{clearManualAction(actor);}catch{toast.warning('Action confirmed, but browser recovery storage could not be cleared. Inspect history before another action.');}
      if(!mounted.current)return;
      await onApplied();toast.success(result.replayed?'Previously applied action recovered.':'Subscription change confirmed.');onClose();
      // The caller refreshes authoritative state/history; replay never rewinds later actions.

    }catch(e){
      if(!mounted.current)return;
      const uncertain=e instanceof AdminSubscriptionError&&e.uncertain;
      if(!uncertain){try{clearManualAction(actor);}catch{/* leave recovery intact if storage is unavailable */}setCommand(null);}
      setError(e instanceof Error?e.message:'Subscription action failed.');
    }finally{inFlight.current=false;if(mounted.current)setBusy(false);}
  };
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader>
    <DialogTitle>{action==='paid'?'Grant Paid / set expiry':'Downgrade to Free'}</DialogTitle><DialogDescription>{record.store_name} · {record.seller_email??record.seller_id}</DialogDescription>
  </DialogHeader>
    <div className="text-sm space-y-2"><p>Current access: {record.plan==='paid'?'Paid':'Free'} · {formatWAT(record.expires_at)}</p>
      <p>Requested access: {action==='paid'?'Paid — up to 50 products':'Free — up to 12 products, indefinitely'}</p>
      <p>{record.saved_count} saved products and all images remain. Orders, payment requests and payment history are unchanged.</p>
      {!record.is_active&&<p role="alert">This store is inactive. This action will not reactivate the store or change account moderation.</p>}
      {record.pending_count>0&&<p role="alert">{record.pending_count} payment request(s) remain pending. Later explicit payment approval may reactivate or extend Paid access.</p>}
    </div>
    {command&&<p role="status">An action is awaiting a verified result. Inputs are locked; retry the same request. Closing or reloading keeps its recovery reference.</p>}
    <form onSubmit={apply} className="space-y-4"><fieldset disabled={busy||Boolean(command)} className="space-y-4">
      {action==='paid'&&<div><Label htmlFor="manual-expiry">Paid expiry — WAT (UTC+01:00)</Label><Input id="manual-expiry" type="datetime-local" value={expiry} onChange={e=>setExpiry(e.target.value)} required />
        {Number.isFinite(parsed)&&<p className="text-sm">Requested expiry: {formatWAT(new Date(parsed!).toISOString())}</p>}</div>}
      <div><Label htmlFor="manual-reason">Reason (required)</Label><Textarea id="manual-reason" value={reason} onChange={e=>setReason(e.target.value)} maxLength={1000} required /></div>
      {needsAck&&<Label className="flex gap-2 items-start"><input type="checkbox" checked={acknowledged} onChange={e=>setAcknowledged(e.target.checked)} />
        {action==='free'?'I understand that Free limits apply immediately and excess public products become hidden without deletion.':'I understand this shortens existing Paid access.'}</Label>}
    </fieldset>
      {error&&<p role="alert">{error}</p>}
      <div className="flex gap-3"><Button type="submit" disabled={busy||record.stored_status==='suspended'||(!command&&needsAck&&!acknowledged)}>{busy?'Applying…':command?'Retry same request':'Confirm subscription change'}</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Close and refresh</Button></div>
    </form>
  </DialogContent></Dialog>;
}
