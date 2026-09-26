import { chromium, firefox, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
const engine=process.env.TEST_BROWSER==='firefox'?firefox:chromium;
const name=engine===firefox?'firefox':'chrome';
const browser=await engine.launch(engine===chromium?{executablePath:process.env.CHROME_PATH||(existsSync('/usr/bin/google-chrome-stable')?'/usr/bin/google-chrome-stable':undefined),headless:true,args:['--no-sandbox']}:{headless:true});
const output='test-results/update-02';await mkdir(output,{recursive:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:5180');await page.locator('#game[data-ready="true"]').waitFor();
  await page.locator('#animation-preview summary').click();
  await expect(page.locator('#pause')).toHaveText('Resume · P');
  const frame=await page.locator('#game').getAttribute('data-frame');
  const scrub=async value=>{
    await page.locator('#preview-time').fill(String(value));
    await expect(page.locator('#preview-canvas')).toHaveAttribute('data-frame',value.toFixed(2));
  };
  for(const theme of ['light','dark']) {
    if(theme==='light')await page.locator('#theme').click();
    for(const mode of ['Body','Legs'])for(const direction of ['CW','CCW']) {
      const id=`Demo${mode}${direction}`;await page.locator('#preview-animation').selectOption(id);
      await scrub(42);
      await expect(page.locator('#preview-status')).toContainText(direction==='CW'?'180.0° · ↻':'-180.0° · ↺');
      const frozen=await page.locator('#preview-canvas').evaluate(c=>c.toDataURL());
      await page.waitForTimeout(100);
      expect(await page.locator('#preview-canvas').evaluate(c=>c.toDataURL())).toBe(frozen);
      await page.locator('#preview-step').click();await expect(page.locator('#preview-canvas')).toHaveAttribute('data-frame','43.00');
      await page.locator('#preview-mirror').click();
      await expect(page.locator('#preview-status')).toContainText(direction==='CW'?'↺':'↻');
      await page.locator('#preview-mirror').click();
      await scrub(57);await page.locator('#animation-preview').screenshot({path:`${output}/${name}-${theme}-${id}.png`});
    }
    for(const id of ['HitLOW','HitMID','HitHIGH','Landing']) {
      await page.locator('#preview-animation').selectOption(id);await scrub(0);
      await page.locator('#animation-preview').screenshot({path:`${output}/${name}-${theme}-${id}.png`});
    }
    await page.screenshot({path:`${output}/${name}-${theme}-page.png`,fullPage:true});
  }
  await page.locator('#preview-animation').selectOption('DemoBodyCW');
  await page.locator('#preview-play').click();
  await expect.poll(async()=>Number(await page.locator('#preview-canvas').getAttribute('data-frame'))).toBeGreaterThan(2);
  await page.locator('#preview-play').click();
  const stopped=await page.locator('#preview-canvas').getAttribute('data-frame');await page.waitForTimeout(100);
  expect(await page.locator('#preview-canvas').getAttribute('data-frame')).toBe(stopped);
  await scrub(104.75);await page.locator('#preview-play').click();await expect(page.locator('#preview-canvas')).toHaveAttribute('data-frame','105.00');
  await expect(page.locator('#preview-play')).toHaveText('Play');
  await page.locator('#preview-reset').click();await expect(page.locator('#preview-canvas')).toHaveAttribute('data-frame','0.00');
  expect(await page.locator('#game').getAttribute('data-frame')).toBe(frame);
  for(const width of [600,375]) {
    await page.setViewportSize({width,height:1100});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.locator('#animation-preview').screenshot({path:`${output}/${name}-preview-${width}.png`});
  }
  await page.setViewportSize({width:1440,height:1100});
  // Import a one-frame real contact: verifies main.ts retains its level before
  // playback pauses, and production pixels match the correct reaction + flash.
  for(const [moveId,level] of [['standing_lk','LOW'],['standing_lp','MID']]) {
    const fixture=await page.evaluate(async ({moveId,level})=>{
      const {createGame,snapshot,step}=await import('/src/simulation/state.ts');
      const {createReplay}=await import('/src/debug/replay.ts');
      const {MOVES}=await import('/src/data/schema.ts');
      const {render}=await import('/src/render/canvas.ts');
      const {readPalette}=await import('/src/platform/theme.ts');
      const game=createGame(),f=game.fighters[0];f.x=400*256;game.fighters[1].x=440*256;
      f.state='Attack';f.moveId=moveId;f.moveFrame=MOVES[moveId].startup-1;f.attackId=1;
      const replay=createReplay(game),n={up:false,down:false,left:false,right:false,buttons:0};
      replay.frames.push({inputs:[n,n],events:[]});step(game,[n,n]);
      const canvas=document.createElement('canvas');canvas.width=960;canvas.height=420;
      render(canvas,game,snapshot(game),1,true,false,readPalette(),[undefined,level]);
      return {replay,hp:game.fighters[1].hp,image:canvas.toDataURL()};
    },{moveId,level});
    expect(fixture.hp).toBeLessThan(1000);
    await page.locator('#replay-file').setInputFiles({name:'hit.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture.replay))});
    await page.locator('#play').click();await expect(page.locator('#notice')).toContainText('Replay ended');
    await expect.poll(()=>page.locator('#game').evaluate(c=>c.toDataURL())).toBe(fixture.image);
    await page.locator('#game').screenshot({path:`${output}/${name}-contact-${level}.png`});
    await page.locator('#play').click();
  }
  // Production drawFigure/drawTrail, not an imitation of the old line renderer.
  await page.evaluate(async()=>{
    const {samplePose,sampleTrail}=await import('/src/render/skeleton.ts');
    const {drawFigure,drawTrail}=await import('/src/render/figure.ts');
    const {sampleDepths}=await import('/src/render/depth.ts');
    const {readPalette}=await import('/src/platform/theme.ts');
    const palette=readPalette(),canvas=document.createElement('canvas');canvas.id='rotation-sheet';canvas.width=1200;canvas.height=1000;
    canvas.style.cssText='width:1200px;height:1000px;aspect-ratio:auto';document.body.append(canvas);
    const ctx=canvas.getContext('2d');ctx.fillStyle=palette.arena;ctx.fillRect(0,0,1200,1000);
    ['DemoBodyCW','DemoBodyCCW','DemoLegsCW','DemoLegsCCW'].forEach((id,row)=>[12,27,42,57,67].forEach((t,col)=>{
      ctx.save();ctx.translate(col*240+120,row*250+135);ctx.scale(1.2,1.2);
      const pose=samplePose(id,t);drawTrail(ctx,sampleTrail(id,t),palette.p2);drawFigure(ctx,pose,palette.p1,palette,1,0,sampleDepths(id,t));
      ctx.fillStyle=palette.p2;ctx.beginPath();ctx.arc(...pose.leftFoot,4,0,Math.PI*2);ctx.fill();ctx.restore();
      ctx.fillStyle=palette.text;ctx.font='12px monospace';ctx.fillText(`${id} · ${t}f`,col*240+12,row*250+24);
    }));
    const {MOVES}=await import('/src/data/schema.ts');
    const states=['HitLOW','HitMID','HitHIGH','Landing','Airborne',...Object.keys(MOVES)];
    const sheet=document.createElement('canvas');sheet.id='motion-sheet';sheet.width=1200;sheet.height=states.length*140;sheet.style.cssText=`width:1200px;height:${sheet.height}px;aspect-ratio:auto`;document.body.append(sheet);
    const c=sheet.getContext('2d');c.fillStyle=palette.arena;c.fillRect(0,0,sheet.width,sheet.height);
    states.forEach((id,row)=>{
      const m=MOVES[id],times=m?[0,m.startup-2,m.startup,m.startup+m.active+1,m.duration-1]:id==='Landing'?[0,.5,1,1.5,2]:[0,2,4,8,10];
      times.forEach((t,col)=>{
        c.save();c.translate(col*240+120,row*140+125);drawTrail(c,sampleTrail(id,t),palette.p2,.65,false);drawFigure(c,samplePose(id,t),palette.p1,palette,1,0,sampleDepths(id,t));c.restore();
        c.fillStyle=palette.text;c.font='12px monospace';c.fillText(`${id} · ${t}f`,col*240+12,row*140+16);
      });
    });
  });
  await page.locator('#rotation-sheet').screenshot({path:`${output}/${name}-rotation-sheet.png`});
  await page.locator('#motion-sheet').screenshot({path:`${output}/${name}-motion-sheet.png`});
  expect(errors).toEqual([]);
  console.log(`${name}: rotation/reaction preview, both themes, pause/step/scrub/play/end/reset/mirror, game isolation and narrow layouts passed; production-renderer sheets saved.`);
} finally {await browser.close();}
