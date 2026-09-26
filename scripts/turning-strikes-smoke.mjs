import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const output='test-results/turning-strikes';await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome-stable',headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:5180');
 await page.locator('#game[data-ready="true"]').waitFor();await page.locator('#pause').click();
 await page.locator('#states').click();
 await page.locator('#reset').click();await page.keyboard.down('d');
 await page.locator('#step').evaluate(b=>{for(let i=0;i<110;i++)b.click();});await page.keyboard.up('d');
 await page.keyboard.down('t');await page.locator('#step').click();await page.keyboard.up('t');
 const punch=await page.evaluate(async()=>{const {MOVES}=await import('/src/data/schema.ts');return MOVES.standing_mp;});
 await page.locator('#step').evaluate((b,count)=>{for(let i=0;i<count;i++)b.click();},punch.startup);
 await expect(page.locator('#state-0')).toContainText('standing_mp');
 await expect(page.locator('#state-1')).toContainText('Hitstun');
 expect(Number((await page.locator('#hp-1').textContent()).split('/')[0])).toBeLessThan(1000);
 await page.locator('#game').screenshot({path:`${output}/middlepunch-contact.png`});
 await page.locator('#step').evaluate(b=>{for(let i=0;i<18;i++)b.click();});
 await page.locator('#game').screenshot({path:`${output}/middlepunch-slide.png`});
 for(const theme of ['light','dark']) {
    if(theme==='light')await page.locator('#theme').click();
  await page.evaluate(async()=>{
   const {samplePose,sampleTurn,animations}=await import('/src/render/skeleton.ts');
   const {sampleDepths}=await import('/src/render/depth.ts');
   const {drawFigure}=await import('/src/render/figure.ts');
   const {readPalette}=await import('/src/platform/theme.ts');
   const {MOVES}=await import('/src/data/schema.ts');
   const p=readPalette();document.querySelector('#strike-sheet')?.remove();
   const c=document.createElement('canvas');c.id='strike-sheet';c.width=1500;c.height=1450;
   c.style.cssText='width:1500px;height:1450px;max-width:none;aspect-ratio:auto';document.body.append(c);
   const ctx=c.getContext('2d');ctx.fillStyle=p.arena;ctx.fillRect(0,0,c.width,c.height);
   ['standing_mp','standing_rlk','standing_mk','standing_rhk','standing_lmk','HitMiddlePunch'].forEach((id,row)=>{
    const move=MOVES[id],frames=move?[0,move.startup-2,move.startup,move.startup+move.active+3,move.duration-1]:[0,3,6,10,16];
    frames.forEach((frame,col)=>{
     ctx.save();ctx.translate(col*300+120,row*210+195);ctx.scale(1.7,1.7);
     drawFigure(ctx,samplePose(id,frame),p.p1,p,1,0,sampleDepths(id,frame),sampleTurn(id,frame));ctx.restore();
     ctx.fillStyle=p.text;ctx.font='14px monospace';ctx.fillText(`${id} / ${frame}`,col*300+10,row*210+18);
    });
   });
   // Reference contact composition in both viewing directions.
   for(const facing of [1,-1]) {
    ctx.save();ctx.translate(facing===1?300:1100,1430);ctx.scale(1.6,1.6);
    drawFigure(ctx,samplePose('HitMiddlePunch',0),p.p2,p,-facing,0,sampleDepths('HitMiddlePunch',0));
    ctx.translate(-facing*48,0);
    drawFigure(ctx,samplePose('standing_mp',6),p.p1,p,facing,0,sampleDepths('standing_mp',6),1);ctx.restore();
   }
  });
  await page.locator('#strike-sheet').screenshot({path:`${output}/${theme}.png`});
 }
 expect(errors).toEqual([]);console.log('Turning punch, right kicks, raised middle kicks and recoil contact sheets captured in both themes.');
}finally {await browser.close();}
