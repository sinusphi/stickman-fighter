import data from '../data/poses.json';
import { figureBottom } from './figure-geometry';
import { facePose } from './facing';
import type { Fighter } from '../simulation/types';
import type { HitLevel } from '../data/schema';
import type { AnglePose, Animation, Rotation, Trail } from './animation-types';
import { interpolateArms } from './arm-interpolation';
export type { AnglePose, Animation, Rotation } from './animation-types';

export type Pose = Record<string, number[]>;
export type Easing = 'linear' | 'easeInQuad' | 'easeOutCubic' | 'smoothstep';
const poses: Record<string, AnglePose> = data.poses;
export const animations: Record<string, Animation> = data.animations;
export const ease = (t: number, name: string): number => name==='easeInQuad'?t*t:name==='easeOutCubic'?1-(1-t)**3:name==='smoothstep'?t*t*(3-2*t):t;
export const lerpAngle = (a: number, b: number, t: number): number => a+(((b-a)%360+540)%360-180)*t;
export function blendAngles(a: AnglePose, b: AnglePose, t: number): AnglePose {
  const rotations=blendRotations(a.rotations??[],b.rotations??[],t);
  return {...(rotations.length?{rotations}:{}),root:a.root.map((n,i)=>n+(b.root[i]-n)*t),angles:Object.fromEntries(Object.keys(a.angles).map(j=>[j,lerpAngle(a.angles[j],b.angles[j],t)]))};
}
export function sampleAngles(id: string, time: number): AnglePose {
  const animation=animations[id]??animations.Idle;
  const frame=animation.loop?((time%animation.durationFrames)+animation.durationFrames)%animation.durationFrames:Math.max(0,Math.min(time,animation.durationFrames-1));
  const keys=animation.keyframes;
  const end=keys.findIndex(key=>key.frame>frame);
  const a=keys[end<0?keys.length-1:Math.max(0,end-1)], b=keys[end<0?keys.length-1:end];
  const t=a.frame===b.frame?0:(frame-a.frame)/(b.frame-a.frame);
  const result=blendAngles({...poses[a.pose],rotations:a.rotations},{...poses[b.pose],rotations:b.rotations},ease(t,a.easing));
  if(a!==b)interpolateArms(animation,poses,Math.max(0,end-1),t,result);
  if(animation.legInterpolation==='footIK')interpolateCrouchingLegs(animation,a.pose,b.pose,t,result,end<0||frame<=keys[0].frame);
  return result;
}

const crouchPreparationProgress = new WeakMap<Animation, number[]>();
/** Foot-space interpolation avoids shortest-angle wrapping through an inverted
 * squat. The kicking leg bends like a real knee, the planted support keeps the
 * splayed rear-leg branch of the crouch.
 *
 * A right (rear-leg) kick uses the mirrored crouch: the right leg takes the
 * front position and the left leg the rear one. Both legs look identical in the
 * squat, so the swap is invisible, while a physical swap would have to fold the
 * rear knee backwards through the low hip. The first and the final key show the
 * authored crouch (`settled`), where the mirrored and authored squat coincide. */
function interpolateCrouchingLegs(animation: Animation, from: string, to: string, t: number, result: AnglePose, settled = false): void {
  const stance=buildPose(poses[animation.keyframes[0].pose],true);
  const a=buildPose(poses[from],true), b=buildPose(poses[to],true);
  const kick=animation.trail!.joint, support=kick==='leftFoot'?'rightFoot':'leftFoot';
  const idle=animation.keyframes[0].pose;
  const mirrored=!settled && stance[kick][0]<stance[support][0];
  // Feet of the squat the kick starts from and returns to. The front knee
  // bends forward, the rear leg keeps the splayed branch of the crouch.
  const home: Pose=mirrored?{...stance,[kick]:stance[support],[support]:stance[kick]}:stance;
  const front=home.leftFoot[0]>home.rightFoot[0]?'leftFoot':'rightFoot';
  const inSquat=(p: Pose)=>Math.hypot(p[kick][0]-stance[kick][0],p[kick][1]-stance[kick][1])<.5;
  const kickFoot=(p: Pose)=>mirrored&&inSquat(p)?home[kick]:p[kick];
  const solve=(u: number): AnglePose=>{
    const root=[a.hip[0]+(b.hip[0]-a.hip[0])*u,stance.hip[1]];
    const angles:Record<string,number>={};
    const from0=kickFoot(a),to0=kickFoot(b);
    for(const joint of [kick,support]) {
      const foot=joint===support?[home[joint][0],
        (from===idle?home[joint][1]:0)*(1-u)+(to===idle?home[joint][1]:0)*u]
        :from0.map((v,i)=>v+(to0[i]-v)*u);
      const dx=foot[0]-root[0],dy=foot[1]-root[1];
      const bend=Math.acos(Math.min(1,Math.hypot(dx,dy)/50))*(joint===front?1:-1);
      angles[joint.replace('Foot','Knee')]=(Math.atan2(dy,dx)-bend)*180/Math.PI;
      angles[joint]=2*bend*180/Math.PI;
    }
    return {root,angles};
  };
  let u=t<.25?8/3*t*t:t>.75?1-8/3*(1-t)**2:4/3*t-1/6;
  if(from===idle && to!==idle) {
    // Equal time per degree keeps the preparation smooth even near full leg
    // extension, where a small foot displacement can turn the knee rapidly.
    let distances=crouchPreparationProgress.get(animation);
    if(!distances) {
      distances=[0];let previous=solve(0);
      for(let i=1;i<=128;i++) {
        const current=solve(i/128);
        const delta=Math.max(...['leftKnee','leftFoot','rightKnee','rightFoot'].map(j=>Math.abs(current.angles[j]-previous.angles[j])));
        distances.push(distances[i-1]+delta);previous=current;
      }
      crouchPreparationProgress.set(animation,distances);
    }
    const target=t*distances[128];
    let index=1;while(index<128 && distances[index]<target)index++;
    u=(index-1+(target-distances[index-1])/(distances[index]-distances[index-1]||1))/128;
  }
  const leg=solve(u);
  result.root=leg.root;
  Object.assign(result.angles,leg.angles);
}
/** Authored yaw: 0 = guard view, 1 = turned through the strike. */
export function sampleTurn(id: string, time: number): number {
  return sampleViewTrack(id,time,'turn')??0;
}
/** Unwrapped yaw in degrees: 0 profile, 90 back, 180 opposite profile,
 * 270 front, 360 profile again. Keep complete revolutions when interpolating. */
export function sampleYaw(id: string, time: number): number | undefined {
  return sampleViewTrack(id,time,'yaw');
}
function sampleViewTrack(id: string, time: number, track: 'turn'|'yaw'): number | undefined {
  const animation=animations[id]??animations.Idle;
  const frame=animation.loop?((time%animation.durationFrames)+animation.durationFrames)%animation.durationFrames:Math.max(0,Math.min(time,animation.durationFrames-1));
  const keys=animation.keyframes, end=keys.findIndex(key=>key.frame>frame);
  const a=keys[end<0?keys.length-1:Math.max(0,end-1)],b=keys[end<0?keys.length-1:end];
  const t=ease(a.frame===b.frame?0:(frame-a.frame)/(b.frame-a.frame),a.easing);
  if(a[track]===undefined && b[track]===undefined)return undefined;
  return (a[track]??0)+((b[track]??0)-(a[track]??0))*t;
}
export function buildPose(pose: AnglePose, grounded = false, facing = 1, lying = false, clampFloor = false): Pose {
  const points:Pose={[data.skeleton.rootJoint]:[...pose.root]}, angles:Record<string,number>={[data.skeleton.rootJoint]:0};
  for(const bone of data.skeleton.bones) {
    const angle=angles[bone.parent]+pose.angles[bone.joint]; angles[bone.joint]=angle;
    const radians=angle*Math.PI/180, parent=points[bone.parent];
    points[bone.joint]=[parent[0]+Math.cos(radians)*bone.length,parent[1]+Math.sin(radians)*bone.length];
  }
  const rotated=rotatePose(points,pose.rotations??[]);
  Object.assign(points,rotated);
  // Translate the entire rig; never project individual feet or scale limbs.
  const floor=grounded?(lying?figureBottom(points):Math.max(points.leftFoot[1],points.rightFoot[1])):clampFloor?Math.max(0,points.leftFoot[1],points.rightFoot[1]):0;
  return facePose(Object.fromEntries(Object.entries(points).map(([joint,p])=>[joint,[p[0],p[1]-floor]])),facing);
}
export function samplePose(id: string, time: number, facing = 1): Pose {
  return buildPose(sampleAngles(id,time),(animations[id]??animations.Idle).grounded,facing,id==='KO',animations[id]?.clampFloor);
}
export function animationId(f: Fighter, hitLevel?: HitLevel): string {
  if(f.state==='Walk' && f.vx*f.facing<0)return 'WalkBackward';
  if(f.state==='Hitstun' && f.hitReaction==='middlePunch')return 'HitMiddlePunch';
  if(f.state==='Hitstun' && hitLevel)return `Hit${hitLevel}`;
  return f.state==='Attack'&&f.moveId?f.moveId:f.state==='Blockstun'&&f.crouching?'CrouchBlock':f.state;
}
// A one-simulation-frame blend requires no mutable rendering history. Reset and
// replay already replace `previous`; pause/hitstop can sample the exact pose.
export function fighterPose(f: Fighter, previous: Fighter, alpha: number, frozen: boolean, hitLevel?: HitLevel, koTime?: number): Pose {
  const id=animationId(f,hitLevel), oldId=animationId(previous,hitLevel);
  if(id==='KO')return buildPose(sampleAngles(id,koTime??f.stateFrame+(frozen?0:alpha)),true,1,true);
  const time=f.state==='Attack'?f.moveFrame:f.stateFrame;
  const lying=id==='KO'||(id==='Knockdown'&&f.y===0);
  const grounded=animations[id].grounded||lying;
  if(frozen || id===oldId || f.state==='Attack' || f.state==='Blockstun' || f.state==='Hitstun' || f.state==='Landing')return buildPose(sampleAngles(id,time+(frozen?0:alpha)),grounded,1,lying,animations[id].clampFloor);
  const oldTime=previous.state==='Attack'?previous.moveFrame:previous.stateFrame;
  return buildPose(blendAngles(sampleAngles(oldId,oldTime),sampleAngles(id,time),ease(alpha,'smoothstep')),grounded,1,lying,animations[id].clampFloor);
}

function sameTrack(a: Rotation, b: Rotation): boolean {
  return JSON.stringify(a.branches)===JSON.stringify(b.branches) &&
    (typeof a.pivot==='string'?a.pivot===b.pivot:Array.isArray(b.pivot));
}
function blendRotations(a: Rotation[], b: Rotation[], t: number): Rotation[] {
  if(a.length===b.length && a.every((r,i)=>sameTrack(r,b[i])))return a.map((r,i)=>({
    ...r, angle:r.angle+(b[i].angle-r.angle)*t,
    pivot:typeof r.pivot==='string'?r.pivot:r.pivot.map((v,j)=>v+((b[i].pivot as number[])[j]-v)*t),
  }));
  // State transitions fade independent rigid transforms, never joint positions.
  return [...a.map(r=>({...r,angle:r.angle*(1-t)})),...b.map(r=>({...r,angle:r.angle*t}))];
}
export function rotationJoints(rotation: Rotation): Set<string> {
  if(!rotation.branches)return new Set([data.skeleton.rootJoint,...data.skeleton.bones.map(b=>b.joint)]);
  const selected=new Set(rotation.branches);
  for(const bone of data.skeleton.bones)if(selected.has(bone.parent))selected.add(bone.joint);
  return selected;
}
export function rotatePose(pose: Pose, rotations: Rotation[]): Pose {
  const points=Object.fromEntries(Object.entries(pose).map(([j,p])=>[j,[...p]]));
  for(const rotation of rotations) {
    const pivot=typeof rotation.pivot==='string'?points[rotation.pivot]:rotation.pivot;
    const radians=rotation.angle*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
    // Snapshot pivot before changing a joint that might itself be the pivot.
    const [px,py]=pivot;
    for(const joint of rotationJoints(rotation)) {
      const [x,y]=points[joint],dx=x-px,dy=y-py;
      points[joint]=[px+dx*c-dy*s,py+dx*s+dy*c];
    }
  }
  return points;
}
export function animationTrails(id: string): Trail[] {
  const animation=animations[id];
  return animation?[...(animation.trail?[animation.trail]:[]),...(animation.trails??[])]:[];
}
/** Historical samples give a real curved path and freeze without a render cache. */
function sampleTrailTrack(id: string, time: number, trail: Trail, facing = 1): number[][] {
  if(!trail || time<trail.fromFrame || time>trail.toFrame+trail.historyFrames)return [];
  const start=Math.max(trail.fromFrame,time-trail.historyFrames),end=Math.min(time,trail.toFrame);
  if(end<=start)return [];
  const count=Math.max(2,Math.ceil((end-start)*4));
  return Array.from({length:count+1},(_,i)=>samplePose(id,start+(end-start)*i/count,facing)[trail.joint]);
}
export function sampleTrails(id: string, time: number, facing = 1): number[][][] {
  return animationTrails(id).map(trail=>sampleTrailTrack(id,time,trail,facing));
}
export function sampleTrail(id: string, time: number, facing = 1): number[][] {
  return sampleTrails(id,time,facing)[0]??[];
}
/** A short elliptical waist arc makes authored yaw readable even while the
 * striking foot is held at contact. It is derived entirely from pose data. */
export function sampleRotationTrail(id: string, time: number, facing = 1): number[][] {
  const yaw=sampleYaw(id,time);
  if(yaw===undefined)return [];
  const history=5,start=Math.max(0,time-history),first=sampleYaw(id,start);
  if(first===undefined || Math.abs(yaw-first)<8)return [];
  const count=Math.max(4,Math.ceil((time-start)*3));
  return Array.from({length:count+1},(_,i)=>{
    const at=start+(time-start)*i/count,pose=samplePose(id,at,facing),angle=(sampleYaw(id,at)??yaw)*Math.PI/180;
    return [pose.hip[0]+Math.cos(angle)*25*facing,pose.hip[1]-5+Math.sin(angle)*7];
  });
}
