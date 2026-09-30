import timing from '../fixtures/animation-timing.json';
import { expect, it } from 'vitest';
import data from '../../src/data/poses.json';
import { figureBottom } from '../../src/render/figure-geometry';
import { samplePose } from '../../src/render/canvas';

it.each(['standing_hp','standing_lk','standing_mk'])('%s keeps every segment within 0.5%%', id => {
  const initial=samplePose(id,0);
  for(let time=0;time<(data.animations as Record<string,{durationFrames:number}>)[id].durationFrames;time+=.25) {
    const pose=samplePose(id,time);
    for(const [a,b] of data.skeleton.segments) {
      const length=(p:typeof pose)=>Math.hypot(p[a][0]-p[b][0],p[a][1]-p[b][1]);
      expect(Math.abs(length(pose)/length(initial)-1),`${id} ${a}/${b} at ${time}`).toBeLessThanOrEqual(.005);
    }
  }
});

import { animations, sampleAngles, buildPose, blendAngles, lerpAngle, fighterPose, animationId } from '../../src/render/skeleton';
import { validatePoses, MOVES } from '../../src/data/schema';
import { createGame } from '../../src/simulation/state';
import legacy from '../fixtures/update-01/legacy-poses.json';

it.each(Object.keys(animations))('%s preserves the rig at every quarter-frame, loop and mirror',id=>{
  for(let time=0;time<=animations[id].durationFrames+1;time+=.25) for(const facing of [-1,1]) {
    const pose=samplePose(id,time,facing);
    for(const bone of data.skeleton.bones) {
      const a=pose[bone.parent],b=pose[bone.joint];
      expect(Math.abs(Math.hypot(a[0]-b[0],a[1]-b[1])/bone.length-1)).toBeLessThanOrEqual(.005);
    }
  }
});
it('blends across the angle seam and between all animation endpoints without stretching',()=>{
  expect(lerpAngle(179,-179,.5)).toBe(180);
  expect(lerpAngle(-179,179,.5)).toBe(-180);
  for(const a of Object.keys(animations)) for(const b of Object.keys(animations)) {
    const pose=buildPose(blendAngles(sampleAngles(a,animations[a].durationFrames-1),sampleAngles(b,0),.5));
    for(const bone of data.skeleton.bones) expect(Math.hypot(pose[bone.parent][0]-pose[bone.joint][0],pose[bone.parent][1]-pose[bone.joint][1])).toBeCloseTo(bone.length,10);
  }
});
it('keeps closed loops, active timing, pause, hitstop and reset poses stable',()=>{
  for(const [id,a] of Object.entries(animations)) {
    if(a.loop)expect(samplePose(id,0)).toEqual(samplePose(id,a.durationFrames-1));
    const old=(legacy.animations as Record<string,{durationFrames:number}>)[id];
    if(old && id.includes('_') && !/^(standing|crouching|airborne)_(hp|lmk|mk|hk|rhk)$/.test(id) && id!=='spin_hk') {
      const duration=Math.round(old.durationFrames*1.25)+((timing.preparationExtension as Record<string,number>)[id]??0);
      expect(a.durationFrames).toBe(/^(standing|crouching|airborne)_(lk|rlk|lmk|mk)$/.test(id)?Math.round(Math.round(duration*.8)*.95):/^(standing|crouching|airborne)_hk$/.test(id)?Math.round(duration*.95):duration);
    }
  }
  const game=createGame(),f=game.fighters[0],old=structuredClone(f);
  f.state='Attack';f.moveId='standing_hp';f.moveFrame=9;
  expect(fighterPose(f,old,.2,true)).toEqual(fighterPose(f,old,.9,true));
  expect(fighterPose(f,f,0,false)).toEqual(samplePose('standing_hp',9));
  f.state='Blockstun';f.crouching=true;
  expect(animationId(f)).toBe('CrouchBlock');
  expect(fighterPose(f,old,.5,true)).toEqual(samplePose('CrouchBlock',f.stateFrame));
});
it('rejects malformed rigs and poses',()=>{
  for(const mutate of [
    (d:typeof data)=>{d.skeleton.bones[0].length=0;},
    (d:typeof data)=>{d.skeleton.bones[0].parent='missing';},
    (d:typeof data)=>{d.poses.guard.angles.neck=NaN;},
    (d:typeof data)=>{d.animations.Idle.keyframes[0].easing='invalid';},
    (d:typeof data)=>{d.animations.crouching_rlk.trail!.joint='head';},
  ]) { const copy=structuredClone(data);mutate(copy);expect(()=>validatePoses(copy)).toThrow(); }
});
it('retains the original reported stretching as a historical fixture',()=>{
  const poses=legacy.poses as Record<string,Record<string,number[]>>;
  for(const [id,a,b] of [['standing_hp','leftElbow','leftHand'],['standing_lk','hip','leftKnee'],['standing_mk','hip','rightKnee']]) {
    const length=(p:Record<string,number[]>)=>Math.hypot(p[a][0]-p[b][0],p[a][1]-p[b][1]);
    expect(Math.abs(length(poses[id])/length(poses.guard)-1)).toBeGreaterThan(.005);
  }
});

it('rests the knocked-down rig on the floor after landing without scaling it',()=>{
  const f=createGame().fighters[0];f.state='Knockdown';f.y=0;
  const p=fighterPose(f,f,1,true);
  expect(figureBottom(p)).toBeCloseTo(0,10);
});

it.each([['standing_hp','leftHand'],['standing_lk','leftFoot'],['standing_mk','rightFoot']])('%s places its striking endpoint inside its unchanged active box', (id,joint)=>{
  const move=MOVES[id],point=samplePose(id,move.startup)[joint];
  expect(move.frames[move.startup].hitboxes.some(b=>point[0]>=b.x/256 && point[0]<=(b.x+b.width)/256 && point[1]>=b.y/256 && point[1]<=(b.y+b.height)/256)).toBe(true);
});
