import { expect, it } from 'vitest';
import data from '../../src/data/poses.json';
import { validatePoses, MOVES } from '../../src/data/schema';
import { buildPose, sampleAngles, samplePose, rotatePose, sampleTrail, fighterPose, type Rotation, type Pose, type Animation } from '../../src/render/skeleton';
import { createGame, snapshot, step } from '../../src/simulation/state';
import { HitFeedback } from '../../src/render/feedback';
import { neutralInput } from '../../src/input/types';

function lengths(pose: Pose): void {
  for(const bone of data.skeleton.bones)expect(Math.hypot(pose[bone.parent][0]-pose[bone.joint][0],pose[bone.parent][1]-pose[bone.joint][1])).toBeCloseTo(bone.length,10);
}
it('rotates around arbitrary external pivots without moving the pivot or changing distances',()=>{
  const base=buildPose(sampleAngles('Idle',0));
  for(const pivot of [[0,0],[17,-49],[-108.5,62.25]]) for(const angle of [-1080,-360,-185,-90,-.125,0,.125,90,185,360,1080]) {
    const rotated=rotatePose(base,[{pivot,angle}]);lengths(rotated);
    for(const joint of Object.keys(base))expect(Math.hypot(rotated[joint][0]-pivot[0],rotated[joint][1]-pivot[1])).toBeCloseTo(Math.hypot(base[joint][0]-pivot[0],base[joint][1]-pivot[1]),10);
    const restored=rotatePose(rotated,[{pivot,angle:-angle}]);
    for(const joint of Object.keys(base))for(const axis of [0,1])expect(restored[joint][axis]).toBeCloseTo(base[joint][axis],10);
  }
});
it('rotates complete subtrees at any joint while all unselected joints stay exactly fixed',()=>{
  const base=buildPose(sampleAngles('Idle',0));
  for(const bone of data.skeleton.bones) {
    const selected=new Set([bone.joint]);
    for(const b of data.skeleton.bones)if(selected.has(b.parent))selected.add(b.joint);
    for(const angle of [-720,-123.45,70,360,721]) {
      const result=rotatePose(base,[{pivot:bone.parent,branches:[bone.joint],angle}]);lengths(result);
      for(const joint of Object.keys(base))if(!selected.has(joint))expect(result[joint]).toEqual(base[joint]);
    }
  }
});
it('interpolates full revolutions through 180 degrees and preserves the torso in the legs demo',()=>{
  for(const mode of ['Body','Legs'])for(const [direction,sign] of [['CW',1],['CCW',-1]] as const) {
    const id=`Demo${mode}${direction}`;
    expect(sampleAngles(id,42*1.25).rotations![0].angle).toBe(180*sign);
    expect(sampleAngles(id,90).rotations![0].angle).toBe(360*sign);
    expect(sampleAngles(id,132).rotations![0].angle).toBe(450*sign);
    const initial=samplePose(id,15),half=samplePose(id,42*1.25),pivot=initial.hip;
    expect(half.leftFoot[0]-pivot[0]).toBeCloseTo(-(initial.leftFoot[0]-pivot[0]),10);
    expect(half.leftFoot[1]-pivot[1]).toBeCloseTo(-(initial.leftFoot[1]-pivot[1]),10);
    for(let t=0;t<=132;t+=.25) {
      const result=samplePose(id,t);lengths(result);
      if(mode==='Legs')for(const joint of ['hip','neck','head','leftHand','rightHand'])expect(result[joint]).toEqual(initial[joint]);
      const mirrored=samplePose(id,t,-1);
      for(const joint of Object.keys(result)) {expect(mirrored[joint][0]).toBe(-result[joint][0]);expect(mirrored[joint][1]).toBe(result[joint][1]);}
    }
  }
});
it('composes rotations in declared order and interpolates a free pivot per keyframe',()=>{
  const base=sampleAngles('Idle',0),r:Rotation[]=[{pivot:[13,-20],angle:173},{pivot:'hip',branches:['leftKnee','rightKnee'],angle:-410}];
  const combined=rotatePose(buildPose(base),r);lengths(combined);
  expect(combined).toEqual(rotatePose(rotatePose(buildPose(base),[r[0]]),[r[1]]));
  // Full sampled tracks also interpolate independent pivot coordinates.
  const animation=(data.animations as Record<string,Animation>).DemoBodyCW;
  const original=structuredClone(animation.keyframes);
  try {
    animation.keyframes.forEach((key,i)=>key.rotations=[{pivot:[i*10,i*-20],angle:i*720}]);
    validatePoses(data);
    const sample=sampleAngles('DemoBodyCW',animation.keyframes[1].frame/2);
    expect(sample.rotations![0]).toEqual({pivot:[5,-10],angle:360});lengths(buildPose(sample));
  } finally {animation.keyframes=original;}
});
it('draws historical arcs with the actual winding, including mirrored winding and finite end fades',()=>{
  for(const [id,sign] of [['DemoBodyCW',1],['DemoBodyCCW',-1],['DemoLegsCW',1],['DemoLegsCCW',-1]] as const)for(const facing of [-1,1]) {
    const points=sampleTrail(id,42,facing),pivot=samplePose(id,42,facing).hip;
    expect(points.length).toBeGreaterThan(20);
    for(let i=1;i<points.length;i++) {
      const [ax,ay]=[points[i-1][0]-pivot[0],points[i-1][1]-pivot[1]], [bx,by]=[points[i][0]-pivot[0],points[i][1]-pivot[1]];
      expect(Math.sign(ax*by-ay*bx)).toBe(sign*facing);
    }
    expect(points.at(-1)).toEqual(samplePose(id,42,facing).leftFoot);
    expect(sampleTrail(id,0,facing)).toEqual([]);expect(sampleTrail(id,132,facing)).toEqual([]);
  }
});
it('rejects bad pivots, nonfinite angles, detached/incomplete chains and inconsistent rotation tracks',()=>{
  const bad: unknown[]=[{pivot:'absent',angle:30},{pivot:[1,NaN],angle:0},{pivot:[1],angle:0},{pivot:'hip',angle:Infinity},
    {pivot:'hip',angle:90,branches:['leftFoot']},{pivot:[0,0],angle:90,branches:['leftKnee']},
    {pivot:'hip',angle:90,branches:[]},{pivot:'hip',angle:90,branches:['leftKnee','leftKnee']}];
  for(const r of bad) {
    const copy=structuredClone(data);copy.animations.DemoBodyCW.keyframes[0].rotations=[r as typeof copy.animations.DemoBodyCW.keyframes[0]['rotations'][0]];
    expect(()=>validatePoses(copy)).toThrow();
  }
  const copy=structuredClone(data);copy.animations.DemoBodyCW.keyframes[1].rotations=[];
  expect(()=>validatePoses(copy)).toThrow(/Rotationstracks/);
});
it('uses anatomically distinct, constant-length LOW/MID/HIGH reactions immediately, frozen during pause/hitstop',()=>{
  const f=createGame().fighters[0],old=structuredClone(f);f.state='Hitstun';
  const results=[];
  for(const level of ['LOW','MID','HIGH'] as const) {
    const result=fighterPose(f,old,.1,true,level);lengths(result);results.push(result);
    expect(result).toEqual(samplePose(`Hit${level}`,0));
    expect(result).toEqual(fighterPose(f,old,.9,true,level));
  }
  expect(results[0].leftFoot[1]).toBeLessThan(results[1].leftFoot[1]-10);
  expect(results[1].head[0]).toBeGreaterThan(results[2].head[0]+20);
});
it.each(['LOW','MID','HIGH'] as const)('retains %s feedback through attacker recovery and clears it on reset without changing the game',level=>{
  const game=createGame(),feedback=new HitFeedback(),move=MOVES.standing_lp;
  const originalLevel=move.hitLevel;move.hitLevel=level;
  try {
  const before=snapshot(game);before.fighters[0].moveId=move.id;before.fighters[0].state='Attack';
  game.fighters[1].hp-=10;game.fighters[1].state='Hitstun';
  const expected=snapshot(game);feedback.update(game,before);
  expect(feedback.levels[1]).toBe(level);expect(game).toEqual(expected);
  feedback.update(game,snapshot(game));expect(feedback.levels[1]).toBe(level);
  feedback.reset();expect(feedback.levels).toEqual([undefined,undefined]);
  } finally {move.hitLevel=originalLevel;}
});
it('captures both levels on a real trade and repeats the same feedback after replaying inputs',()=>{
  const game=createGame();game.fighters[0].x=400*256;game.fighters[1].x=432*256;
  for(const f of game.fighters){f.state='Attack';f.moveId='standing_lp';f.moveFrame=MOVES.standing_lp.startup-1;f.attackId=1;}
  const initial=snapshot(game),feedback=new HitFeedback();
  step(game,[neutralInput(),neutralInput()]);feedback.update(game,initial);
  expect(game.fighters.every(f=>f.hp<1000)).toBe(true);expect(feedback.levels).toEqual(['MID','MID']);
  const replay=snapshot(initial),other=new HitFeedback();step(replay);other.update(replay,initial);
  expect(replay).toEqual(game);expect(other.levels).toEqual(feedback.levels);
});
it('keeps landing compressed at contact and returns to standing without stretching',()=>{
  const first=samplePose('Landing',0),last=samplePose('Landing',2);
  expect(first.head[1]).toBeGreaterThan(last.head[1]+5);
  for(let t=0;t<=2;t+=.125)lengths(samplePose('Landing',t));
});

it('leaves opposite directions in visibly different final poses after a full turn plus a quarter turn',()=>{
  const cw=samplePose('DemoBodyCW',105),ccw=samplePose('DemoBodyCCW',105);
  expect(Math.hypot(cw.leftFoot[0]-ccw.leftFoot[0],cw.leftFoot[1]-ccw.leftFoot[1])).toBeGreaterThan(90);
});
