import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const origin = 'http://127.0.0.1:4175', api = 'http://127.0.0.1:54321';
const store = '22222222-2222-4222-8222-222222222222';
const seller = '11111111-1111-4111-8111-111111111111';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4175', '--strictPort'], {
  env: { ...process.env, SELLNOVA_ISOLATED_MOCKS: '1', VITE_SUPABASE_URL: api, VITE_SUPABASE_PUBLISHABLE_KEY: 'mock-public-key' }, stdio: ['ignore', 'pipe', 'pipe']
});
let log = ''; server.stdout.on('data', d => log += d); server.stderr.on('data', d => log += d);
let browser;
try {
  for (let i=0;;i++) {
    try { if ((await fetch(origin)).ok) break; } catch { /* starting */ }
    if (i>100 || server.exitCode!==null) throw new Error('Mock server failed: '+log);
    await new Promise(r => setTimeout(r,100));
  }
  browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}), headless: true });
  for (const authenticated of [false,true]) {
    const context = await browser.newContext();
    if (authenticated) await context.addInitScript(({seller}) => localStorage.setItem('sb-127-auth-token', JSON.stringify({
      access_token:'mock-access-token',refresh_token:'mock-refresh-token',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,
      user:{id:seller,aud:'authenticated',role:'authenticated',email:'mock@example.test',app_metadata:{},user_metadata:{}}
    })),{seller});
    let entitled=true, main='#123456', accent='#FF0000', path=`${seller}/saved-logo.png`, failLogo=false, failRpc=false;
    let signs=0, publicReads=0;
    const unexpected=[];
    await context.route('**/*',async route=>{
      const req=route.request(), u=new URL(req.url());
      if(u.origin===origin) return route.continue();
      if(u.origin!==api) {unexpected.push(req.url());return route.abort();}
      const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
      if(req.method()==='OPTIONS') return reply({});
      if(u.pathname.includes('/rpc/sellnova_public_branding')) {
        publicReads++;
        assert.deepEqual(req.postDataJSON(),{_store_id:store});
        assert.equal(req.headers().authorization, 'Bearer '+(authenticated?'mock-access-token':'mock-public-key'));
        if(failRpc) return reply({message:'mock failure'},500);
        return reply(entitled?{entitled:true,primary_color:main,accent_color:accent,background_color:'#EEEEEE',logo_path:path}:{entitled:false});
      }
      if(req.method()==='POST' && u.pathname.includes('/object/sign/store-logos/')) {
        signs++; assert.equal(req.postDataJSON().expiresIn,600);
        assert.ok(decodeURIComponent(u.pathname).endsWith(path));
        if(failLogo) return reply({message:'mock denied'},403);
        return reply({signedURL:'/object/sign/store-logos/'+path+'?token=mock'});
      }
      if(req.method()==='GET' && u.pathname.includes('/object/sign/store-logos/')) {
        return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7msAAAAASUVORK5CYII=','base64')});
      }
      if(u.pathname.endsWith('/stores')) return reply({id:store,store_name:'Brand Test Store',slug:'brand-test',contact_phone:'08030000001',whatsapp_phone:'2348030000001'});
      if(u.pathname.endsWith('/products')) return reply([{id:'product',name:'Test Shirt',description:'A mock product',price:2000,images:[],is_available:true,track_stock:false,stock_quantity:0,low_stock_threshold:0}]);
      if(u.pathname.endsWith('/store_visitors') || u.pathname.endsWith('/product_views')) return reply({});
      if(u.pathname.startsWith('/auth/')) return reply({id:seller,role:'authenticated'});
      // The public page must not attempt owner-only subscription reads or raw branding reads.
      unexpected.push(req.method()+' '+req.url());return route.abort();
    });
    const page=await context.newPage();
    await page.goto(origin+'/store/brand-test');
    await expect(page.getByRole('heading',{name:'Brand Test Store',exact:true})).toBeVisible();
    const logo=page.getByRole('img',{name:'Brand Test Store logo'});
    await expect(logo).toBeVisible();
    await expect.poll(()=>logo.evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
    await expect(page.getByRole('button',{name:'Chat with seller on WhatsApp'})).toHaveCSS('background-color','rgb(255, 0, 0)');
    await expect.poll(()=>page.locator('header').evaluate(el=>getComputedStyle(el).backgroundImage)).toContain('rgb(18, 51, 84)');
    await page.getByRole('button',{name:'View details for Test Shirt'}).click();
    await expect.poll(()=>page.getByRole('dialog').evaluate(el=>getComputedStyle(el).getPropertyValue('--accent').trim())).toBe('0 100% 50%');
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Open cart, 0 items'}).click();
    await expect.poll(()=>page.getByRole('dialog').evaluate(el=>getComputedStyle(el).getPropertyValue('--primary').trim())).toBe('210 65% 20%');
    await page.keyboard.press('Escape');
    // Reload after a session boundary still reads persisted public branding.
    await page.reload(); await expect(logo).toBeVisible();
    main='#006600'; accent='#0000FF'; path=`${seller}/replacement-logo.png`;
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('button',{name:'Chat with seller on WhatsApp'})).toHaveCSS('background-color','rgb(0, 0, 255)');
    await expect(logo).toHaveAttribute('src',/replacement-logo/);
    const oldSigns=signs;
    entitled=false;
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await expect(logo).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Chat with seller on WhatsApp'})).not.toHaveCSS('background-color','rgb(0, 0, 255)');
    assert.equal(signs,oldSigns);
    // Storage denial affects the logo only; the valid theme remains visible.
    entitled=true;failLogo=true;
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('button',{name:'Chat with seller on WhatsApp'})).toHaveCSS('background-color','rgb(0, 0, 255)');
    await expect(logo).toHaveCount(0);
    failRpc=true;
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('button',{name:'Chat with seller on WhatsApp'})).not.toHaveCSS('background-color','rgb(0, 0, 255)');
    assert.ok(publicReads>=5);assert.deepEqual(unexpected,[]);
    await context.close();
    console.log(`PASS ${authenticated?'authenticated':'anonymous'} branding: RPC entitlement, private signed logo, computed colours, portal theme, reload/focus refresh, expiry and failures`);
  }
} finally {await browser?.close();server.kill();}
