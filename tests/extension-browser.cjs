const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
function wave(seconds=40){
 const rate=8000, length=seconds*rate, buffer=Buffer.alloc(44+length*2);
 buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(length*2,40);
 for(let i=0;i<length;i++)buffer.writeInt16LE(Math.round(Math.sin(i/rate*Math.PI*2*440)*100),44+i*2);
 return buffer;
}
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'tabblet-extension-test-'));
 let context;
 try{
  const root=path.resolve(__dirname,'..');
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_PATH,args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`,'--autoplay-policy=no-user-gesture-required'],viewport:{width:1280,height:900}});
  const tone=wave();
  await context.route('https://audio.tabblet.net/**',route=>route.fulfill({status:200,contentType:'audio/wav',body:tone}));
  await context.route('https://www.habblet.city/hotel',route=>route.fulfill({status:200,contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'fixtures/hotel.html'),'utf8')}));
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(()=>{
   const native=fetch;
   globalThis.__live=false;
   globalThis.fetch=async(...args)=>{
    const url=String(args[0]);
    if(url.includes('/api/public/status')) return Response.json({streaming:{is_live:globalThis.__live,stream_url:'https://audio.tabblet.net/listen/tabblet/stream.aac',listeners:49},broadcast:globalThis.__live?{id:119,username:'Blacky..',title:'Beta assombrado',figure:'hd-180-1.ch-210-66'}:null,network:{stations:TabbletCore.fallbackChannels().map(c=>({id:c.id,name:c.name,stream_url:c.streamUrl,online:true}))}});
    if(url.includes('/api/public/avatar-image')) {
     if(!url.includes('headonly=1') || !url.includes('size=b'))throw Error('Invalid head imaging request');
     return new Response(Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX2kAAAAASUVORK5CYII='), c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/png'}});
    }
    if(url.includes('/api/public/theme'))return Response.json({id:'halloween-construction-2026'});
    return native(...args);
   };
  });
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://www.habblet.city/hotel');
  const widget=page.locator('[data-tabblet-player]');
  await widget.locator('.player[data-state=playing]').waitFor({timeout:20000});
  assert.equal(await page.locator('#original').evaluate(el=>el.muted),true,'native radio is muted without inspecting any SVG');
  await page.waitForFunction(()=>{const host=document.querySelector('[data-tabblet-player]'),slot=document.querySelector('[data-tabblet-radio-slot]');return slot&&Math.abs(host.getBoundingClientRect().top-slot.getBoundingClientRect().top)<1;});
  const docking=await page.evaluate(()=>{const h=document.querySelector('[data-tabblet-player]').getBoundingClientRect(),n=document.querySelector('.nitro-notification-bubble').getBoundingClientRect(),m=document.querySelector('.hotel-notice').getBoundingClientRect();return {width:h.width,nativeWidth:n.width,left:h.left,nativeLeft:n.left,top:h.top,nativeBottom:n.bottom,bottom:h.bottom,noticeTop:m.top};});
  assert.equal(docking.width,docking.nativeWidth);
  assert.equal(docking.left,docking.nativeLeft);
  assert(docking.top>=docking.nativeBottom&&docking.bottom<=docking.noticeTop,'default position reserves space in the notification column');
  assert.equal(await widget.locator('.player').evaluate(el=>el.scrollWidth<=el.clientWidth),true,'200 px layout must not overflow');
  await page.screenshot({path:'docs/player-in-hotel-docked.png'});

  await widget.locator('#channel').selectOption('7');
  await widget.locator('.volume').fill('0.12');await page.waitForTimeout(200);
  await page.reload();
  await widget.locator('.player[data-state=playing]').waitFor();
  assert.equal(await widget.locator('#channel').inputValue(),'7');
  assert.equal(await widget.locator('.volume').inputValue(),'0.12');
  const handle=await widget.locator('.avatar-wrap').boundingBox();
  const beforeDrag=await widget.boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);
  await page.mouse.down();await page.mouse.move(500,350,{steps:8});await page.mouse.up();
  const moved=await widget.boundingBox();
  assert(Math.abs(moved.x-beforeDrag.x)>100,'player moves outside the default column');
  assert.equal(await page.locator('[data-tabblet-radio-slot]').count(),0,'drag releases the reserved sidebar space');
  await worker.evaluate(async()=>{if(!(await chrome.storage.local.get('radioPlayerPlacement')).radioPlayerPlacement)throw Error('position not saved');});
  await page.reload();await widget.locator('.player[data-state=playing]').waitFor();
  const restored=await widget.boundingBox();assert(Math.abs(restored.x-moved.x)<1&&Math.abs(restored.y-moved.y)<1,'dragged position survives F5');
  await page.setViewportSize({width:640,height:400});
  await page.waitForFunction(()=>{const r=document.querySelector('[data-tabblet-player]').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;});
  await page.setViewportSize({width:1280,height:900});

  // Exercise the real worker, native storage, offscreen document and HTMLAudioElement.
  async function live(value){await worker.evaluate(async value=>{globalThis.__live=value;await serial(()=>synchronize(true));},value);}
  await live(true);await widget.locator('.title').filter({hasText:'Blacky..'}).waitFor();
  await page.waitForFunction(()=>document.querySelector('[data-tabblet-player]').shadowRoot.querySelector('.avatar').src.startsWith('data:image/png'));
  assert.equal(await widget.locator('.avatar').getAttribute('alt'),'Cabeça de Blacky..');
  assert.equal(await widget.locator('#channel').inputValue(),'7');
  assert.equal(await worker.evaluate(()=>playback.src),'https://audio.tabblet.net/listen/tabblet/stream.aac');
  assert.equal(await worker.evaluate(()=>playback.volume),0.12);
  await live(false);await widget.locator('.player[data-live=false]').waitFor();
  assert.equal(await widget.locator('#channel').inputValue(),'7');
  assert.match(await widget.locator('.avatar').getAttribute('src'), /icon.webp$/);
  assert.match(await worker.evaluate(()=>playback.src),/canal_brasil_vibes/);
  await widget.locator('.play').click();await widget.locator('.player[data-state=paused]').waitFor();
  await live(true);assert.equal(await worker.evaluate(()=>playback.paused),true);
  const page2=await context.newPage();await page2.goto('https://www.habblet.city/hotel');
  const widget2=page2.locator('[data-tabblet-player]');await widget2.locator('.player[data-state=paused]').waitFor();
  assert.equal(await widget2.locator('.volume').inputValue(),'0.12');
  await widget2.locator('.play').click();await widget.locator('.player[data-state=playing]').waitFor();
  assert.equal(await widget.locator('header,.collapse,.mini').count(),0);
  assert.equal(await widget2.locator('.body').isVisible(),true);
  await context.route('https://tabblet.net/', route => route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"></head><body><h1>Rádio Tabblet</h1></body></html>'}));
  const siteTabPromise = context.waitForEvent('page');
  await widget.getByRole('link',{name:'Abrir site da Tabblet'}).click();
  const siteTab = await siteTabPromise;
  await siteTab.waitForLoadState();
  assert.equal(siteTab.url(),'https://tabblet.net/');
  await siteTab.getByRole('heading',{name:'Rádio Tabblet'}).waitFor();
  await siteTab.close();
  await page.screenshot({path:'docs/player-in-hotel-test.png'});
  await page.close();await page2.close();
  await worker.evaluate(async()=>{await serial(cleanupTabs);});
  assert.equal(await worker.evaluate(async()=>(await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})).length),0);
  assert.deepEqual(errors,[]);
  console.log('Native extension passed: real offscreen HTMLAudioElement (test WAV), persistent preferences/F5, live return, pause, two-tab sync, always-expanded UI, 200 px native docking, drag/F5 position, native-radio mute and last-tab cleanup.');
 }finally{if(context)await context.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
