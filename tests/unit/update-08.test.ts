import { expect, it } from 'vitest';
import { animations, samplePose, fighterPose } from '../../src/render/skeleton';
import { figureBottom } from '../../src/render/figure-geometry';
import { HitFeedback } from '../../src/render/feedback';
import { createGame, snapshot, step, updateFacing } from '../../src/simulation/state';
import { neutralInput } from '../../src/input/types';
import { MOVES } from '../../src/data/schema';

it('keeps every named limb in the same anatomical pose across mirrors and player sides',()=>{
  for(const [id,animation] of Object.entries(animations))for(const fraction of [0,.25,.5,.75,1]) {
    const time=(animation.durationFrames-1)*fraction,a=samplePose(id,time,1),b=samplePose(id,time,-1);
    for(const joint of Object.keys(a)) {
      expect(b[joint][0]).toBeCloseTo(-a[joint][0],10);
      expect(b[joint][1]).toBe(a[joint][1]);
    }
  }
  const game=createGame(),before=game.fighters.map(f=>fighterPose(f,f,0,true));
  [game.fighters[0].x,game.fighters[1].x]=[game.fighters[1].x,game.fighters[0].x];updateFacing(game);
  expect(game.fighters.map(f=>f.facing)).toEqual([-1,1]);
  expect(game.fighters.map(f=>fighterPose(f,f,0,true))).toEqual(before);
});

it('uses the left fist for all three punches on either side',()=>{
  for(const stance of ['standing','crouching','airborne'])for(const [button,joint] of [['lp','leftHand'],['mp','leftHand'],['hp','leftHand']]) {
    const id=`${stance}_${button}`,move=MOVES[id];
    for(const facing of [-1,1]) {
      const start=samplePose(id,0,facing),active=samplePose(id,move.startup,facing);
      const other=joint==='leftHand'?'rightHand':'leftHand';
      const travel=(j:string)=>Math.hypot(active[j][0]-start[j][0],active[j][1]-start[j][1]);
      if(button==='mp')expect(active.leftHand[0]*facing).toBeGreaterThan(active.rightHand[0]*facing+30);
      else expect(travel(joint),`${id}/${facing}`).toBeGreaterThan(travel(other));
    }
  }
});

it('settles the KO on its visible outline with a horizontal torso and separated bent limbs',()=>{
  const end=samplePose('KO',animations.KO.durationFrames-1);
  for(let time=0;time<animations.KO.durationFrames;time+=.25)expect(figureBottom(samplePose('KO',time))).toBeCloseTo(0,10);
  expect(Math.abs(end.neck[1]-end.hip[1])).toBeLessThan(3);
  expect(Math.abs(end.neck[0]-end.hip[0])).toBeGreaterThan(29);
  expect(Math.abs(end.leftKnee[1]-end.rightKnee[1])).toBeGreaterThan(10);
  expect(Math.hypot(end.leftHand[0]-end.rightHand[0],end.leftHand[1]-end.rightHand[1])).toBeGreaterThan(15);
  expect(samplePose('KO',1000)).toEqual(end);
  expect(samplePose('KO',6)).not.toEqual(end);
});

it.each([false,true])('animates a real lethal contact through hitstop and frozen round/match state (match=%s)',match=>{
  const game=createGame(),feedback=new HitFeedback();
  game.round.wins=[match?1:0,0];
  game.fighters[0].x=400*256;game.fighters[1].x=448*256;game.fighters[1].hp=30;
  for(let i=0;i<=MOVES.standing_lp.startup;i++) {
    const old=snapshot(game);
    step(game,[{...neutralInput(),buttons:i===0?1:0},neutralInput()]);feedback.update(game,old);
  }
  expect(game.fighters[1].state).toBe('KO');expect(game.round.phase).toBe(match?'matchOver':'roundOver');
  const frozenFighter=structuredClone(game.fighters[1]);
  while(game.hitstop) {const old=snapshot(game);step(game);feedback.update(game,old);expect(feedback.koFrames[1]).toBe(0);}
  for(let i=0;i<animations.KO.durationFrames-1;i++) {
    const old=snapshot(game);step(game);const before=snapshot(game);feedback.update(game,old);
    expect(game).toEqual(before); // Presentation must not mutate any combat data.
    expect(feedback.koFrames[1]).toBe(i+1);
  }
  expect(game.fighters[1]).toEqual(frozenFighter);
  const fighter=game.fighters[1];
  expect(fighterPose(fighter,fighter,.75,true,undefined,feedback.koFrames[1])).toEqual(samplePose('KO',animations.KO.durationFrames-1));
  feedback.reset(createGame());expect(feedback.koFrames).toEqual([0,0]);
});
