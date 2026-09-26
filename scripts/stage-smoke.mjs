import { chromium, firefox, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
const engine=process.env.TEST_BROWSER==='firefox'?firefox:chromium;
const name=engine===firefox?'firefox':'chrome';
const browser=await engine.launch(engine===chromium?{executablePath:process.env.CHROME_PATH||(existsSync('/usr/bin/google-chrome-stable')?'/usr/bin/google-chrome-stable':undefined),headless:true,args:['--no-sandbox']}:{headless:true});
const url=process.env.TEST_URL||'http://127.0.0.1:5180';
const output=`test-results/stages/${name}`;await mkdir(output,{recursive:true});
const stages=['dojo','rooftop','shrine'],captions={dojo:'THE DOJO',rooftop:'THE ROOFTOP',shrine:'THE SHRINE'};
const report={};
try {
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url); // fresh browser context: no stored theme or stage
  await page.locator('canvas[data-ready="true"]').waitFor();
  // Default stage, caption and switch state.
  await expect(page.locator('[data-stage="dojo"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#arena-mode')).toHaveText('THE DOJO / LOCAL 1V1');
  await page.locator('#pause').click();
  const frame=await page.locator('#game').getAttribute('data-frame');
  for(const theme of ['light','dark']) {
    if(theme==='dark')await page.locator('#theme').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
    for(const stage of stages) {
      await page.locator(`[data-stage="${stage}"]`).click();
      for(const other of stages)await expect(page.locator(`[data-stage="${other}"]`)).toHaveAttribute('aria-pressed',String(other===stage));
      await expect(page.locator('#arena-mode')).toHaveText(`${captions[stage]} / LOCAL 1V1`);
      // Pixel audit of the stage alone (no fighters) in the production renderer.
      const audit=await page.evaluate(async stage=>{
        const {drawStage,STAGE_BANDS,stagePan}=await import('/src/render/stages.ts');
        const {readPalette}=await import('/src/platform/theme.ts');
        const p=readPalette(),hex=c=>c.slice(1).match(/../g).map(v=>parseInt(v,16));
        const lum=rgb=>{const [r,g,b]=rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*r+.7152*g+.0722*b;};
        const ratio=(a,b)=>(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
        const results={};
        for(const pan of [stagePan(40),0,stagePan(920)]) {
          const c=document.createElement('canvas');c.width=960;c.height=420;const ctx=c.getContext('2d');
          drawStage(ctx,stage,p,pan);
          const data=ctx.getImageData(0,0,960,420).data,at=(x,y)=>{const i=(y*960+x)*4;return [data[i],data[i+1],data[i+2]];};
          const players=[lum(hex(p.p1)),lum(hex(p.p2))],text=[lum(hex(p.text)),lum(hex(p.muted))];
          let fighterMin=Infinity,fighterFail=0,hudMin=Infinity,bottomOff=0;
          for(let y=STAGE_BANDS.fighters[0];y<STAGE_BANDS.fighters[1];y++)for(let x=0;x<960;x++){
            const l=lum(at(x,y)),r=Math.min(...players.map(v=>ratio(v,l)));fighterMin=Math.min(fighterMin,r);if(r<3)fighterFail++;
          }
          for(let y=STAGE_BANDS.hudTop[0];y<STAGE_BANDS.hudTop[1];y++)for(let x=0;x<960;x+=2)hudMin=Math.min(hudMin,...text.map(v=>ratio(v,lum(at(x,y)))));
          const arena=hex(p.arena);
          for(let y=STAGE_BANDS.hudBottom[0];y<STAGE_BANDS.hudBottom[1];y++)for(let x=0;x<960;x+=3)if(at(x,y).some((v,i)=>v!==arena[i]))bottomOff++;
          results[pan.toFixed(2)]={fighterMin:+fighterMin.toFixed(3),fighterFailShare:fighterFail/(960*(STAGE_BANDS.fighters[1]-STAGE_BANDS.fighters[0])),hudMin:+hudMin.toFixed(3),bottomOff,topLeft:at(0,0).every((v,i)=>v===arena[i])};
        }
        // Frame cost: full repaint (pan changes every frame) and cached blit.
        const c=document.createElement('canvas');c.width=960;c.height=420;const ctx=c.getContext('2d');
        let start=performance.now();for(let i=0;i<120;i++)drawStage(ctx,stage,p,stagePan(200+i*8));ctx.getImageData(0,0,1,1);
        const msPerFrame=+((performance.now()-start)/120).toFixed(3);
        start=performance.now();for(let i=0;i<120;i++)drawStage(ctx,stage,p,stagePan(480));ctx.getImageData(0,0,1,1);
        return {...results,msPerFrame,cachedMsPerFrame:+((performance.now()-start)/120).toFixed(3)};
      },stage);
      report[`${theme}/${stage}`]=audit;await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));
      for(const [pan,r] of Object.entries(audit)) {
        if(typeof r!=='object')continue;
        expect(r.fighterFailShare,`${theme}/${stage} pan ${pan}: fighter band below 3:1`).toBe(0);
        expect(r.hudMin,`${theme}/${stage} pan ${pan}: HUD text contrast`).toBeGreaterThanOrEqual(4.5);
        expect(r.bottomOff,`${theme}/${stage}: resource HUD band must stay arena coloured`).toBe(0);
        expect(r.topLeft).toBe(true);
      }
      // Budgets hold for software rasterising in headless Chrome; GPU canvases are faster.
      expect(audit.msPerFrame,`${theme}/${stage} stage repaint budget`).toBeLessThan(8);
      expect(audit.cachedMsPerFrame,`${theme}/${stage} cached stage budget`).toBeLessThan(1);
      await page.waitForTimeout(50);
      await page.locator('.arena').screenshot({path:`${output}/${stage}-${theme}.png`});
    }
  }
  // Stage choice is presentation only: no simulation frame advanced while paused.
  expect(await page.locator('#game').getAttribute('data-frame')).toBe(frame);
  // Persistence across reloads, including the caption in CPU mode.
  await page.locator('[data-stage="rooftop"]').click();await page.reload();await page.locator('canvas[data-ready="true"]').waitFor();
  await expect(page.locator('[data-stage="rooftop"]')).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('F8');await expect(page.locator('#arena-mode')).toContainText('THE ROOFTOP / VS CPU');
  await page.keyboard.press('F8');
  // Parallax: the vanishing point follows the fighters' midpoint.
  const shift=await page.evaluate(async()=>{
    const {drawStage,stagePan}=await import('/src/render/stages.ts');const {readPalette}=await import('/src/platform/theme.ts');
    const rows=pan=>{const c=document.createElement('canvas');c.width=960;c.height=420;const ctx=c.getContext('2d');drawStage(ctx,'rooftop',readPalette(),pan);return ctx.getImageData(0,200,960,1).data.join();};
    return {centre:stagePan(480),moved:rows(stagePan(200))!==rows(stagePan(760))};
  });
  expect(shift.centre).toBe(0);expect(shift.moved).toBe(true);
  // Mobile layout: switch reachable, no horizontal overflow.
  await page.setViewportSize({width:390,height:900});
  await expect(page.locator('[data-stage="shrine"]')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.locator('.arena').screenshot({path:`${output}/mobile.png`});
  // A live fight frame on each stage, for visual review.
  await page.setViewportSize({width:1440,height:1100});
  for(const stage of stages) {
    await page.locator(`[data-stage="${stage}"]`).click();await page.locator('#reset').click();
    if(await page.locator('#step').isDisabled())await page.locator('#pause').click();
    await page.keyboard.down('d');await page.locator('#step').evaluate(b=>{for(let i=0;i<70;i++)b.click();});await page.keyboard.up('d');
    await page.keyboard.down('w');await page.locator('#step').evaluate(b=>{for(let i=0;i<18;i++)b.click();});await page.keyboard.up('w');
    await page.locator('.arena').screenshot({path:`${output}/fight-${stage}.png`});
  }
  await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));
  expect(errors).toEqual([]);
  console.log(`Stage switch, persistence, captions, contrast audit, parallax and screenshots passed (${name}).`);
  console.table(Object.fromEntries(Object.entries(report).map(([k,v])=>[k,{min3:Math.min(...Object.values(v).filter(r=>typeof r==='object').map(r=>r.fighterMin)),hud:Math.min(...Object.values(v).filter(r=>typeof r==='object').map(r=>r.hudMin)),repaintMs:v.msPerFrame,cachedMs:v.cachedMsPerFrame}])));
} finally { await browser.close(); }
