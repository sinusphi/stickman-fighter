import { chromium, firefox, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
const engine=process.env.TEST_BROWSER==='firefox'?firefox:chromium;
const name=engine===firefox?'firefox':'chrome',output='test-results/leg-kicks/style';
await mkdir(output,{recursive:true});
const browser=await engine.launch(engine===chromium?{executablePath:process.env.CHROME_PATH||(existsSync('/usr/bin/google-chrome-stable')?'/usr/bin/google-chrome-stable':undefined),headless:true,args:['--no-sandbox']}:{headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:5180');
  await page.locator('#game[data-ready="true"]').waitFor();await page.locator('#pause').click();
  for(const theme of ['light','dark']) {
    if(theme==='dark')await page.locator('#theme').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
    const result=await page.evaluate(async()=>{
      const {samplePose,animations,sampleTurn}=await import('/src/render/skeleton.ts');
      const {drawFigure:drawBaseFigure}=await import('/src/render/figure.ts');
      const {FIGURE_SCALE}=await import('/src/data/figure-scale.ts');
      const {sampleDepths}=await import('/src/render/depth.ts');
      const drawFigure=(ctx,...args)=>{ctx.save();ctx.scale(FIGURE_SCALE,FIGURE_SCALE);drawBaseFigure(ctx,...args);ctx.restore();};
      const {readPalette,FIGURE_STYLE}=await import('/src/platform/theme.ts');
      const {createGame,snapshot}=await import('/src/simulation/state.ts');
      const {render}=await import('/src/render/canvas.ts');
      const {MOVES}=await import('/src/data/schema.ts');
      const p=readPalette();
      document.querySelectorAll('.style-sheet').forEach(el=>el.remove());
      const sheet=(id,width,height)=>{
        const c=document.createElement('canvas');c.id=id;c.className='style-sheet';c.width=width;c.height=height;
        c.style.cssText=`width:${width}px;height:${height}px;max-width:none;aspect-ratio:auto`;
        document.body.append(c);const ctx=c.getContext('2d');ctx.fillStyle=p.arena;ctx.fillRect(0,0,width,height);return [c,ctx];
      };
      // Fresh native-resolution renders for pixel measurement; no image resize.
      const standingPose=samplePose('Idle',0);
      const [,standing]=sheet('style-eye-standing',600,800);
      standing.translate(300,740);standing.scale(5,5);
      drawFigure(standing,standingPose,p.p1,p,1,0,sampleDepths('Idle',0));
      const [,closeup]=sheet('style-eye-closeup',720,420);
      for(const facing of [1,-1]) {
        closeup.save();closeup.beginPath();closeup.rect(facing===1?0:360,0,360,420);closeup.clip();
        closeup.translate(facing===1?180:540,155);closeup.scale(8,8);
        closeup.translate(-facing*standingPose.head[0]*FIGURE_SCALE,-standingPose.head[1]*FIGURE_SCALE);
        drawFigure(closeup,standingPose,facing===1?p.p1:p.p2,p,facing,0,sampleDepths('Idle',0));
        closeup.restore();
      }
      const [,pair]=sheet('style-facing-pair',1000,700);
      for(const facing of [1,-1]) {
        pair.save();pair.translate(facing===1?250:750,650);pair.scale(4.5,4.5);
        drawFigure(pair,standingPose,facing===1?p.p1:p.p2,p,facing,0,sampleDepths('Idle',0));
        pair.restore();
      }
      const [hero,h]=sheet('style-hero',1200,990);
      const examples=[['Idle',0],['Blockstun',0],['CrouchBlock',0],['spin_mk',13],['spin_mk',14],['spin_mk',37],['Walk',0],['Walk',8],['KO',36]];
      examples.forEach(([id,time],i)=>{
        const facing=i%2?-1:1,x=(i%3)*400+200,y=Math.floor(i/3)*330+300;
        h.save();h.translate(x,y);h.scale(2,2);drawFigure(h,samplePose(id,time),i%2?p.p2:p.p1,p,facing,0,sampleDepths(id,time),sampleTurn(id,time));h.restore();
        h.fillStyle=p.text;h.font='14px monospace';h.fillText(`${id} / ${time} · P${i%2+1}`,i%3*400+20,Math.floor(i/3)*330+24);
      });
      const ids=Object.keys(animations),[all,c]=sheet('style-all',1200,ids.length*160);
      ids.forEach((id,row)=>[0,.25,.5,.75,1].forEach((fraction,col)=>{
        const time=(animations[id].durationFrames-1)*fraction,facing=col%2?-1:1;
        c.save();c.translate(col*240+120,row*160+132);
        drawFigure(c,samplePose(id,time),col%2?p.p2:p.p1,p,facing,0,sampleDepths(id,time),sampleTurn(id,time));c.restore();
        c.fillStyle=p.text;c.font='11px monospace';c.fillText(`${id} / ${time.toFixed(1)}`,col*240+8,row*160+16);
      }));
      const [ko,kctx]=sheet('style-ko',1200,600);
      [0,6,14,23,32,36].forEach((time,i)=>{
        kctx.save();kctx.translate(i%3*400+200,Math.floor(i/3)*300+270);kctx.scale(2,2);
        drawFigure(kctx,samplePose('KO',time),p.p1,p,1,0,sampleDepths('KO',time));kctx.restore();
        kctx.fillStyle=p.text;kctx.font='14px monospace';kctx.fillText(`KO / ${time}`,i%3*400+20,Math.floor(i/3)*300+24);
      });
      // Isolate geometric reflection by compensating the expected depth reversal.
      // Natural opposing views MUST have different front/back occlusion.
      const mirrorErrors=[];
      for(const id of ids)for(const fraction of [0,.25,.5,.75,1]) {
        const time=(animations[id].durationFrames-1)*fraction,images=[];
        for(const facing of [1,-1]) {
          const canvas=document.createElement('canvas');canvas.width=400;canvas.height=400;
          const ctx=canvas.getContext('2d');ctx.fillStyle=p.arena;ctx.fillRect(0,0,400,400);
          ctx.translate(200,220);
          const depths=sampleDepths(id,time);
          const referenceDepths=facing===1?Object.fromEntries(Object.entries(depths).map(([key,value])=>{
            const side=['left','right'].find(side=>['Shoulder','Elbow','Hand'].some(part=>key===side+part));
            return [key,['neck','head','headCircle'].includes(key)?value:side?value-2*depths[side+'Shoulder']:-value];
          })):depths;
          drawFigure(ctx,samplePose(id,time),p.p1,p,facing,0,referenceDepths);
          images.push(ctx.getImageData(0,0,400,400).data);
        }
        let difference=0,foreground=0;
        const background=p.arena.slice(1).match(/../g).map(v=>parseInt(v,16));
        for(let y=0;y<400;y++)for(let x=0;x<400;x++) {
          const a=(y*400+x)*4,b=(y*400+399-x)*4;
          if(background.every((v,c)=>images[0][a+c]===v&&images[1][b+c]===v))continue;
          foreground++;
          for(let channel=0;channel<3;channel++)difference+=Math.abs(images[0][a+channel]-images[1][b+channel]);
        }
        mirrorErrors.push({id,time,error:difference/(foreground*3)});
      }
      const game=createGame();game.fighters[0].x=400*256;game.fighters[1].x=452*256;
      const f=game.fighters[0];f.state='Attack';f.moveId='spin_mk';f.moveFrame=MOVES.spin_mk.startup;
      const before=JSON.stringify(game),[box]=sheet('style-boxes',960,420);
      render(box,game,snapshot(game),1,false,true,p);
      // Large isolated native renderer sample: filled head, opaque crossed
      // segments, and a bright single eye; pixel probes are away from AA edges.
      const probe=document.createElement('canvas');probe.width=400;probe.height=760;
      const ctx=probe.getContext('2d'),pose=samplePose('Idle',0);
      ctx.fillStyle=p.arena;ctx.fillRect(0,0,400,760);ctx.translate(200,690);ctx.scale(5,5);
      drawFigure(ctx,pose,p.p1,p);
      const pixel=(x,y)=>[...ctx.getImageData(Math.round(200+x*5*FIGURE_SCALE),Math.round(690+y*5*FIGURE_SCALE),1,1).data];
      const head=pixel(...pose.head),hip=pixel(...pose.hip),bg=p.arena.slice(1).match(/../g).map(v=>parseInt(v,16));
      // Isolate two crossing upper arms. Swapping only their depths must put
      // the foreground contour over the rear fill at the crossing boundary.
      const crossing=Object.fromEntries(Object.keys(pose).map(j=>[j,[-1000,-1000]]));
      Object.assign(crossing,{leftShoulder:[-20,-20],leftElbow:[20,20],leftHand:[40,20],rightShoulder:[-20,20],rightElbow:[20,-20],rightHand:[40,-20]});
      const crossingPixels=[];
      for(const leftFront of [true,false]) {
        const [,cross]=sheet(`style-cross-${leftFront}`,300,300);
        cross.translate(150,150);cross.scale(4,4);
        drawFigure(cross,crossing,p.p1,p,1,0,{...sampleDepths('Idle',0),leftShoulder:leftFront?29:-31,leftElbow:leftFront?30:-30,leftHand:leftFront?31:-29,rightShoulder:leftFront?-31:29,rightElbow:leftFront?-30:30,rightHand:leftFront?-29:31});
        crossingPixels.push([...cross.getImageData(Math.round(150+2.9*4*FIGURE_SCALE),Math.round(150-2.9*4*FIGURE_SCALE),1,1).data]);
      }

      // A natural turn must swap which arm occludes the other, not merely
      // reflect an unchanged back view. Pixel probes follow the same joint.
      const turnPixels=[];
      for(const facing of [1,-1]) {
        const [,turned]=sheet(`style-turn-${facing}`,300,300);
        turned.translate(150,150);turned.scale(4,4);
        drawFigure(turned,crossing,p.p1,p,facing,0,{...sampleDepths('Idle',0),leftShoulder:29,leftElbow:30,leftHand:31,rightShoulder:-31,rightElbow:-30,rightHand:-29});
        const pixelX=Math.round(150+2.9*4*FIGURE_SCALE);
        turnPixels.push([...turned.getImageData(facing===1?pixelX:299-pixelX,Math.round(150-2.9*4*FIGURE_SCALE),1,1).data]);
      }

      // A normal 90-degree elbow must have no internal dark ring, even
      // when its two bones have opposite depth signs. Probe the old cap seam.
      const jointPose=Object.fromEntries(Object.keys(pose).map(j=>[j,[-1000,-1000]]));
      Object.assign(jointPose,{leftShoulder:[-24,0],leftElbow:[0,0],leftHand:[0,-24]});
      const jointPixels=[],colorPixels=[];
      for(const sign of [-1,1]) {
        const [,joint]=sheet(`style-joint-${sign}`,300,300);
        joint.translate(150,150);joint.scale(4,4);
        drawFigure(joint,jointPose,p.p1,p,1,0,{...sampleDepths('Idle',0),leftElbow:sign*30,leftHand:-sign*30});
        for(const [x,y] of [[-3,0],[-2,-2],[0,-3],[0,0]])
          jointPixels.push([...joint.getImageData(Math.round(150+x*4*FIGURE_SCALE),Math.round(150+y*4*FIGURE_SCALE),1,1).data]);
        colorPixels.push([...joint.getImageData(Math.round(150-16*4*FIGURE_SCALE),150,1,1).data]);
      }
      // The central torso must remain filled through the shoulder-to-hip span.
      const torsoPixels=[];
      for(const t of [.4,.5,.6,.7,.8])for(const dx of [-1,0,1])
        torsoPixels.push(pixel(pose.neck[0]+(pose.hip[0]-pose.neck[0])*t+dx,pose.neck[1]+(pose.hip[1]-pose.neck[1])*t));
      const player=p.p1.slice(1).match(/../g).map(v=>parseInt(v,16));

      const angle=Math.atan2(pose.head[1]-pose.neck[1],pose.head[0]-pose.neck[0])+Math.PI/2;
      const e=FIGURE_STYLE.eye,r=FIGURE_STYLE.headRadius,ex=e.vertices.reduce((sum,v)=>sum+v[0],0)/3*r,ey=e.vertices.reduce((sum,v)=>sum+v[1],0)/3*r;
      const eye=pixel(pose.head[0]+Math.cos(angle)*ex-Math.sin(angle)*ey,pose.head[1]+Math.sin(angle)*ex+Math.cos(angle)*ey);
      // Measure actual Canvas path vertices after all transforms, independently
      // of the style constants. Undo head tilt to compare with reference axes.
      const eyeGeometry=[];
      for(const facing of [1,-1])for(const tilt of [0,.35,-.5]) {
        const canvas=document.createElement('canvas'),context=canvas.getContext('2d');
        const scale=2.4*FIGURE_SCALE,origin=[180,210],head=[7,-70],radius=FIGURE_STYLE.headRadius;
        const measured=[],testPose=structuredClone(pose);
        testPose.head=head;testPose.neck=[head[0]-Math.sin(tilt)*10,head[1]+Math.cos(tilt)*10];
        context.translate(...origin);context.scale(2.4,2.4);
        for(const method of ['moveTo','lineTo']) {
          const original=context[method].bind(context);
          context[method]=(x,y)=>{
            const point=new DOMPoint(x,y).matrixTransform(context.getTransform());
            const dx=(point.x-origin[0])/scale-facing*head[0],dy=(point.y-origin[1])/scale-head[1];
            measured.push([(Math.cos(tilt)*dx+facing*Math.sin(tilt)*dy)/radius,
              (-facing*Math.sin(tilt)*dx+Math.cos(tilt)*dy)/radius]);
            original(x,y);
          };
        }
        drawFigure(context,testPose,p.p1,p,facing);
        eyeGeometry.push({facing,tilt,measured});
      }
      return {turnPixels,eyeGeometry,mirrorErrors,torsoPixels,count:ids.length,unchanged:before===JSON.stringify(game),head,hip,eye,bg,crossingPixels,jointPixels,colorPixels,player};
    });
    expect(result.unchanged).toBe(true);
    expect(result.turnPixels[1].slice(0,3).reduce((a,b)=>a+b,0)).toBeLessThan(result.turnPixels[0].slice(0,3).reduce((a,b)=>a+b,0)-20);
    for(const {facing,tilt,measured} of result.eyeGeometry) {
      expect(measured).toHaveLength(3);
      [[.71,-.10],[.58,.15],[.88,.28]].forEach(([baseX,baseY],i)=>{
        const x=(.71+.58+.88)/3+(baseX-(.71+.58+.88)/3)*1.21;
        const y=(-.10+.15+.28)/3+(baseY-(-.10+.15+.28)/3)*1.21;
        expect(measured[i][0],`eye X ${facing}/${tilt}/${i}`).toBeCloseTo(facing*x,5);
        expect(measured[i][1],`eye Y ${facing}/${tilt}/${i}`).toBeCloseTo(y,5);
      });
    }
    console.log(`${name}/${theme}: eye A=(.71,-.10), B=(.58,.15), C=(.88,.28) R enlarged 21% about centroid, verified from Canvas paths; both mirrors, three head tilts.`);
    const worstMirror=result.mirrorErrors.reduce((a,b)=>a.error>b.error?a:b);
    console.log(`${name}/${theme}: maximum mirror error ${worstMirror.error.toFixed(3)} / 255 foreground channel levels (${worstMirror.id}).`);
    // Chrome rasterises reflected curves slightly differently at AA boundaries.
    for(const {id,time,error} of result.mirrorErrors)expect(error,`${id}/${time} mirrored image`).toBeLessThan(1);
    for(const pixel of result.torsoPixels)pixel.slice(0,3).forEach((v,i)=>expect(v,'torso seam').toBeGreaterThanOrEqual(result.player[i]-2));
    expect(result.colorPixels[0]).toEqual(result.colorPixels[1]);
    for(const pixel of result.jointPixels) {
      expect(pixel[3]).toBe(255);
      pixel.slice(0,3).forEach((channel,i)=>expect(channel).toBeGreaterThanOrEqual(result.player[i]-2));
    }
    expect(result.crossingPixels[1].slice(0,3).reduce((a,b)=>a+b,0)).toBeLessThan(result.crossingPixels[0].slice(0,3).reduce((a,b)=>a+b,0)-20);
    expect(result.head.slice(0,3)).not.toEqual(result.bg);expect(result.head[3]).toBe(255);
    expect(result.hip.slice(0,3)).not.toEqual(result.bg);expect(result.hip[3]).toBe(255);
    expect(Math.min(...result.eye.slice(0,3))).toBeGreaterThan(230);
    for(const id of ['facing-pair','eye-standing','eye-closeup','hero','ko','all','boxes','cross-true','cross-false','joint--1','joint-1'])await page.locator(`#style-${id}`).screenshot({path:`${output}/${name}-${theme}-${id}.png`});
    await page.locator('#game').screenshot({path:`${output}/${name}-${theme}-game.png`});
    // Populate presentation-only meter samples to compare all four HUD colors.
    await page.addStyleTag({content:'.resource-fill{width:65% !important}'});
    await page.locator('.arena').screenshot({path:`${output}/${name}-${theme}-hud.png`});
    console.log(`${name}/${theme}: ${result.count} animations, both player colors/facings, seamless silhouette and depth occlusion, filled head/joints, luminous eye, debug overlay; state unchanged.`);
  }
  // Real replay playback verifies the presentation clock survives the frozen
  // round/match state and is passed through main.ts to the production renderer.
  for(const match of [false,true])for(const count of [18,55]) {
    const fixture=await page.evaluate(async({match,count})=>{
      const {createGame,snapshot,step}=await import('/src/simulation/state.ts');
      const {createReplay}=await import('/src/debug/replay.ts');
      const {HitFeedback}=await import('/src/render/feedback.ts');
      const {MOVES}=await import('/src/data/schema.ts');
      const {render}=await import('/src/render/canvas.ts');
      const {readPalette}=await import('/src/platform/theme.ts');
      const game=createGame(),feedback=new HitFeedback(),f=game.fighters[0];
      game.round.wins=[match?1:0,0];f.x=400*256;game.fighters[1].x=448*256;game.fighters[1].hp=30;
      f.state='Attack';f.moveId='standing_lp';f.moveFrame=MOVES.standing_lp.startup-1;f.attackId=1;
      const replay=createReplay(game),n={up:false,down:false,left:false,right:false,buttons:0};
      for(let i=0;i<count;i++) {
        replay.frames.push({inputs:[n,n],events:[]});const old=snapshot(game);step(game,[n,n]);feedback.update(game,old);
      }
      const canvas=document.createElement('canvas');canvas.width=960;canvas.height=420;
      render(canvas,game,snapshot(game),1,true,false,readPalette(),feedback.levels,feedback.koFrames);
      return {replay,image:canvas.toDataURL(),koFrame:feedback.koFrames[1],phase:game.round.phase};
    },{match,count});
    expect(fixture.phase).toBe(match?'matchOver':'roundOver');
    expect(fixture.koFrame).toBe(count===55?36:11);
    await page.locator('#replay-file').setInputFiles({name:'ko.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture.replay))});
    await page.locator('#play').click();await expect(page.locator('#notice')).toContainText('Replay beendet');
    await expect.poll(()=>page.locator('#game').evaluate(c=>c.toDataURL())).toBe(fixture.image);
    await page.locator('#game').screenshot({path:`${output}/${name}-ko-${match?'match':'round'}-${count}.png`});
    await page.locator('#play').click();
  }
  await page.locator('#animation-preview summary').click();
  await page.locator('#preview-animation').selectOption('KO');
  await page.locator('#preview-time').fill('36');
  await expect(page.locator('#preview-canvas')).toHaveAttribute('data-frame','36.00');
  await page.locator('#animation-preview').screenshot({path:`${output}/${name}-ko-preview.png`});
  await page.locator('#animation-preview summary').click();
  await page.evaluate(()=>document.querySelectorAll('.style-sheet').forEach(el=>el.remove()));
  await page.setViewportSize({width:375,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`${output}/${name}-375.png`,fullPage:true});
  expect(errors).toEqual([]);
} finally {await browser.close();}
