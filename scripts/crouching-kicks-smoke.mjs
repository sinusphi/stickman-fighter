import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const output='test-results/crouching-kicks';await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome-stable',headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:5180');await page.locator('#game[data-ready="true"]').waitFor();
 if(await page.locator('#step').isDisabled())await page.locator('#pause').click();
 await page.locator('#states').click();
 const names=['lk','lmk','hk','rlk','mk','rhk'];
 for(const [player,keys] of [['f','g','h','v','b','n'],['Numpad4','Numpad5','Numpad6','Numpad1','Numpad2','Numpad3']].entries())for(const [i,key] of keys.entries()) {
  await page.locator('#reset').click();await page.keyboard.down('d');
  await page.locator('#step').evaluate(b=>{for(let i=0;i<110;i++)b.click();});await page.keyboard.up('d');
  const down=player===0?'s':'ArrowDown';await page.keyboard.down(down);await page.keyboard.down(key);
  await page.locator('#step').click();await page.keyboard.up(key);
  await expect(page.locator(`#state-${player}`)).toContainText(`crouching_${names[i]}`);
  await page.locator('#step').evaluate(b=>{for(let i=0;i<65;i++)b.click();});
  expect(Number((await page.locator(`#hp-${1-player}`).textContent()).split('/')[0])).toBeLessThan(1000);
  await expect(page.locator(`#state-${player}`)).toContainText('Crouch');await page.keyboard.up(down);
 }
 await page.evaluate(async()=>{
  const {samplePose,animations}=await import('/src/render/skeleton.ts');
  const {sampleDepths}=await import('/src/render/depth.ts');
  const {drawFigure}=await import('/src/render/figure.ts');const {readPalette}=await import('/src/platform/theme.ts');
  const p=readPalette(),c=document.createElement('canvas');c.id='crouch-sheet';c.width=1800;c.height=1200;
  c.style.cssText='width:1800px;height:1200px;max-width:none;aspect-ratio:auto';document.body.append(c);
  const ctx=c.getContext('2d');ctx.fillStyle=p.arena;ctx.fillRect(0,0,c.width,c.height);
  ['lk','lmk','hk','rlk','mk','rhk'].forEach((kick,row)=>{
   const id='crouching_'+kick,a=animations[id],k=a.keyframes;
   const frames=[0,k[1].frame*.5,k[1].frame,k[2].frame,k[4].frame,(k[4].frame+k[5].frame)/2,k[5].frame,k[6].frame];
   frames.forEach((frame,col)=>{
    ctx.save();ctx.translate(col*225+80,row*200+170);ctx.scale(1.65,1.65);
    ctx.strokeStyle=p.muted;ctx.lineWidth=.5;ctx.beginPath();ctx.moveTo(-40,0);ctx.lineTo(80,0);ctx.stroke();
    drawFigure(ctx,samplePose(id,frame),row<3?p.p1:p.p2,p,1,0,sampleDepths(id,frame));ctx.restore();
    ctx.fillStyle=p.text;ctx.font='14px monospace';ctx.fillText(`${kick} / ${frame.toFixed(1)}`,col*225+12,row*200+22);
   });
  });
 });
 await page.locator('#crouch-sheet').screenshot({path:`${output}/phases.png`});
 expect(errors).toEqual([]);console.log('All six crouching kicks: both players, contact, recovery and phase sheet passed.');
}finally {await browser.close();}
