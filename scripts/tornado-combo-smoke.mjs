import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const output='test-results/tornado-combo';await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome-stable',headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:5180');await page.locator('#game[data-ready="true"]').waitFor();
 await page.locator('#pause').click();await page.locator('#states').click();
 for(const [id,keys,damage,player] of [['tornado_mk',['b'],80,0],['forward_spin_hk',['h'],100,0],['tornado_spin_combo',['b','h'],180,0],['tornado_spin_combo',['Numpad2','Numpad6'],180,1]]) {
  await page.locator('#reset').click();await page.keyboard.down('d');
  await page.locator('#step').evaluate(b=>{for(let i=0;i<110;i++)b.click();});await page.keyboard.up('d');
  await page.locator('#record').click();const forward=player===0?'d':'ArrowLeft',back=player===0?'a':'ArrowRight',direction=id==='forward_spin_hk'?back:forward;await page.keyboard.down(direction);
  for(const key of keys)await page.keyboard.down(key);await page.locator('#step').click();
  await expect(page.locator(`#state-${player}`)).toContainText(id);
  for(const key of keys)await page.keyboard.up(key);await page.keyboard.up(direction);
  await page.locator('#step').evaluate(b=>{for(let i=0;i<140;i++)b.click();});
  await expect(page.locator(`#hp-${1-player}`)).toHaveText(`${1000-damage} / 1000`);
  await page.locator('#record').click();await page.locator('#play').click();
  await expect(page.locator('#notice')).toContainText('Replay beendet');
  await expect(page.locator(`#hp-${1-player}`)).toHaveText(`${1000-damage} / 1000`);await page.locator('#play').click();
 }
 // Reproduce hardware keydowns arriving on different simulation frames.
 for(const player of [0,1])for(const reverse of [false,true])for(const gap of [1,3]) {
  await page.locator('#reset').click();
  const direction=player===0?'d':'ArrowLeft',keys=player===0?['b','h']:['Numpad2','Numpad6'];
  if(reverse)keys.reverse();
  await page.keyboard.down(direction);await page.locator('#step').evaluate(b=>{for(let i=0;i<8;i++)b.click();});
  await page.keyboard.down(keys[0]);await page.locator('#step').evaluate((b,n)=>{for(let i=0;i<n;i++)b.click();},gap);
  await page.keyboard.down(keys[1]);await page.locator('#step').click();
  await expect(page.locator(`#state-${player}`)).toContainText('tornado_spin_combo');
  for(const key of [...keys,direction])await page.keyboard.up(key);
 }
 // Also exercise the running 60-Hz loop, rather than only paused frame steps.
 for(const keys of [['b','h'],['h','b']]) {
  await page.locator('#reset').click();await page.locator('#pause').click();
  await page.keyboard.down('d');await page.waitForTimeout(80);
  await page.keyboard.down(keys[0]);await page.waitForTimeout(20);await page.keyboard.down(keys[1]);
  await expect(page.locator('#state-0')).toContainText('tornado_spin_combo');
  for(const key of [...keys,'d'])await page.keyboard.up(key);
  await page.locator('#pause').click();
 }
 await page.locator('#animation-preview summary').click();
 for(const id of ['tornado_mk','forward_spin_hk','tornado_spin_combo']) {
  await page.locator('#preview-animation').selectOption(id);await page.locator('#preview-time').fill(id==='tornado_mk'?'28':id==='forward_spin_hk'?'24':'56');
  await expect(page.locator('#preview-canvas')).toHaveAttribute('data-animation',id);
  await page.locator('#animation-preview').screenshot({path:`${output}/${id}.png`});
 }
 await page.evaluate(async()=>{
  const {samplePose,sampleTurn,sampleYaw}=await import('/src/render/skeleton.ts'),{sampleDepths}=await import('/src/render/depth.ts');
  const {drawFigure}=await import('/src/render/figure.ts'),{readPalette}=await import('/src/platform/theme.ts');
  const {MOVES}=await import('/src/data/schema.ts');
  const palette=readPalette(),c=document.createElement('canvas');c.id='combo-sheet';c.width=1920;c.height=780;c.style.cssText='width:1920px;height:780px;max-width:none;aspect-ratio:auto';document.body.append(c);
  const ctx=c.getContext('2d');ctx.fillStyle=palette.arena;ctx.fillRect(0,0,c.width,c.height);
  [['tornado_mk',[0,6,12,18,24,28,32,38,46,54]],['forward_spin_hk',[0,6,12,18,24,29,36,40,43,46]],['tornado_spin_combo',[0,12,18,24,28,38,44,50,56,61,68,78]]].forEach(([id,frames],row)=>{
   frames.forEach((frame,col)=>{
    ctx.save();ctx.translate(col*160+75,row*260+225);ctx.scale(1.5,1.5);
    ctx.strokeStyle=palette.ground;ctx.beginPath();ctx.moveTo(-48,0);ctx.lineTo(50,0);ctx.stroke();
    drawFigure(ctx,samplePose(id,frame),palette.p1,palette,1,0,sampleDepths(id,frame),sampleTurn(id,frame),sampleYaw(id,frame));
    for(const box of MOVES[id].frames[frame].hitboxes){ctx.strokeStyle=palette.hit;ctx.strokeRect(box.x/256,box.y/256,box.width/256,box.height/256);}
    ctx.restore();ctx.fillStyle=palette.text;ctx.font='12px monospace';ctx.fillText(`${id} / ${frame}`,col*160+5,row*260+18);
   });
  });
 });
 await page.locator('#combo-sheet').screenshot({path:`${output}/phases.png`});
 expect(errors).toEqual([]);console.log('Three forward attacks, both players, exact damage, replays and previews passed; phase sheet saved.');
}finally {await browser.close();}
