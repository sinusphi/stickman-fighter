import { expect, it } from 'vitest';
import data from '../../src/data/poses.json';
import { ARM_JOINTS, interpolateArms } from '../../src/render/arm-interpolation';
import { animations, blendAngles, ease, lerpAngle, sampleAngles } from '../../src/render/skeleton';
import type { AnglePose, Animation } from '../../src/render/animation-types';

const poses: Record<string, AnglePose> = data.poses;
const difference=(a: number,b: number)=>lerpAngle(a,b,1)-a;

it.each(Object.keys(animations))('%s preserves keys and bounds every interpolated arm angle',id=>{
  const keys=animations[id].keyframes;
  for(const key of keys)for(const joint of ARM_JOINTS)
    expect(difference(poses[key.pose].angles[joint],sampleAngles(id,key.frame).angles[joint])).toBeCloseTo(0,9);
  for(let i=0;i<keys.length-1;i++) {
    const a=keys[i],b=keys[i+1];
    for(let step=1;step<16;step++) {
      const t=step/16, actual=sampleAngles(id,a.frame+(b.frame-a.frame)*t);
      const original=blendAngles(poses[a.pose],poses[b.pose],ease(t,a.easing));
      for(const joint of ARM_JOINTS) {
        const span=difference(poses[a.pose].angles[joint],poses[b.pose].angles[joint]);
        const offset=difference(poses[a.pose].angles[joint],actual.angles[joint]);
        expect(offset).toBeGreaterThanOrEqual(Math.min(0,span)-1e-9);
        expect(offset).toBeLessThanOrEqual(Math.max(0,span)+1e-9);
      }
      if(!animations[id].legInterpolation)expect(actual.root).toEqual(original.root);
      for(const joint of animations[id].legInterpolation?['neck','head']:['neck','head','leftKnee','rightKnee','leftFoot','rightFoot'])
        expect(actual.angles[joint]).toBeCloseTo(original.angles[joint],10);
    }
  }
});

it.each(Object.keys(animations))('%s has continuous arm velocity through keys and held endpoints',id=>{
  const epsilon=1e-5;
  for(const key of animations[id].keyframes)for(const joint of ARM_JOINTS) {
    const before=sampleAngles(id,key.frame-epsilon).angles[joint];
    const at=sampleAngles(id,key.frame).angles[joint];
    const after=sampleAngles(id,key.frame+epsilon).angles[joint];
    expect(Math.abs(difference(before,at)/epsilon-difference(at,after)/epsilon),`${joint} at ${key.frame}`).toBeLessThan(.03);
  }
});

it('unwraps arm angles across the seam and carries speed through a middle key',()=>{
  const animation: Animation={durationFrames:31,loop:false,grounded:false,keyframes:[
    {frame:0,pose:'a',easing:'linear'},
    {frame:10,pose:'b',easing:'linear'},
    {frame:30,pose:'c',easing:'linear'},
  ]};
  const fixture=Object.fromEntries([['a',170],['b',-170],['c',-130]].map(([id,angle])=>
    [id,{root:[0,0],angles:Object.fromEntries(ARM_JOINTS.map(j=>[j,Number(angle)]))}]));
  const result={root:[0,0],angles:{}} as AnglePose;
  interpolateArms(animation,fixture,0,.5,result);
  expect(result.angles.leftHand).toBeCloseTo(177.5,10);
  interpolateArms(animation,fixture,0,1-1e-5,result);
  expect(difference(result.angles.leftHand,-170)/.0001).toBeCloseTo(2,3);
});
