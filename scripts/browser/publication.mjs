import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const origin='http://127.0.0.1:4176', api='http://127.0.0.1:54321';
const seller='11111111-1111-4111-8111-111111111111', store='22222222-2222-4222-8222-222222222222';
const paid='33333333-3333-4333-8333-333333333333';
const products=Array.from({length:15},(_,i)=>({id:`44444444-4444-4444-8444-${String(i+1).padStart(12,'0')}`,store_id:store,
 name:`Catalog ${String(i+1).padStart(2,'0')}`,description:'Mock catalog item',price:1000,images:[],is_available:true,track_stock:false,stock_quantity:0,low_stock_threshold:0,
 publication_selected:true,created_at:new Date(2020,0,i+1).toISOString()}));
let expires=Date.now()+3600000, version=1, selection=products.map(p=>p.id), failCatalog=false, checkouts=0;
const active=()=>Date.now()<expires;
const visible=()=>products.filter(p=>selection.includes(p.id)).slice(0,active()?100:12);
const state=()=>({plan:active()?'paid':'free',status:active()?'active':'expired',allowance:active()?100:12,saved_count:products.length,
 selected_ids:selection,visible_ids:visible().map(p=>p.id),version:`${version}:${active()?100:12}`,expires_at:new Date(expires).toISOString(),server_time:new Date().toISOString()});
const unexpected=[],calls=[];
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4176','--strictPort'],{
 env:{...process.env,SELLNOVA_ISOLATED_MOCKS:'1',VITE_SUPABASE_URL:api,VITE_SUPABASE_PUBLISHABLE_KEY:'mock-public-key'},stdio:['ignore','pipe','pipe']});
let log='';server.stdout.on('data',d=>log+=d);server.stderr.on('data',d=>log+=d);
let browser;
try {
 for(let i=0;;i++){try{if((await fetch(origin)).ok)break;}catch{/* starting */}if(i>100||server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({...(process.env.PLAYWRIGHT_CHROMIUM_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH}:{}),headless:true});
 const route=async route=>{
  const req=route.request(),u=new URL(req.url()),endpoint=u.pathname.split('/').pop();
  if(u.origin===origin)return route.continue();
  if(u.origin!==api){unexpected.push(req.url());return route.abort();}
  const owner=req.headers().authorization==='Bearer mock-access-token';
  const reply=(body,status=200,headers={})=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':origin,...headers},body:JSON.stringify(body)});
  if(req.method()==='OPTIONS')return reply({});
  if(u.pathname.includes('/rpc/')){
   const body=req.postDataJSON();calls.push({endpoint,body});
   if(endpoint==='sellnova_publication_state')return owner?reply(state()):reply({message:'Store ownership required'},400);
   if(endpoint==='sellnova_set_publication'){
    if(!owner||body._store_id!==store)return reply({message:'Store ownership required'},400);
    if(body._version!==state().version)return reply({message:'Products or plan changed; reload your selection'},400);
    if(body._selected.length>state().allowance)return reply({message:'Publication allowance exceeded'},400);
    if(new Set(body._selected).size!==body._selected.length||body._selected.some(id=>!products.some(p=>p.id===id)))return reply({message:'Invalid selection'},400);
    selection=body._selected;version++;return reply(state());
   }
   if(endpoint==='sellnova_storefront_products')return failCatalog?reply({message:'Mock outage'},500):reply(visible());
   if(endpoint==='sellnova_public_branding')return reply(active()?{entitled:true,primary_color:'#123456',accent_color:'#FF0000',background_color:null,logo_path:null}:{entitled:false});
   if(endpoint==='sellnova_create_order'){
    if(body._items.some(item=>!visible().some(p=>p.id===item.product_id)))return reply({message:'Product unavailable'},400);
    checkouts++;return reply({order_reference:'MOCK-ORDER',subtotal:1000,discount_total:0,total:1000,items:[{product_name:'Catalog',quantity:1,unit_price:1000,line_total:1000}]});
   }
   unexpected.push(endpoint);return route.abort();
  }
  if(u.pathname.startsWith('/auth/'))return reply({id:seller,role:'authenticated'});
  if(endpoint==='store_visitors'||endpoint==='product_views')return reply({});
  if(req.method()!=='GET'&&req.method()!=='HEAD'){unexpected.push(req.method()+' '+req.url());return route.abort();}
  if(endpoint==='stores')return reply({id:store,seller_id:seller,store_name:'Publication Store',slug:'publication-store',contact_phone:'08030000001',whatsapp_phone:'2348030000001'});
  if(endpoint==='user_roles')return reply(null);
  if(endpoint==='products'){
   let rows=owner?products:visible();
   if(u.searchParams.has('id'))rows=rows.filter(p=>'eq.'+p.id===u.searchParams.get('id'));
   return reply(rows.map(p=>({...p,publication_selected:selection.includes(p.id)})),200,{'content-range':`0-${Math.max(0,rows.length-1)}/${rows.length}`});
  }
  if(endpoint==='plans')return reply([{id:'free',code:'free',name:'Free',max_products:12,price_ngn:0,duration_days:3650},{id:paid,code:'paid',name:'Paid',max_products:100,price_ngn:1500,duration_days:30}]);
  if(endpoint==='store_subscriptions')return reply({store_id:store,plan_id:paid,status:'active',expires_at:new Date(expires).toISOString()});
  if(endpoint==='platform_settings')return reply({id:true,version:1,payment_collection_enabled:true});
  if(endpoint==='subscription_requests')return reply([]);
  unexpected.push(req.url());return route.abort();
 };
 const ownerContext=await browser.newContext();await ownerContext.route('**/*',route);
 await ownerContext.addInitScript(({seller})=>localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:'mock-access-token',refresh_token:'mock-refresh-token',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:seller,email:'mock@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}}})),{seller});
 const dashboard=await ownerContext.newPage();await dashboard.goto(origin+'/seller/dashboard');
 await expect(dashboard.getByText('15 saved · 15 publicly visible · allowance 100')).toBeVisible();
 // The hook's server-relative expiry timer refreshes without logout, navigation or focus.
 expires=Date.now()+1200;await dashboard.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(dashboard.getByText('15 saved · 12 publicly visible · allowance 12')).toBeVisible();
 await expect(dashboard.getByText('Free access has no time limit.',{exact:false})).toBeVisible();
 const first=dashboard.getByRole('checkbox',{name:/Catalog 01/}),thirteenth=dashboard.getByRole('checkbox',{name:/Catalog 13/});
 await expect(thirteenth).toBeDisabled();await first.uncheck();await thirteenth.check();
 await dashboard.getByRole('button',{name:'Save publication selection'}).click();
 await expect(dashboard.getByText('Publication selection saved. No products or images were deleted.')).toBeVisible();
 assert.equal(products.length,15);assert.equal(selection.length,12);assert.ok(!selection.includes(products[0].id));
 const forbidden=await dashboard.evaluate(async({api,store,ids,version})=>fetch(api+'/rest/v1/rpc/sellnova_set_publication',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer mock-access-token'},body:JSON.stringify({_store_id:store,_selected:ids,_version:version})}).then(r=>r.status),{api,store,ids:products.slice(0,13).map(p=>p.id),version:state().version});
 assert.equal(forbidden,400);
 console.log('PASS Paid expiry without logout, permanent Free, saved/visible counts, swap UI, retained records and over-cap rejection mock');

 const anonymous=await browser.newContext();await anonymous.route('**/*',route);
 await anonymous.addInitScript(({store,product})=>localStorage.setItem('sellnova:cart:'+store,JSON.stringify([{id:product.id,name:product.name,price:1000,image:null,quantity:1}])),{store,product:products[0]});
 const shop=await anonymous.newPage();await shop.goto(origin+'/store/publication-store');
 await expect(shop.getByRole('button',{name:'View details for Catalog 01'})).toHaveCount(0);
 await expect(shop.getByRole('button',{name:/View details for Catalog/})).toHaveCount(12);
 const direct=await shop.evaluate(async({api,id})=>fetch(api+'/rest/v1/products?id=eq.'+id,{headers:{authorization:'Bearer mock-public-key'}}).then(r=>r.json()),{api,id:products[0].id});assert.deepEqual(direct,[]);
 await shop.getByRole('button',{name:'Open cart, 1 item'}).click();
 await expect(shop.getByText('No longer public — remove before checkout')).toBeVisible();
 await shop.getByRole('button',{name:'Send order on WhatsApp'}).click();
 await expect(shop.getByText('Your cart contains products that are no longer public or available. Remove them before checkout.')).toBeVisible();
 await expect(shop.getByRole('heading',{name:'Checkout',exact:true})).toHaveCount(0);
 await shop.keyboard.press('Escape');
 console.log('PASS anonymous filtered catalog, hidden direct-link mock, retained old cart and blocked stale checkout');

 expires=Date.now()+3600000;await dashboard.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(dashboard.getByText('15 saved · 12 publicly visible · allowance 100')).toBeVisible();
 await shop.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect.poll(()=>shop.locator('header').evaluate(el=>getComputedStyle(el).backgroundImage)).toContain('rgb(18, 51, 84)');
 await expect(shop.getByRole('button',{name:/View details for Catalog/})).toHaveCount(12);
 for(const name of ['Catalog 01','Catalog 14','Catalog 15'])await dashboard.getByRole('checkbox',{name:new RegExp(name)}).check();
 await dashboard.getByRole('button',{name:'Save publication selection'}).click();
 await expect(dashboard.getByText('15 saved · 15 publicly visible · allowance 100')).toBeVisible();
 await shop.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(shop.getByRole('button',{name:/View details for Catalog/})).toHaveCount(15);
 console.log('PASS renewal restores allowance/branding, intentionally unpublished stays hidden until explicitly selected');

 // A product can become hidden after the checkout dialog has already opened.
 await shop.getByRole('button',{name:'Open cart, 1 item'}).click();
 await shop.getByRole('button',{name:'Clear cart',exact:true}).click();await shop.keyboard.press('Escape');
 const lastCard=shop.locator('li').filter({has:shop.getByRole('heading',{name:'Catalog 15',exact:true})});
 await lastCard.getByRole('button',{name:'Add',exact:true}).click();
 await shop.getByRole('button',{name:'Open cart, 1 item'}).click();await shop.getByRole('button',{name:'Send order on WhatsApp'}).click();
 await shop.getByLabel('Full name').fill('Mock Buyer');await shop.getByLabel('WhatsApp number',{exact:true}).fill('08030000003');await shop.getByLabel('Delivery address').fill('10 Synthetic Test Road');
 expires=Date.now()-1000;
 await shop.getByRole('button',{name:/Save order/}).click();
 await expect(shop.getByText(/Could not save your order: Product unavailable/)).toBeVisible();assert.equal(checkouts,0);
 console.log('PASS publication change during checkout leaves no saved order or WhatsApp receipt (server rejection mock)');
 // Existing checkout/receipt behavior still succeeds for an eligible item after renewal.
 expires=Date.now()+3600000;
 await shop.evaluate(()=>{window.open=()=>null;}); // Never send a real WhatsApp message.
 await shop.getByRole('button',{name:/Save order/}).click();
 await expect(shop.getByRole('heading',{name:'Order saved',exact:true})).toBeVisible();
 await expect(shop.getByRole('link',{name:'Open saved order in WhatsApp'})).toHaveAttribute('href',/MOCK-ORDER/);
 assert.equal(checkouts,1);
 const attempts=calls.filter(c=>c.endpoint==='sellnova_create_order');
 assert.equal(attempts[0].body._request_id,attempts[1].body._request_id);
 expires=Date.now()-1000;
 console.log('PASS eligible checkout retry, stable request UUID, saved receipt and WhatsApp link without external sending');

 await shop.keyboard.press('Escape');failCatalog=true;await shop.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(shop.getByRole('alert').filter({hasText:'We could not verify the current catalog'})).toBeVisible();
 await expect(shop.getByRole('button',{name:/View details for Catalog/})).toHaveCount(0);
 await dashboard.goto(origin+'/seller/subscription');
 await expect(dashboard.getByText('Your Paid subscription has expired. Free access continues indefinitely; you can request payment instructions below.')).toBeVisible();
 await expect(dashboard.getByRole('button',{name:'Get payment instructions'})).toBeEnabled();
 expires=Date.now()+3600000;await dashboard.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(dashboard.getByRole('heading',{name:'Current plan: Paid'})).toBeVisible();
 await expect(dashboard.getByRole('button',{name:'Get payment instructions'})).toBeDisabled();
 await expect(dashboard.getByText(/Paid access ends/)).toBeVisible();
 assert.deepEqual(unexpected,[]);
 console.log('PASS catalog failure is closed, with no external requests, uploads or record deletions');
} finally {await browser?.close();server.kill();}
