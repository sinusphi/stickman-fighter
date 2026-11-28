// Match-winner celebration: after the deciding round the winner turns to the
// viewer and raises a fist instead of lowering the arms (presentation only).
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { TEST_URL, chromeExecutable } from './smoke-env.mjs';

const output='test-results/victory';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:chromeExecutable(),headless:true,args:['--no-sandbox']});
try {
  const page=await browser.newPage({viewport:{width:1100,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(TEST_URL);
  const result=await page.evaluate(async()=>{
    const {createGame,snapshot,step}=await import('/src/simulation/state.ts');
    const {HitFeedback}=await import('/src/render/feedback.ts');
    const {MOVES}=await import('/src/data/schema.ts');
    const {render}=await import('/src/render/canvas.ts');
    const {fighterPose,VICTORY_FRAMES}=await import('/src/render/skeleton.ts');
    const {readPalette}=await import('/src/platform/theme.ts');
    const n={up:false,down:false,left:false,right:false,buttons:0};
    const palette=readPalette();
    /** Plays a scenario until matchOver plus `extra` frames; returns frames of the clip. */
    const play=(setup,extra,shots)=>{
      const game=createGame(),feedback=new HitFeedback();
      setup(game);
      const images=[],victories=[];let guard=0;
      while(game.round.phase!=='matchOver' && guard++<600){const old=snapshot(game);step(game,[n,n]);feedback.update(game,old);}
      for(let i=0;i<=extra;i++) {
        if(shots.includes(i)) {
          const canvas=document.createElement('canvas');canvas.width=960;canvas.height=420;
          render(canvas,game,snapshot(game),1,true,false,palette,feedback.levels,feedback.koFrames,undefined,false,feedback.relaxFrames,undefined,feedback.victoryFrames);
          images.push({frame:i,url:canvas.toDataURL()});
        }
        victories.push([...feedback.victoryFrames]);
        const old=snapshot(game);step(game,[n,n]);feedback.update(game,old);
      }
      return {game,feedback,images,victories};
    };
    // KO win: P1 lands a jab on a nearly beaten P2 in the deciding round.
    const ko=play(game=>{
      const f=game.fighters[0];game.round.wins=[1,0];f.x=400*256;game.fighters[1].x=448*256;game.fighters[1].hp=1;
      f.state='Attack';f.moveId='standing_lp';f.moveFrame=MOVES.standing_lp.startup-1;f.attackId=1;
    },120,[0,8,16,24,32,42,70,120]);
    // Time-over win for P2: no KO, the winner still celebrates.
    const time=play(game=>{
      game.round.wins=[0,1];game.round.timer=1;game.fighters[0].hp=40;game.fighters[0].x=300*256;game.fighters[1].x=600*256;
    },60,[60]);
    const winner=ko.game.fighters[0];
    const pose=fighterPose(winner,winner,1,true,undefined,undefined,0,VICTORY_FRAMES+10);
    const before=JSON.stringify(ko.game);render(document.createElement('canvas'),ko.game,snapshot(ko.game),1,true,false,palette,ko.feedback.levels,ko.feedback.koFrames,undefined,false,ko.feedback.relaxFrames,undefined,ko.feedback.victoryFrames);
    return {
      koPhase:ko.game.round.phase,koWinner:ko.game.round.winner,koVictory:ko.feedback.victoryFrames,koReason:ko.game.round.reason,
      timePhase:time.game.round.phase,timeReason:time.game.round.reason,timeVictory:time.feedback.victoryFrames,
      fist:pose.rightHand,head:pose.head,leftHand:pose.leftHand,hip:pose.hip,
      unchanged:before===JSON.stringify(ko.game),images:[...ko.images,...time.images.map(i=>({...i,frame:`time-${i.frame}`}))],
    };
  });
  expect(result.koPhase).toBe('matchOver');expect(result.koReason).toBe('KO');expect(result.koWinner).toBe(0);
  expect(result.koVictory[0]).toBeGreaterThan(60);expect(result.koVictory[1]).toBe(0);
  expect(result.timePhase).toBe('matchOver');expect(result.timeReason).toBe('TIME OVER');
  expect(result.timeVictory[1]).toBeGreaterThan(30);expect(result.timeVictory[0]).toBe(0);
  // The fist is raised clearly above the head, the other hand rests near the hip.
  expect(result.fist[1]).toBeLessThan(result.head[1]-15);
  expect(Math.abs(result.leftHand[1]-result.hip[1])).toBeLessThan(10);
  expect(result.unchanged).toBe(true);
  // Contact sheet of the clip for visual review.
  await page.setContent(`<body style="margin:0;background:#222;display:grid;grid-template-columns:1fr 1fr;gap:4px">${result.images.map(i=>`<figure style="margin:0;color:#ccc;font:12px monospace"><img src="${i.url}" style="width:540px"><figcaption>${i.frame}</figcaption></figure>`).join('')}</body>`);
  await page.screenshot({path:`${output}/victory-sheet.png`,fullPage:true});
  expect(errors).toEqual([]);
  console.log(`victory: KO winner celebrates (${result.koVictory[0]} frames), time-over winner too, loser stays down; state unchanged. Sheet: ${output}/victory-sheet.png`);
} finally {await browser.close();}
