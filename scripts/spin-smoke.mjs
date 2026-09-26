import { chromium,firefox,expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
const engine=process.env.TEST_BROWSER==='firefox'?firefox:chromium,name=engine===firefox?'firefox':'chrome';
const browser=await engine.launch(engine===chromium?{executablePath:process.env.CHROME_PATH||(existsSync('/usr/bin/google-chrome-stable')?'/usr/bin/google-chrome-stable':undefined),headless:true,args:['--no-sandbox']}:{headless:true});
const output='test-results/update-03';await mkdir(output,{recursive:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:5181');await page.locator('#game[data-ready="true"]').waitFor();
 await page.locator('#pause').click();await page.locator('#states').click();
 for(const [key,id,damage,player] of [['b','spin_mk',80,0],['h','spin_hk',110,0],['Numpad2','spin_mk',80,1],['Numpad6','spin_hk',110,1]]) {
   const forward=player===0?'d':'ArrowLeft',back=player===0?'a':'ArrowRight',direction=id==='spin_hk'?forward:back;
   const start=await page.evaluate(async id=>(await import('/src/data/schema.ts')).MOVES[id].startup,id);
   await page.locator('#reset').click();await page.keyboard.down(forward);
   await page.locator('#step').evaluate(b=>{for(let i=0;i<110;i++)b.click();});await page.keyboard.up(forward);
   await page.locator('#record').click();
   await page.keyboard.down(direction);await page.keyboard.down(key);await page.locator('#step').click();
   await expect(page.locator(`#state-${player}`)).toContainText(id);await expect(page.locator(`#hp-${1-player}`)).toHaveText('1000 / 1000');
   await page.keyboard.up(key);await page.keyboard.up(direction);
   await page.locator('#step').evaluate((b,n)=>{for(let i=0;i<n;i++)b.click();},start);
   await expect(page.locator(`#hp-${1-player}`)).toHaveText(`${1000-damage} / 1000`);
   await page.locator('#boxes').click();await page.locator('#game').screenshot({path:`${output}/${name}-p${player+1}-${id}-contact.png`});await page.locator('#boxes').click();
   await page.locator('#record').click();await page.locator('#play').click();await expect(page.locator('#notice')).toContainText('Replay ended');
   await expect(page.locator(`#hp-${1-player}`)).toHaveText(`${1000-damage} / 1000`);await page.locator('#play').click();
 }
 // Releasing back before the kick has no lingering qualification.
 await page.locator('#reset').click();await page.keyboard.down('a');await page.keyboard.down('f');await page.locator('#step').click();await page.keyboard.up('f');
 await expect(page.locator('#state-0')).not.toContainText('standing_lk');
 await expect(page.locator('#state-0')).not.toContainText('spin_lk');
 await page.keyboard.up('a');await page.locator('#step').evaluate(b=>{for(let i=0;i<12;i++)b.click();});
 await expect(page.locator('#state-0')).not.toContainText('standing_lk');
 await page.locator('#reset').click();await page.keyboard.down('a');await page.locator('#step').click();await page.keyboard.up('a');
 await page.keyboard.down('b');await page.locator('#step').click();await page.keyboard.up('b');await expect(page.locator('#state-0')).toContainText('standing_mk');
 // Each productive move is also inspectable at quarter-frames in the preview.
 await page.locator('#animation-preview summary').click();
 for(const theme of ['light','dark']) {
   if(theme==='light')await page.locator('#theme').click();
   for(const id of ['spin_mk','spin_hk']) {
     await page.locator('#preview-animation').selectOption(id);
     const start=await page.evaluate(async id=>(await import('/src/data/schema.ts')).MOVES[id].startup,id);
     await page.locator('#preview-time').fill(String(start));
     await expect(page.locator('#preview-canvas')).toHaveAttribute('data-frame',start.toFixed(2));
     await page.locator('#animation-preview').screenshot({path:`${output}/${name}-${theme}-${id}-preview.png`});
   }
 }
 await page.evaluate(async()=>{
   const {samplePose,sampleTrail,animations,sampleTurn,sampleYaw}=await import('/src/render/skeleton.ts');
   const {drawFigure,drawTrail}=await import('/src/render/figure.ts');
    const {sampleDepths}=await import('/src/render/depth.ts');
   const {MOVES}=await import('/src/data/schema.ts');const {readPalette}=await import('/src/platform/theme.ts');
   const palette=readPalette(),canvas=document.createElement('canvas');canvas.id='spin-sheet';canvas.width=1980;canvas.height=1080;canvas.style.cssText='width:1980px;height:1080px;aspect-ratio:auto';document.body.append(canvas);
   const ctx=canvas.getContext('2d');ctx.fillStyle=palette.arena;ctx.fillRect(0,0,1980,1080);
   [['spin_mk',1],['spin_mk',-1],['spin_hk',1],['spin_hk',-1]].forEach(([id,facing],row)=>{
     const move=MOVES[id];animations[id].keyframes.filter((key,i,keys)=>i===keys.length-1||i%Math.ceil((keys.length-1)/10)===0).forEach((key,col)=>{
       const frame=key.frame,pose=samplePose(id,frame),boxes=move.frames[frame];
       ctx.save();ctx.translate(col*180+(facing===1?65:115),row*270+230);ctx.scale(1.5,1.5);
       const paint=(box,color)=>{ctx.strokeStyle=color;ctx.lineWidth=.5;ctx.strokeRect(box.x/256,box.y/256,box.width/256,box.height/256);};
       ctx.save();ctx.scale(facing,1);boxes.hurtboxes.forEach(b=>paint(b,palette.hurt));boxes.hitboxes.forEach(b=>paint(b,palette.hit));ctx.restore();
       drawTrail(ctx,sampleTrail(id,frame,facing),palette.p2);drawFigure(ctx,pose,palette.p1,palette,facing,0,sampleDepths(id,frame),sampleTurn(id,frame),sampleYaw(id,frame),animations[id].fixedLegDepth);
       ctx.restore();ctx.fillStyle=palette.text;ctx.font='12px monospace';ctx.fillText(`${id} · ${frame}f`,col*180+10,row*270+24);
     });
   });
   const active=document.createElement('canvas');active.id='spin-active';active.width=1200;active.height=810;active.style.cssText='width:1200px;height:810px;aspect-ratio:auto';document.body.append(active);
   const c=active.getContext('2d');c.fillStyle=palette.arena;c.fillRect(0,0,1200,810);
   ['spin_mk','spin_hk'].forEach((id,row)=>{
     const m=MOVES[id];for(let col=0;col<m.active;col++) {
       const frame=m.startup+col,pose=samplePose(id,frame);c.save();c.translate(col*240+100,row*270+230);c.scale(1.65,1.65);
       for(const box of m.frames[frame].hitboxes){c.strokeStyle=palette.hit;c.lineWidth=.7;c.strokeRect(box.x/256,box.y/256,box.width/256,box.height/256);}
       drawTrail(c,sampleTrail(id,frame),palette.p2);drawFigure(c,pose,palette.p1,palette,1,0,sampleDepths(id,frame),sampleTurn(id,frame),sampleYaw(id,frame),animations[id].fixedLegDepth);c.restore();c.fillStyle=palette.text;c.font='12px monospace';c.fillText(`${id} · active ${col+1} / ${m.active}`,col*240+12,row*270+24);
     }
   });
 });
 await page.locator('#spin-sheet').screenshot({path:`${output}/${name}-keyframes-boxes.png`});
 await page.locator('#spin-active').screenshot({path:`${output}/${name}-active-boxes.png`});
 await page.evaluate(async()=>{
   const {samplePose,animations,sampleTurn,sampleYaw}=await import('/src/render/skeleton.ts');
   const {drawFigure}=await import('/src/render/figure.ts');
   const {sampleDepths}=await import('/src/render/depth.ts');
   const {readPalette}=await import('/src/platform/theme.ts');
   const palette=readPalette(),canvas=document.querySelector('#spin-sheet'),ctx=canvas.getContext('2d');
   ctx.fillStyle=palette.arena;ctx.fillRect(0,0,canvas.width,canvas.height);
   [['spin_mk',1],['spin_mk',-1],['spin_hk',1],['spin_hk',-1]].forEach(([id,facing],row)=>{
     const keys=animations[id].keyframes.filter((key,i,all)=>i===all.length-1||i%Math.ceil((all.length-1)/10)===0);
     keys.slice(0,-1).forEach((key,col)=>{
       const frame=(key.frame+keys[col+1].frame)/2;
       ctx.save();ctx.translate(col*180+(facing===1?65:115),row*270+230);ctx.scale(1.5,1.5);
       drawFigure(ctx,samplePose(id,frame),palette.p1,palette,facing,0,sampleDepths(id,frame),sampleTurn(id,frame),sampleYaw(id,frame),animations[id].fixedLegDepth);
       ctx.restore();ctx.fillStyle=palette.text;ctx.font='12px monospace';ctx.fillText(`${id} · ${frame}f`,col*180+10,row*270+24);
     });
   });
 });
 await page.locator('#spin-sheet').screenshot({path:`${output}/${name}-intermediate-poses.png`});

 await page.evaluate(()=>{document.querySelector('#spin-sheet').remove();document.querySelector('#spin-active').remove();});
 await page.setViewportSize({width:375,height:1100});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);console.log(`${name}: both spins for both players, reserved low chord, per-move damage, replay return, release-before-kick normal, themes, preview and narrow layout passed; box sheets saved.`);
} finally {await browser.close();}
