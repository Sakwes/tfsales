import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';

const instant=z.string().datetime({offset:true});
const snapshot = z.object({ plan: z.enum(['free','paid']), status: z.string(), expires_at: instant.nullable() });
export const adminSubscriptionSchema = z.object({
  store_id:z.string().uuid(), seller_id:z.string().uuid(), store_name:z.string(), seller_email:z.string().nullable(),
  plan:z.enum(['free','paid']), stored_status:z.string(), effective_status:z.string(), expires_at:instant.nullable(),
  source:z.enum(['admin','payment','legacy','implicit_free']), revision:z.string().min(1),
  saved_count:z.number().int().nonnegative(), selected_count:z.number().int().nonnegative(),
  visible_count:z.number().int().nonnegative(), allowance:z.union([z.literal(12),z.literal(50)]),
  is_active:z.boolean(), pending_count:z.number().int().nonnegative(),
}).superRefine((value,context)=>{
  if((value.plan==='paid'&&value.allowance!==50)||(value.plan==='free'&&value.allowance!==12)||value.visible_count>value.allowance||value.selected_count>value.saved_count||value.visible_count>value.selected_count)
    context.addIssue({code:z.ZodIssueCode.custom,message:'Inconsistent entitlement or publication counts'});
});
export type AdminSubscription = z.infer<typeof adminSubscriptionSchema>;
const listSchema=z.object({schema_version:z.literal(1),total:z.number().int().nonnegative(),items:z.array(adminSubscriptionSchema)});
const historySchema=z.object({total:z.number().int().nonnegative(),items:z.array(z.object({
  id:z.string(),actor_id:z.string().nullable(),actor_label:z.string().nullable(),action:z.string(),created_at:instant,
  reason:z.string().nullable(),before:snapshot.nullable(),after:snapshot.nullable(),source:z.string(),
}))});
export type SubscriptionHistory = z.infer<typeof historySchema>;
const commandSchema=z.object({_store_id:z.string().uuid(),_action:z.enum(['paid','free']),_expires_at:instant.nullable(),
  _reason:z.string().min(1).max(1000),_expected_revision:z.string().min(1),_operation_id:z.string().uuid()});
export interface ManualCommand { _store_id:string; _action:'paid'|'free'; _expires_at:string|null;
  _reason:string; _expected_revision:string; _operation_id:string; }
const pendingSchema=z.object({actor:z.string(),record:adminSubscriptionSchema,command:commandSchema});
export interface PendingManualAction { actor:string; record:AdminSubscription; command:ManualCommand; }
const resultSchema=z.object({operation_id:z.string().uuid(),replayed:z.boolean(),subscription:adminSubscriptionSchema});

export class AdminSubscriptionError extends Error {
  constructor(message:string,public uncertain=false){super(message);}
}
function rpcError(error:{message:string;code?:string},status:number):never {
  throw new AdminSubscriptionError(error.code==='PGRST202'?'Subscription management is unavailable until its reviewed database update is applied.':error.message,status===0||status>=500);
}
function parse<T>(schema:z.ZodType<T>,value:unknown):T {
  const result=schema.safeParse(value);
  if(!result.success)throw new AdminSubscriptionError('Unsupported subscription-management response. No local entitlement was changed.');
  return result.data;
}
export async function listAdminSubscriptions(search:string,filter:string,page:number,storeId:string|null=null){
  const r=await supabase.rpc('sellnova_admin_list_subscriptions',{_search:search.trim(),_filter:filter,_offset:page*25,_limit:25,_store_id:storeId});
  if(r.error)rpcError(r.error,r.status);
  return parse(listSchema,r.data);
}
export async function loadAdminSubscriptionHistory(storeId:string,page:number){
  const r=await supabase.rpc('sellnova_admin_subscription_history',{_store_id:storeId,_offset:page*25,_limit:25});
  if(r.error)rpcError(r.error,r.status);
  return parse(historySchema,r.data);
}
export async function applyManualSubscription(command:ManualCommand){
  let r;
  try{r=await supabase.rpc('sellnova_admin_set_subscription',command);}catch{throw new AdminSubscriptionError('The action result is unknown. Retry the same request to recover safely.',true);}
  if(r.error)rpcError(r.error,r.status);
  const result=resultSchema.safeParse(r.data);
  if(!result.success||result.data.operation_id!==command._operation_id)throw new AdminSubscriptionError('The action result could not be verified. Retry the same request.',true);
  return result.data;
}
export function formatWAT(value:string|null|undefined){
  if(!value)return 'No expiry';
  return new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Lagos',dateStyle:'medium',timeStyle:'short'}).format(new Date(value))+' WAT';
}
export function toWATInput(value:string|null|undefined){
  if(!value)return '';
  const date=new Date(value);if(!Number.isFinite(date.getTime()))return '';
  return new Date(date.getTime()+3600000).toISOString().slice(0,16);
}
export function parseWATInput(value:string,now=Date.now()){
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value))throw new Error('Choose a valid Paid expiry date and time.');
  const date=new Date(value+':00+01:00');
  if(!Number.isFinite(date.getTime())||toWATInput(date.toISOString())!==value)throw new Error('Choose a valid Paid expiry date and time.');
  if(date.getTime()<=now)throw new Error('Paid expiry must be in the future. The server will verify it again.');
  return date.toISOString();
}
const storageKey=(actor:string)=>'sellnova:admin-subscription-operation:'+actor;
export function persistManualAction(value:PendingManualAction){
  const valid=parse(pendingSchema,value);
  const text=JSON.stringify(valid);sessionStorage.setItem(storageKey(valid.actor),text);
  if(sessionStorage.getItem(storageKey(valid.actor))!==text)throw new Error('Browser storage is required to safely recover this action.');
}
export function readManualAction(actor:string):PendingManualAction|null{
  const value=sessionStorage.getItem(storageKey(actor));if(!value)return null;
  const result=pendingSchema.safeParse(JSON.parse(value));
  if(!result.success||result.data.actor!==actor||result.data.command._store_id!==result.data.record.store_id)throw new Error('An unrecognized pending action exists. Inspect subscription history before clearing browser storage.');
  return result.data as PendingManualAction;
}
export function clearManualAction(actor:string){sessionStorage.removeItem(storageKey(actor));}
