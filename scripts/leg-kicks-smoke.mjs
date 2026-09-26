import { chromium, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
const output='test-results/leg-kicks';await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||(existsSync('/usr/bin/google-chrome-stable')?'/usr/bin/google-chrome-stable':undefined),headless:true,args:['--no-sandbox']});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:5180');
  await page.locator('#game[data-ready="true"]').waitFor();
  await page.locator('#pause').click();await page.locator('#states').click();
  const actions=['lk','lmk','hk','rlk','mk','rhk'];
  for(const [player,keys] of [['f','g','h','v','b','n'],['Numpad4','Numpad5','Numpad6','Numpad1','Numpad2','Numpad3']].entries()) {
    for(const [i,key] of keys.entries()) {
      await page.locator('#reset').click();
      await page.keyboard.down('d');
      await page.locator('#step').evaluate(b=>{for(let i=0;i<110;i++)b.click();});
      await page.keyboard.up('d');
      await page.keyboard.down(key);await page.locator('#step').click();await page.keyboard.up(key);
      await expect(page.locator(`#state-${player}`)).toContainText(`standing_${actions[i]}`);
      await page.locator('#step').evaluate(b=>{for(let i=0;i<32;i++)b.click();});
      const hp=Number((await page.locator(`#hp-${1-player}`).textContent()).split('/')[0]);
      expect(hp,`${key} causes contact damage`).toBeLessThan(1000);
    }
  }
  for(const theme of ['light','dark']) {
    if(theme==='dark')await page.locator('#theme').click();
    await page.locator('.controls').screenshot({path:`${output}/${theme}-controls.png`});
    await page.evaluate(async()=>{
      const {samplePose,sampleTurn}=await import('/src/render/skeleton.ts');
      const {sampleDepths}=await import('/src/render/depth.ts');
      const {drawFigure}=await import('/src/render/figure.ts');
      const {readPalette}=await import('/src/platform/theme.ts');
      const {MOVES}=await import('/src/data/schema.ts');
      const p=readPalette();document.querySelector('#leg-kicks-sheet')?.remove();
      const canvas=document.createElement('canvas');canvas.id='leg-kicks-sheet';canvas.width=1500;canvas.height=1200;
      canvas.style.cssText='width:1500px;height:1200px;max-width:none;aspect-ratio:auto';document.body.append(canvas);
      const ctx=canvas.getContext('2d');ctx.fillStyle=p.arena;ctx.fillRect(0,0,1500,1200);
      ['lk','lmk','hk','rlk','mk','rhk'].forEach((kick,row)=>[0,.25,.5,.75,1].forEach((t,col)=>{
        const id=`standing_${kick}`,move=MOVES[id];
        const frame=[0,Math.max(0,move.startup-2),move.startup,move.startup+move.active+4,move.duration-1][col];
        ctx.save();ctx.translate(col*300+150,row*200+180);ctx.scale(1.45,1.45);
        drawFigure(ctx,samplePose(id,frame),row<3?p.p1:p.p2,p,1,0,sampleDepths(id,frame),sampleTurn(id,frame));ctx.restore();
        ctx.fillStyle=p.text;ctx.font='13px monospace';ctx.fillText(`${['F links Low','G links Middle','H links High','V rechts Low','B rechts Middle','N rechts High'][row]} / ${frame}`,col*300+10,row*200+20);
      }));
    });
    await page.locator('#leg-kicks-sheet').screenshot({path:`${output}/${theme}-animations.png`});
    await page.evaluate(()=>document.querySelector('#leg-kicks-sheet').remove());
  }
  await page.setViewportSize({width:375,height:1000});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('.controls').screenshot({path:`${output}/controls-375.png`});
  expect(errors).toEqual([]);
  console.log('All six kick keys for both players select the expected leg move and deal damage; contact sheets and narrow controls captured.');
} finally {await browser.close();}
