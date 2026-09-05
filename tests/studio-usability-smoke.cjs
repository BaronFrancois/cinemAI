// Isolated UI regression: no provider calls, no production data writes.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { once } = require('node:events');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
(async () => {
 const {createCinemaiServer} = await import(pathToFileURL(resolve(__dirname,'../server.mjs')));
 const {createProductionStore} = await import(pathToFileURL(resolve(__dirname,'../production-store.mjs')));
 const browser = await chromium.launch({channel:'chrome',headless:true});
 try { for(const [width,height] of [[1440,1000],[390,844]]) {
  const store=createProductionStore({persist:false});
  const approve=async(name,args)=>store.decide((await store.propose(name,args)).id,'approve');
  await approve('set_project',{title:'Matin de Shadow',durationSeconds:48});
  for(let i=0;i<12;i++) await approve('create_shot',{title:'Action '+i,description:'Shadow prépare sa journée.',durationMs:4000});
  const id=store.snapshot().shots[0].id;
  const mediaDir=await mkdtemp(resolve(tmpdir(),'cinemai-studio-'));
  const server=createCinemaiServer({config:{mode:'mock',model:'offline',apiKey:'',requestTimeoutMs:1000},store,mediaDir,fetchImpl:()=>{throw new Error('Provider forbidden');},logger:{info(){},warn(){}}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const page=await browser.newPage({viewport:{width,height}});
  try {
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   for(let i=0;i<2;i++) assert.equal((await fetch(`${base}/api/shots/${id}/images/generate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:'GENERATE_IMAGE'})})).status,201);
   const old=store.snapshot().media[0].id;
   await page.goto(base,{waitUntil:'networkidle'});
   await page.locator('.project-workflow [data-context-tab="script"]:visible').click();
   await page.locator('.storyboard-tile').last().scrollIntoViewIfNeeded();
   assert.ok(await page.locator('[data-workspace-panel]').evaluate(el=>el.scrollTop>0),'storyboard scroll');
   await page.locator('[data-minimize-workspace]').click();
   await page.locator('[data-restore-workspace]').waitFor({state:'visible'});
   await page.locator('[data-restore-workspace]').click();
   assert.equal(await page.locator('.storyboard-tile').count(),12);
   await page.locator(`.storyboard-tile [data-edit-shot="${id}"]`).click();
   const details=page.locator('details').filter({has:page.locator('[data-generate-shot-image]')});
   await details.locator('summary').click();
   await page.locator(`[data-approve-media="${old}"]`).click();
   await page.waitForFunction(old=>document.querySelector(`.shot-media [data-approve-media="${old}"]`),old);
   assert.equal(store.snapshot().shots[0].approvedMediaId,old);
   await page.locator('[data-storyboard-overview]').click();
   await page.locator(`[data-split-shot="${id}"]`).click();
   await page.waitForFunction(()=>document.querySelectorAll('.storyboard-tile').length===13);
   assert.equal(store.snapshot().shots.reduce((a,s)=>a+s.durationMs,0),48000);
   await page.locator('[data-workspace-panel] [data-open-animatic]').click();
   assert.equal(await page.locator('[data-animatic-go]').count(),13);
   await page.locator('.project-workflow [data-context-tab="production"]:visible').click();
   await page.locator('.video-workspace').waitFor();
   const card=page.locator(`[data-workspace-panel] [data-shot-card="${id}"]`);
   await card.locator('[data-video-seconds]').selectOption('7');
   await card.locator('[data-video-prompt]').fill('Travelling lent');
   await card.locator('[data-generate-shot-video]').click();
   await page.waitForFunction(()=>!!document.querySelector('.video-workspace video'));
   assert.match(store.snapshot().media.find(m=>m.kind==='video').prompt,/7|sept/);
   assert.equal(store.snapshot().shots[0].durationMs,2000);
   assert.equal(await page.locator('.llm-connection-status').textContent(),'Simulation — aucun modèle IA connecté');
   await page.screenshot({path:resolve(mediaDir,`studio-${width}.png`),fullPage:true});
   assert.deepEqual(errors,[]);
   console.log(`${width}: scroll, minimize, old image, subdivision, animatic and direct video verified; screenshot ${mediaDir}`);
  } finally {await page.close();server.close();await once(server,'close');}
 } } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
