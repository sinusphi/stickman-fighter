import { expect, it } from 'vitest';
import { animations, animationId, samplePose, sampleTurn } from '../../src/render/skeleton';
import { MOVES, validatePoses } from '../../src/data/schema';
import poses from '../../src/data/poses.json';
import { createGame, step, snapshot } from '../../src/simulation/state';
import { neutralInput, buttonBit } from '../../src/input/types';
import { createReplay, parseReplay, playReplay } from '../../src/debug/replay';
import { pushbox } from '../../src/simulation/collision';
import rules from '../../src/data/rules.json';

it.each(['standing','crouching','airborne'])('%s turns through the left punch and returns all strikes to guard',stance=>{
  for(const suffix of ['mp','rlk','mk','rhk']) {
    const id=`${stance}_${suffix}`,move=MOVES[id];
    expect(sampleTurn(id,0)).toBe(0);expect(sampleTurn(id,move.startup)).toBe(suffix==='mp'?1:0);
    expect(sampleTurn(id,move.duration-1)).toBe(0);
    expect(samplePose(id,move.duration-1)).toEqual(samplePose(id,0));
    expect(animations[id].trail?.joint).toBe(suffix==='mp'?'leftHand':'rightFoot');
  }
  for(const side of ['left','right']) {
    const ids=(side==='left'?['lk','lmk','hk']:['rlk','mk','rhk']).map(s=>`${stance}_${s}`);
    const heights=ids.map(id=>samplePose(id,MOVES[id].startup)[side+'Foot'][1]);
    expect(heights[0]-heights[1]).toBeGreaterThan(15);
    expect(heights[1]-heights[2]).toBeGreaterThan(4);
  }
});

it.each([1,-1])('only unblocked middle punches buckle and slide a grounded target, facing %s',facing=>{
 for(const blocked of [false,true]) {
  const game=createGame(),[a,b]=game.fighters;a.x=480*256;b.x=a.x+facing*40*256;
  if(blocked){b.state='Blockstun';b.remaining=30;}
  const replay=createReplay(game);let contactX=0,contacted=false,slide=0;
  for(let frame=0;frame<45;frame++) {
   const inputs:[ReturnType<typeof neutralInput>,ReturnType<typeof neutralInput>]=[
    {...neutralInput(),buttons:frame===0?buttonBit('MP'):0},
    {...neutralInput(),left:blocked&&facing===-1,right:blocked&&facing===1}];
   const wasContacted=contacted,oldX=b.x,oldStop=game.hitstop;
   replay.frames.push({inputs,events:[]});step(game,inputs);
   if(!contacted&&game.lastContact) {
    contacted=true;contactX=b.x;
    expect(game.lastContact.blocked).toBe(blocked);
    expect(b.hitReaction).toBe(blocked?undefined:'middlePunch');
    expect(animationId(b,'MID')).toBe(blocked?'Blockstun':'HitMiddlePunch');
    expect(b.vx).toBe(blocked?0:facing*1536);
   }
   if(wasContacted&&oldStop)expect(b.x).toBe(oldX);
   if(contacted&&b.state==='Hitstun')slide=Math.max(slide,(b.x-contactX)*facing/256);
  }
  expect(contacted).toBe(true);expect(slide).toBe(blocked?0:39);
  expect(b.hitReaction).toBeUndefined();
  expect(playReplay(parseReplay(replay))).toEqual(snapshot(game));
 }
});
it.each([1,-1])('keeps sliding targets within the arena at either wall (%s)',facing=>{
 const game=createGame(),[a,b]=game.fighters;
 b.x=facing===1?rules.stageWidth-30*256:30*256;a.x=b.x-facing*40*256;
 for(let frame=0;frame<40;frame++) {
  step(game,[{...neutralInput(),buttons:frame===0?buttonBit('MP'):0},neutralInput()]);
  for(const f of game.fighters){const box=pushbox(f);expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(rules.stageWidth);}
 }
 expect(b.hp).toBeLessThan(1000);
});
it('rejects invalid turn metadata',()=>{
 const data=structuredClone(poses);data.animations.standing_mp.keyframes[0].turn=2;
 expect(()=>validatePoses(data)).toThrow(/Körperdrehung/);
});

it('resumes a replay snapshot during the slide without losing reaction or momentum',()=>{
 const game=createGame();game.fighters[0].x=400*256;game.fighters[1].x=440*256;
 for(let frame=0;!game.lastContact&&frame<20;frame++)step(game,[{...neutralInput(),buttons:frame===0?buttonBit('MP'):0},neutralInput()]);
 expect(game.fighters[1].hitReaction).toBe('middlePunch');
 const replay=createReplay(game);
 for(let frame=0;frame<35;frame++){const inputs:[ReturnType<typeof neutralInput>,ReturnType<typeof neutralInput>]=[neutralInput(),neutralInput()];replay.frames.push({inputs,events:[]});step(game,inputs);}
 expect(playReplay(parseReplay(replay))).toEqual(game);
});
