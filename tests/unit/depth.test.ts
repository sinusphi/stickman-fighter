import { expect, it } from 'vitest';
import data from '../../src/data/poses.json';
import { validatePoses, MOVES } from '../../src/data/schema';
import { animations, samplePose } from '../../src/render/skeleton';
import { sampleDepths, fighterDepths, DEFAULT_DEPTHS } from '../../src/render/depth';
import { createGame } from '../../src/simulation/state';
import type { Animation } from '../../src/render/animation-types';

it('holds sparse keyframe overrides, resets at loop boundaries and leaves defaults and geometry intact',()=>{
  const animation=animations.Idle,original=animation.keyframes;
  const geometry=samplePose('Idle',animation.keyframes[1].frame),defaults={...DEFAULT_DEPTHS};
  try {
    animation.keyframes=structuredClone(original);
    animation.keyframes[0].depths={leftHand:50};
    animation.keyframes[1].depths={rightFoot:15};
    expect(sampleDepths('Idle',animation.keyframes[1].frame-.01).rightFoot).toBe(DEFAULT_DEPTHS.rightFoot);
    expect(sampleDepths('Idle',animation.keyframes[1].frame).rightFoot).toBe(15);
    expect(sampleDepths('Idle',animation.durationFrames-1).leftHand).toBe(50);
    expect(sampleDepths('Idle',animation.durationFrames).rightFoot).toBe(DEFAULT_DEPTHS.rightFoot);
    expect(sampleDepths('Idle',-1).rightFoot).toBe(15);
    expect(samplePose('Idle',animation.keyframes[1].frame)).toEqual(geometry);
    expect(DEFAULT_DEPTHS).toEqual(defaults);
  } finally {animation.keyframes=original;}
});
it.each(['spin_mk','spin_hk'])('%s brings the extended kick forward and holds its order throughout active frames',id=>{
  const move=MOVES[id],animation=animations[id];
  expect(sampleDepths(id,move.startup-.001).rightKnee).toBeLessThan(0);
  const active=sampleDepths(id,move.startup);
  expect(active.rightKnee).toBeGreaterThan(active.leftKnee);
  expect(active.rightFoot).toBeGreaterThan(active.leftFoot);
  for(let frame=move.startup;frame<move.startup+move.active;frame+=.125)expect(sampleDepths(id,frame)).toEqual(active);
  const pose=samplePose(id,move.startup);
  const vectors=[['hip','rightKnee'],['rightKnee','rightFoot']].map(([a,b])=>[pose[b][0]-pose[a][0],pose[b][1]-pose[a][1]]);
  const cosine=(vectors[0][0]*vectors[1][0]+vectors[0][1]*vectors[1][1])/(Math.hypot(...vectors[0])*Math.hypot(...vectors[1]));
  expect(cosine).toBeGreaterThan(.98); // Authored full extension is the safe swap point.
  expect(sampleDepths(id,animation.durationFrames)).toEqual(DEFAULT_DEPTHS);
});
it('freezes depth during pause/hitstop and uses the same time as the visible pose in both facings',()=>{
  const fighter=createGame().fighters[0];fighter.state='Attack';fighter.moveId='spin_mk';fighter.moveFrame=13;
  for(const facing of [-1,1] as const) {
    fighter.facing=fighter.attackFacing=facing;
    expect(fighterDepths(fighter,1,true)).toEqual(sampleDepths('spin_mk',13));
    expect(fighterDepths(fighter,1,false)).toEqual(sampleDepths('spin_mk',14));
  }
});
it('rejects unknown segments, missing defaults and invalid keyframe depths',()=>{
  const missing=structuredClone(data);delete (missing.segmentDepths as Record<string,number>).headCircle;
  expect(()=>validatePoses(missing)).toThrow(/Standardtiefen/);
  for(const depths of [{absent:1},{rightFoot:Infinity},{rightFoot:NaN},{rightFoot:'front'},[],null]) {
    const copy=structuredClone(data);
    (copy.animations.Idle as Animation).keyframes[0].depths=depths as never;
    expect(()=>validatePoses(copy)).toThrow(/Segmenttiefe/);
  }
});
