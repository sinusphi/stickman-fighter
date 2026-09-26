import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const output='test-results/footwork';await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome-stable',headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000},...(process.env.FOOTWORK_VIDEO==='1'?{recordVideo:{dir:output,size:{width:1440,height:1000}}}:{})});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:5180');await page.locator('#game[data-ready="true"]').waitFor();await page.locator('#pause').click();
 await page.evaluate(async()=>{
  const {samplePose,animations}=await import('/src/render/skeleton.ts');const {sampleDepths}=await import('/src/render/depth.ts');
  const {drawFigure}=await import('/src/render/figure.ts');const {readPalette}=await import('/src/platform/theme.ts');
  const palette=readPalette(),c=document.createElement('canvas');c.id='footwork';c.width=1500;c.height=1250;c.style.cssText='width:1500px;height:1250px;max-width:none;aspect-ratio:auto';document.body.append(c);
  const ctx=c.getContext('2d');ctx.fillStyle=palette.arena;ctx.fillRect(0,0,c.width,c.height);
  ['Walk','WalkBackward','CrouchWalk','Crouch','standing_rlk','standing_mk'].forEach((id,row)=>{
   for(let col=0;col<6;col++) {
    const time=(animations[id].durationFrames-1)*col/6;
    ctx.save();ctx.translate(250*col+110,200*row+180);ctx.scale(1.6,1.6);
    ctx.strokeStyle=palette.ground;ctx.beginPath();ctx.moveTo(-60,0);ctx.lineTo(70,0);ctx.stroke();
    drawFigure(ctx,samplePose(id,time),palette.p1,palette,1,0,sampleDepths(id,time));ctx.restore();
    ctx.fillStyle=palette.text;ctx.font='13px monospace';ctx.fillText(`${id} / ${time.toFixed(1)}`,250*col+8,200*row+18);
   }
  });
 });
 await page.locator('#footwork').screenshot({path:`${output}/phases.png`});await page.evaluate(()=>document.querySelector('#footwork').remove());
 await page.locator('#reset').click();await page.locator('#pause').click();
 await page.keyboard.down('d');await page.waitForTimeout(700);await page.keyboard.up('d');
 await page.keyboard.down('a');await page.waitForTimeout(850);await page.keyboard.up('a');
 for(const key of ['v','b','n']) {await page.keyboard.press(key);await page.waitForTimeout(1150);}
 await page.locator('#pause').click();expect(errors).toEqual([]);await page.close();
 console.log('Footwork phases and real-time forward/backward walk plus right kicks verified.');
}finally {await browser.close();}
