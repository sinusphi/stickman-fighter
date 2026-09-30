import { expect, it } from 'vitest';
import { animations, samplePose, sampleAngles, animationId } from '../../src/render/skeleton';
import { createGame, step } from '../../src/simulation/state';
import { neutralInput, buttonBit } from '../../src/input/types';
import { createReplay, parseReplay, playReplay } from '../../src/debug/replay';
import { FIGURE_SCALE } from '../../src/data/figure-scale';
import { pushbox } from '../../src/simulation/collision';
import rules from '../../src/data/rules.json';
import { legRole } from './helpers/crouch-mirror';

it('keeps accelerated light, middle and high kick preparation within its increased angular-speed budget',()=>{
 for(const stance of ['standing','crouching','airborne'])for(const name of ['lk','rlk','mk','lmk','hk','rhk']) {
  const id=`${stance}_${name}`,end=animations[id].keyframes.find(key=>key.pose.endsWith('_anticipate'))!.frame;
  expect(end).toBeGreaterThanOrEqual(14);
  for(let time=0;time<end;time+=.25) {
   const a=sampleAngles(id,time),b=sampleAngles(id,time+.25);
   // Compare the leg that holds each squat role (right crouching kicks swap
   // the identical-looking legs invisibly right after their first key).
   for(const joint of ['leftKnee','leftFoot','rightKnee','rightFoot']) {
    const delta=Math.abs(((b.angles[legRole(id,time+.25,joint)]-a.angles[legRole(id,time,joint)]+540)%360)-180);
    expect(delta/.25,`${id}/${joint}`).toBeLessThanOrEqual(name==='hk'||name==='rhk'?20:16);
   }
  }
 }
});
it.each([1,-1])('advances grounded kicks smoothly, freezes in hitstop and replays identically (%s)',facing=>{
 for(const button of ['LK','MK','HK','RLK','LMK','RHK'] as const) {
  const game=createGame(),a=game.fighters[0];a.x=480*256;game.fighters[1].x=a.x+facing*250*256;
  const start=a.x,replay=createReplay(game);let previous=a.x;
  for(let frame=0;frame<80;frame++) {
   const inputs:[ReturnType<typeof neutralInput>,ReturnType<typeof neutralInput>]=[{...neutralInput(),buttons:frame===0?buttonBit(button):0},neutralInput()];
   replay.frames.push({inputs,events:[]});step(game,inputs);
   expect((a.x-previous)*facing).toBeGreaterThanOrEqual(0);expect(Math.abs(a.x-previous)).toBeLessThan(3*256);previous=a.x;
  }
  const expected=button==='MK'||button==='LMK'?0:18*256;
  expect(Math.abs(a.x-start)).toBe(expected);expect(playReplay(parseReplay(replay))).toEqual(game);
 }
 const game=createGame(),a=game.fighters[0];a.state='Attack';a.moveId='standing_rlk';a.moveFrame=5;game.hitstop=3;
 const x=a.x;for(let i=0;i<3;i++)step(game);expect(a.x).toBe(x);
});
it.each([1,-1])('keeps the advancing fighter inside the arena and on their side of the opponent (%s)',facing=>{
 const game=createGame(),a=game.fighters[0],b=game.fighters[1];
 b.x=facing===1?rules.stageWidth-24*256:24*256;a.x=b.x-facing*48*256;
 for(let frame=0;frame<80;frame++) {
  step(game,[{...neutralInput(),buttons:frame===0?buttonBit('MK'):0},neutralInput()]);
  expect((b.x-a.x)*facing).toBeGreaterThan(0);
  for(const f of [a,b]){const box=pushbox(f);expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(rules.stageWidth);}
 }
});
it.each([
 ['Walk',3],['WalkBackward',-2],['CrouchWalk',1],
] as const)('%s plants one foot against world movement while the other lifts', (id,speed)=>{
 const period=animations[id].durationFrames-1;
 for(const [joint,from,to] of [['leftFoot',1,period/2-1],['rightFoot',period/2+1,period-1]] as const) {
  const first=samplePose(id,from)[joint];
  for(let t=from;t<to;t+=.25) {
   const pose=samplePose(id,t);
   expect(pose[joint][0]*FIGURE_SCALE+t*speed).toBeCloseTo(first[0]*FIGURE_SCALE+from*speed,1);
   expect(pose[joint][1]).toBeCloseTo(0,1);
  }
 }
 expect(samplePose(id,period/4).rightFoot[1]).toBeLessThan(-3);
 expect(samplePose(id,period*3/4).leftFoot[1]).toBeLessThan(-3);
 const f=createGame().fighters[0];f.state=id.startsWith('Crouch')?'CrouchWalk':'Walk';f.vx=speed*256;
 expect(animationId(f)).toBe(id);
});

it.each(['left', 'right'] as const)('extends the %s trailing leg before lifting it into the next forward step', side=>{
 const period=animations.Walk.durationFrames-1;
 const offset=side==='left'?0:.5;
 const time=(phase:number)=>((phase-offset+1)%1)*period;
 const foot=`${side}Foot`,knee=`${side}Knee`;
 // The old cycle had already lifted and pulled the foot forward at this point.
 const planted=samplePose('Walk',time(.5))[foot];
 for(let phase=.5;phase<=.60;phase+=.01) {
  const pose=samplePose('Walk',time(phase));
  expect(Math.abs(pose[foot][1])).toBeLessThan(.1);
  expect(pose[foot][0]*FIGURE_SCALE+time(phase)*3).toBeCloseTo(planted[0]*FIGURE_SCALE+time(.5)*3,1);
 }
 const extended=samplePose('Walk',time(.62));
 expect(extended[foot][0]-extended.hip[0]).toBeLessThan(-20);
 expect(sampleAngles('Walk',time(.62)).angles[foot]).toBeLessThan(30);
 expect(samplePose('Walk',time(.8))[foot][1]).toBeLessThan(-7);
 for(let frame=0;frame<period;frame+=.25) {
  const pose=samplePose('Walk',frame);
  expect(Math.hypot(pose[knee][0]-pose.hip[0],pose[knee][1]-pose.hip[1])).toBeCloseTo(25,8);
  expect(Math.hypot(pose[foot][0]-pose[knee][0],pose[foot][1]-pose[knee][1])).toBeCloseTo(25,8);
 }
});
