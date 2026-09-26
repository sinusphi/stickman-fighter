import { chromium, firefox, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
const engine=process.env.TEST_BROWSER==='firefox'?firefox:chromium;
const name=engine===firefox?'firefox':'chrome';
const browser=await engine.launch(engine===chromium?{executablePath:process.env.CHROME_PATH||(existsSync('/usr/bin/google-chrome-stable')?'/usr/bin/google-chrome-stable':undefined),headless:true,args:['--no-sandbox']}:{headless:true});
const url=process.env.TEST_URL||'http://127.0.0.1:5180';
const output='test-results/update-01';await mkdir(output,{recursive:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.locator('canvas[data-ready="true"]').waitFor();
  await page.locator('#pause').click();
  await expect(page.getByRole('progressbar')).toHaveCount(6);
  for(const theme of ['light','dark']) {
    if(theme==='light')await page.locator('#theme').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
    const frame=await page.locator('#game').getAttribute('data-frame');
    await expect.poll(async()=>page.evaluate(()=>{
      const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');
      const pixel=[...ctx.getImageData(0,0,1,1).data].slice(0,3);
      const token=getComputedStyle(document.documentElement).getPropertyValue('--arena').trim().slice(1).match(/../g).map(hex=>parseInt(hex,16));
      return JSON.stringify(pixel)===JSON.stringify(token);
    })).toBe(true);
    for(const fill of [0,25,100]) {
      // A real imported state exercises the production HUD; no game cheat hooks.
      const replay=await page.evaluate(async fill=>{
        const {createGame}=await import('/src/simulation/state.ts');
        const {createReplay}=await import('/src/debug/replay.ts');
        const game=createGame();
        for(const f of game.fighters)for(const r of Object.values(f.resources))r.current=fill;
        const replay=createReplay(game),n={up:false,down:false,left:false,right:false,buttons:0};
        replay.frames.push({inputs:[n,n],events:[]});return replay;
      },fill);
      await page.locator('#replay-file').setInputFiles({name:'resources.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(replay))});
      await page.locator('#play').click();await expect(page.locator('#notice')).toContainText('Replay ended');
      for(const owner of [0,1])for(const resource of ['revenge','special']) {
        const track=page.locator(`#resource-${owner}-${resource}`);
        await expect(track).toHaveAttribute('aria-valuenow',String(fill));
        expect(await track.locator('div').evaluate(el=>el.style.width)).toBe(`${fill}%`);
        if(fill>0) {
          const t=await track.boundingBox(),f=await track.locator('div').boundingBox();
          expect(Math.abs(owner===0?f.x-t.x-1:t.x+t.width-f.x-f.width-1)).toBeLessThan(1.1);
        }
      }
      await page.screenshot({path:`${output}/${name}-${theme}-${fill}.png`,fullPage:true});
      await page.locator('#play').click();
    }
    expect(await page.locator('#game').getAttribute('data-frame')).toBe(frame);
  }
  await page.reload();await page.locator('canvas[data-ready="true"]').waitFor();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.locator('#pause').click();
  await page.locator('#theme').focus();await page.keyboard.press('Space');
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await expect(page.locator('#theme')).toBeFocused();
  await page.keyboard.press('Space');
  for(const width of [600,375]) {
    await page.setViewportSize({width,height:1000});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(page.locator('#theme')).toBeVisible();
    const canvas=await page.locator('#game').boundingBox(),meters=await page.locator('.resource-hud').boundingBox();
    expect(meters.y).toBeGreaterThan(canvas.y+canvas.height*330/420);
    await page.screenshot({path:`${output}/${name}-dark-${width}.png`,fullPage:true});
  }
  // Native Canvas contact sheets for every attack at startup, active and recovery.
  await page.setViewportSize({width:1500,height:2000});
  await page.evaluate(async()=>{
    const {samplePose}=await import('/src/render/skeleton.ts');
    const {default:data}=await import('/src/data/poses.json');
    const {MOVES}=await import('/src/data/schema.ts');
    const canvas=document.createElement('canvas');canvas.id='pose-sheet';canvas.width=1500;canvas.height=Object.keys(MOVES).length*120+40;canvas.style.cssText=`width:1500px;height:${canvas.height}px;aspect-ratio:auto;`;document.body.append(canvas);
    const ctx=canvas.getContext('2d');ctx.fillStyle='#202724';ctx.fillRect(0,0,1500,canvas.height);
    Object.values(MOVES).forEach((move,row)=>{
      [0,move.startup-2,move.startup,move.startup+move.active+Math.floor(move.recovery/3),move.duration-1].forEach((frame,col)=>{
        const x=col*300+145,y=row*120+110,p=samplePose(move.id,frame);
        ctx.strokeStyle='#849184';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(col*300,y);ctx.lineTo(col*300+295,y);ctx.stroke();
        ctx.fillStyle='#b9c1b3';ctx.font='10px monospace';ctx.fillText(`${move.id} / ${frame}`,col*300+8,row*120+12);
        ctx.strokeStyle='#ff8b73';ctx.lineWidth=3;ctx.lineCap='round';
        for(const [a,b] of data.skeleton.segments){ctx.beginPath();ctx.moveTo(x+p[a][0],y+p[a][1]);ctx.lineTo(x+p[b][0],y+p[b][1]);ctx.stroke();}
        ctx.beginPath();ctx.ellipse(x+p.head[0],y+p.head[1],9,9,0,0,2*Math.PI);ctx.stroke();
      });
    });
  });
  await page.locator('#pose-sheet').screenshot({path:`${output}/${name}-all-attacks.png`});
  await page.evaluate(async()=>{
    const {samplePose,animations}=await import('/src/render/skeleton.ts');
    const {default:data}=await import('/src/data/poses.json');
    const names=Object.keys(animations).filter(id=>!id.includes('_'));
    const canvas=document.createElement('canvas');canvas.id='state-sheet';canvas.width=1500;canvas.height=names.length*140;canvas.style.cssText=`width:1500px;height:${canvas.height}px;aspect-ratio:auto;`;document.body.append(canvas);
    const ctx=canvas.getContext('2d'),style=getComputedStyle(document.documentElement);
    ctx.fillStyle=style.getPropertyValue('--arena');ctx.fillRect(0,0,canvas.width,canvas.height);
    names.forEach((id,row)=>[0,.25,.5,.75,1].forEach((fraction,col)=>{
      const time=(animations[id].durationFrames-1)*fraction,p=samplePose(id,time),x=col*300+145,y=row*140+120;
      ctx.strokeStyle=style.getPropertyValue('--ground');ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(col*300,y);ctx.lineTo(col*300+295,y);ctx.stroke();
      ctx.fillStyle=style.getPropertyValue('--muted');ctx.font='10px monospace';ctx.fillText(`${id} / ${time.toFixed(1)}`,col*300+8,row*140+12);
      ctx.strokeStyle=style.getPropertyValue('--p2');ctx.lineWidth=3;ctx.lineCap='round';
      for(const [a,b] of data.skeleton.segments){ctx.beginPath();ctx.moveTo(x+p[a][0],y+p[a][1]);ctx.lineTo(x+p[b][0],y+p[b][1]);ctx.stroke();}
      ctx.beginPath();ctx.arc(x+p.head[0],y+p.head[1],9,0,2*Math.PI);ctx.stroke();
    }));
    const {render}=await import('/src/render/canvas.ts');const {createGame}=await import('/src/simulation/state.ts');const {readPalette}=await import('/src/platform/theme.ts');
    const game=createGame();game.fighters[0].x=400*256;game.fighters[1].x=448*256;
    game.fighters[0].state='Attack';game.fighters[0].moveId='standing_hp';game.fighters[0].moveFrame=9;
    game.fighters[1].state='Blockstun';game.fighters[1].remaining=15;
    const boxes=document.createElement('canvas');boxes.id='pose-boxes';boxes.width=960;boxes.height=420;boxes.style.cssText='width:960px;height:420px';document.body.append(boxes);
    render(boxes,game,game,1,true,true,readPalette());
  });
  await page.locator('#state-sheet').screenshot({path:`${output}/${name}-all-states.png`});
  await page.locator('#pose-boxes').screenshot({path:`${output}/${name}-block-boxes.png`});
  const blocked=await browser.newPage();
  await blocked.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw Error('storage disabled');}});});
  await blocked.goto(url);await blocked.locator('canvas[data-ready="true"]').waitFor();
  await blocked.locator('#theme').click();await expect(blocked.locator('html')).toHaveAttribute('data-theme','dark');
  expect(errors).toEqual([]);
  console.log(`${name}: theme persistence/keyboard/storage fallback, Canvas colors, six meters at 0/25/100%, mirrored fill, replay return, narrow layout and all attack contact sheets passed.`);
} finally {await browser.close();}
