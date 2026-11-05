import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const origin='http://127.0.0.1:4177',api='http://127.0.0.1:54321';
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',seller='11111111-1111-4111-8111-111111111111',store='22222222-2222-4222-8222-222222222222';
let role='admin',stale=false,lost=false,malformed=false;
let record={store_id:store,seller_id:seller,store_name:'Preserved Catalog',seller_email:'seller@example.test',plan:'free',stored_status:'active',effective_status:'expired',expires_at:new Date(Date.now()-86400000).toISOString(),source:'payment',revision:'0',saved_count:75,selected_count:75,visible_count:12,allowance:12,is_active:true,pending_count:1};
const pendingPayments=[{id:'existing-payment',status:'pending',amount:1500}],beforePayments=structuredClone(pendingPayments);
const history=[],operations=new Map(),calls=[],unexpected=[];
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4177','--strictPort'],{env:{...process.env,SELLNOVA_ISOLATED_MOCKS:'1',VITE_SUPABASE_URL:api,VITE_SUPABASE_PUBLISHABLE_KEY:'mock-public-key'},stdio:['ignore','pipe','pipe']});
let log='';server.stdout.on('data',d=>log+=d);server.stderr.on('data',d=>log+=d);let browser;
try{
 for(let i=0;;i++){try{if((await fetch(origin)).ok)break;}catch{/* starting */}if(i>100||server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({...(process.env.PLAYWRIGHT_CHROMIUM_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH}:{}),headless:true});
 const context=await browser.newContext();await context.addInitScript(({actor})=>localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:'mock-admin-token',refresh_token:'mock-refresh',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:actor,aud:'authenticated',role:'authenticated',email:'admin@example.test',app_metadata:{},user_metadata:{}}})),{actor});
 await context.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url()),endpoint=u.pathname.split('/').pop();
  if(u.origin===origin)return route.continue();if(u.origin!==api){unexpected.push(req.url());return route.abort();}
  const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':origin},body:JSON.stringify(body)});
  if(req.method()==='OPTIONS')return reply({});
  if(u.pathname.startsWith('/auth/'))return reply({id:actor,role:'authenticated'});
  if(u.pathname.includes('/rpc/')){
   const body=req.postDataJSON();calls.push({endpoint,body});
   if(endpoint.startsWith('sellnova_admin_')&&role!=='admin')return reply({message:'Administrator required'},403);
   if(endpoint==='sellnova_admin_list_subscriptions')return reply({schema_version:1,total:1,items:[malformed?{...record,plan:'paid',allowance:100}:record]});
   if(endpoint==='sellnova_admin_subscription_history')return reply({total:history.length,items:[...history].reverse()});
   if(endpoint==='sellnova_admin_set_subscription'){
    assert.deepEqual(Object.keys(body).sort(),['_action','_expected_revision','_expires_at','_operation_id','_reason','_store_id'].sort());
    assert.equal(body._store_id,store);assert.ok(body._reason.trim());
    if(operations.has(body._operation_id)){const prior=operations.get(body._operation_id);assert.deepEqual(body,prior.command);return reply({...prior.result,replayed:true});}
    if(stale){record={...record,revision:String(Number(record.revision)+1)};stale=false;}
    if(body._expected_revision!==record.revision)return reply({code:'P0001',message:'Subscription changed; reload before saving'},400);
    if(body._action==='paid'&&(!body._expires_at||Date.parse(body._expires_at)<=Date.now()))return reply({message:'Future expiry required'},400);
    const previous=structuredClone(record);
    record={...record,plan:body._action,stored_status:body._action==='paid'?'active':'free',effective_status:body._action==='paid'?'active':'free',expires_at:body._action==='paid'?body._expires_at:null,source:'admin',revision:String(Number(record.revision)+1),allowance:body._action==='paid'?50:12,visible_count:body._action==='paid'?50:12};
    const result={operation_id:body._operation_id,replayed:false,subscription:structuredClone(record)};
    operations.set(body._operation_id,{command:structuredClone(body),result});
    history.push({id:'event-'+history.length,actor_id:actor,actor_label:'admin@example.test',action:'subscription.manual_'+body._action,created_at:new Date().toISOString(),reason:body._reason,before:{plan:previous.plan,status:previous.stored_status,expires_at:previous.expires_at},after:{plan:record.plan,status:record.stored_status,expires_at:record.expires_at},source:'admin'});
    if(lost){lost=false;return reply({message:'Connection lost after application'},503);}
    return reply(result);
   }
   if(endpoint==='sellnova_publication_state')return reply({plan:record.plan,status:record.effective_status,allowance:record.allowance,saved_count:75,selected_ids:[],visible_ids:[],version:'mock',expires_at:record.expires_at,server_time:new Date().toISOString()});
   unexpected.push(endpoint);return route.abort();
  }
  if(req.method()!=='GET'&&req.method()!=='HEAD'){unexpected.push(req.method()+' '+req.url());return route.abort();}
  if(endpoint==='user_roles')return reply(role==='admin'?{role:'admin'}:null);
  if(endpoint==='stores')return reply({id:store,seller_id:seller,store_name:'Preserved Catalog',contact_phone:'08030000001',slug:'preserved-catalog'});
  if(endpoint==='products')return reply([]);
  if(endpoint==='platform_settings')return reply({id:true,version:1,bank_name:null,account_name:null,account_number:null,payment_instructions:null,payment_collection_enabled:false});
  if(endpoint==='plans')return reply({price_ngn:1500,duration_days:30});
  if(endpoint==='subscription_requests'||endpoint==='admin_audit_log')return reply([]);
  unexpected.push(req.url());return route.abort();
 });
 const page=await context.newPage();await page.goto(origin+'/admin/subscriptions/manage?store='+store);
 await expect(page.getByRole('heading',{name:'Seller subscription access'})).toBeVisible();
 await expect(page.getByText('75 saved · 12 publicly visible · allowance 12')).toBeVisible();
 // Date conversion tests execute the real shared helper, not a duplicate date implementation.
 const dates=await page.evaluate(async()=>{const m=await import('/src/lib/adminSubscriptions.ts');const now=Date.UTC(2026,10,4);let invalid=0;for(const value of ['2030-02-30T12:00','2020-01-01T12:00','infinity',''])try{m.parseWATInput(value,now);}catch{invalid++;}return {utc:m.parseWATInput('2030-01-01T00:30',now),local:m.toWATInput('2029-12-31T23:30:00.000Z'),invalid};});
 assert.deepEqual(dates,{utc:'2029-12-31T23:30:00.000Z',local:'2030-01-01T00:30',invalid:4});
 await page.getByRole('button',{name:'Grant Paid / set expiry'}).click();
 await page.getByLabel('Paid expiry — WAT (UTC+01:00)').fill('2030-12-31T20:30');
 await page.getByLabel('Reason (required)').fill('Approved manual access');
 await expect(page.getByText(/1 payment request\(s\) remain pending/)).toBeVisible();
 await page.getByRole('button',{name:'Confirm subscription change'}).click();
 await expect(page.getByText('75 saved · 50 publicly visible · allowance 50')).toBeVisible();
 assert.equal(record.expires_at,'2030-12-31T19:30:00.000Z');assert.equal(record.saved_count,75);assert.equal(history.length,1);
 await page.getByRole('button',{name:'View subscription history'}).click();
 await expect(page.getByText('Administrator: admin@example.test')).toBeVisible();await expect(page.getByText('Reason: Approved manual access')).toBeVisible();
 console.log('PASS Free-to-Paid UI, explicit WAT expiry, 50 limit without Free misclassification, preserved 75 records and administrator history');

 await page.getByRole('button',{name:'Grant Paid / set expiry'}).click();await page.getByLabel('Paid expiry — WAT (UTC+01:00)').fill('2029-12-31T20:30');await page.getByLabel('Reason (required)').fill('Correct expiration');
 await expect(page.getByRole('button',{name:'Confirm subscription change'})).toBeDisabled();await page.getByRole('checkbox',{name:'I understand this shortens existing Paid access.'}).check();await page.getByRole('button',{name:'Confirm subscription change'}).click();
 await expect(page.getByText('expiry: 31 Dec 2029',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Downgrade to Free'}).click();await page.getByLabel('Reason (required)').fill('Manual downgrade');
 await page.getByRole('checkbox',{name:/I understand that Free limits apply immediately/}).check();await page.getByRole('button',{name:'Confirm subscription change'}).click();
 await expect(page.getByText('75 saved · 12 publicly visible · allowance 12')).toBeVisible();assert.equal(record.expires_at,null);assert.equal(history.length,3);assert.deepEqual(pendingPayments,beforePayments);
 console.log('PASS shortening/downgrade confirmations, indefinite Free, before/after history and untouched pending-payment mock');

 await page.getByRole('button',{name:'Grant Paid / set expiry'}).click();await page.getByLabel('Paid expiry — WAT (UTC+01:00)').fill('2031-12-31T20:30');await page.getByLabel('Reason (required)').fill('Stale action');stale=true;
 await page.getByRole('button',{name:'Confirm subscription change'}).click();await expect(page.getByText('Subscription changed; reload before saving')).toBeVisible();assert.equal(history.length,3);
 await page.getByRole('button',{name:'Close and refresh'}).click();
 await page.getByRole('button',{name:'Grant Paid / set expiry'}).click();await page.getByLabel('Paid expiry — WAT (UTC+01:00)').fill('2031-12-31T20:30');await page.getByLabel('Reason (required)').fill('Recover uncertain action');lost=true;
 await page.getByRole('button',{name:'Confirm subscription change'}).click();await expect(page.getByRole('button',{name:'Retry same request'})).toBeVisible();assert.equal(history.length,4);
 const savedOperation=[...operations.keys()].at(-1);
 await page.reload();await page.getByRole('button',{name:'Recover same request'}).click();
 // A newer change must survive recovery of the older command response.
 record={...record,expires_at:'2034-01-01T00:00:00.000Z',revision:String(Number(record.revision)+1)};
 await page.getByRole('button',{name:'Retry same request'}).click();await expect(page.getByText('Unconfirmed administrative action')).toHaveCount(0);
 await expect(page.getByText('expiry: 1 Jan 2034',{exact:false})).toBeVisible();assert.equal(history.length,4);
 assert.equal(calls.filter(c=>c.endpoint==='sellnova_admin_set_subscription'&&c.body._operation_id===savedOperation).length,2);
 console.log('PASS stale-revision rejection, persisted idempotent recovery across reload and no overwrite of a newer entitlement');

 malformed=true;await page.getByRole('button',{name:'Refresh access'}).click();await expect(page.getByText('Unsupported subscription-management response. No local entitlement was changed.')).toBeVisible();
 await expect(page.getByRole('button',{name:'Grant Paid / set expiry'})).toHaveCount(0);
 await page.getByRole('link',{name:'Back to payments and settings'}).click();await expect(page.getByRole('heading',{name:'Subscriptions and payments'})).toBeVisible();await expect(page.getByRole('button',{name:'Save payment settings'})).toBeVisible();
 role='seller';await page.goto(origin+'/admin/subscriptions/manage');await page.waitForURL('**/seller/dashboard');
 const denied=await page.evaluate(async({api,store})=>fetch(api+'/rest/v1/rpc/sellnova_admin_set_subscription',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer mock-admin-token'},body:JSON.stringify({_store_id:store})}).then(r=>r.status),{api,store});assert.equal(denied,403);
 assert.deepEqual(unexpected,[]);assert.deepEqual(pendingPayments,beforePayments);
 console.log('PASS unsupported 100-product backend rejected, existing payment page preserved, unauthorized routing/RPC mock and no direct writes/legacy setter/external traffic');
}finally{await browser?.close();server.kill();}
