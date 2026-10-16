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
  await context.route('https://www.habblet.city/hotel',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"></head><body style="background:#243133"><div class="nitro-notification-bubble">Rádio Habblet<audio id="original"></audio></div><input class="chat-input" name="chat" maxlength="100"></body></html>'}));
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
  await widget.locator('#channel').selectOption('7');
  await widget.locator('.volume').fill('0.12');await page.waitForTimeout(200);
  await page.reload();
  await widget.locator('.player[data-state=playing]').waitFor();
  assert.equal(await widget.locator('#channel').inputValue(),'7');
  assert.equal(await widget.locator('.volume').inputValue(),'0.12');
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
  await context.route('https://tabblet.net/', route => route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"></head><body><button data-open="request-dialog">Pedir música</button><dialog id="request-dialog"><input name="music"></dialog><script>document.querySelector("button").addEventListener("click",()=>document.querySelector("dialog").showModal())</script></body></html>'}));
  const requestTabPromise = context.waitForEvent('page');
  await widget.getByRole('link',{name:'Pedir música'}).click();
  const requestTab = await requestTabPromise;
  await requestTab.locator('#request-dialog[open]').waitFor();
  assert.equal(requestTab.url(),'https://tabblet.net/#request-dialog');
  await requestTab.close();
  const siteTabPromise = context.waitForEvent('page');
  await widget.getByRole('link',{name:'Abrir site da Tabblet'}).click();
  const siteTab = await siteTabPromise;
  await siteTab.waitForLoadState();
  assert.equal(siteTab.url(),'https://tabblet.net/');
  assert.equal(await siteTab.locator('#request-dialog').evaluate(el=>el.open),false);
  await siteTab.close();
  await page.screenshot({path:'docs/player-in-hotel-test.png'});
  await page.close();await page2.close();
  await worker.evaluate(async()=>{await serial(cleanupTabs);});
  assert.equal(await worker.evaluate(async()=>(await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})).length),0);
  assert.deepEqual(errors,[]);
  console.log('Native extension passed: real offscreen HTMLAudioElement (test WAV), persistent preferences/F5, live return, pause, two-tab sync, always-expanded UI, native-radio mute and last-tab cleanup.');
 }finally{if(context)await context.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
