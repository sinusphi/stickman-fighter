import {chromium,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
await mkdir('test-results/jumping-uppercut',{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome-stable',headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:1600,height:850}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:5180');await page.locator('#game[data-ready="true"]').waitFor();
 await page.locator('#pause').click();await page.locator('#states').click();
 for(const [player,forward,punch] of [[0,'KeyD','KeyY'],[1,'ArrowLeft','Numpad9']]) {
  await page.locator('#reset').click();await page.keyboard.down(forward);await page.locator('#step').click();
  await page.keyboard.down(punch);await page.locator('#step').click();await expect(page.locator(`#state-${player}`)).toContainText('jumping_uppercut');
  await page.keyboard.up(punch);await page.keyboard.up(forward);
  await page.locator('#step').evaluate(b=>{for(let i=0;i<60;i++)b.click();});await expect(page.locator(`#state-${player}`)).toContainText('Idle');
 }
 await page.evaluate(async()=>{
  const {samplePose,sampleTurn,sampleYaw,animations}=await import('/src/render/skeleton.ts'),{sampleDepths}=await import('/src/render/depth.ts');
  const {drawFigure}=await import('/src/render/figure.ts'),{readPalette}=await import('/src/platform/theme.ts');
  const palette=readPalette(),c=document.createElement('canvas');c.id='uppercut-sheet';c.width=1920;c.height=600;document.body.append(c);
  const ctx=c.getContext('2d');ctx.fillStyle=palette.arena;ctx.fillRect(0,0,c.width,c.height);
  for(const [row,facing] of [[0,1],[1,-1]])[0,7,11,15,20,25,28,32,35,38,42,55].forEach((frame,col)=>{
   ctx.save();ctx.translate(col*160+70,row*300+265);ctx.scale(1.65,1.65);ctx.strokeStyle=palette.ground;ctx.beginPath();ctx.moveTo(-42,0);ctx.lineTo(50,0);ctx.stroke();
   drawFigure(ctx,samplePose('jumping_uppercut',frame),palette.p1,palette,facing,0,sampleDepths('jumping_uppercut',frame),sampleTurn('jumping_uppercut',frame),sampleYaw('jumping_uppercut',frame),animations.jumping_uppercut.fixedLegDepth);ctx.restore();ctx.fillStyle=palette.text;ctx.font='14px monospace';ctx.fillText(`${frame}`,col*160+65,row*300+20);
  });
 });
 await page.locator('#uppercut-sheet').screenshot({path:'test-results/jumping-uppercut/phases.png'});
 expect(errors).toEqual([]);console.log('Both player inputs, landing and phase sheet passed.');
}finally{await browser.close();}
