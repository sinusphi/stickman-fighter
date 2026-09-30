import data from '../data/poses.json';
import { figureBottom } from './figure-geometry';
import { facePose } from './facing';
import type { Fighter } from '../simulation/types';
import type { HitLevel } from '../data/schema';
import type { AnglePose, Animation, Rotation, Trail } from './animation-types';
import { interpolateArms } from './arm-interpolation';
import moveData from '../data/moves.json';
import { FIGURE_SCALE } from '../data/figure-scale';
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
  if((animation.legInterpolation==='plantedSupport'||animation.legInterpolation==='plantedStraight') && end>0 && frame>keys[0].frame)plantSupportLeg(animation,result,animation.legInterpolation==='plantedStraight'?straightness(animation,frame):0);
  if(animation.legInterpolation==='plantedPivot' && end>0 && frame>keys[0].frame)pivotOverSupportLeg(animation,result,pivotWeight(animation,frame));
  return result;
}

/** Rear-leg kicks from the guard: the front (support) foot stays where it
 * stands while the rear leg swings through. Only the support leg is solved; the
 * kicking leg, hip and therefore every strike position remain as authored.
 * Mirroring the left kick instead would slide the front foot into the rear
 * place, so the finished kick would read as a front-leg kick. */
/** 0 in the guard, 1 from the knee chamber through the rechamber. */
function straightness(animation: Animation, frame: number): number {
  const keys=animation.keyframes,last=keys[keys.length-1].frame;
  const chamber=keys.find(key=>key.pose.endsWith('_anticipate'))!.frame,back=keys.find(key=>key.pose.endsWith('_return'))!.frame;
  const t=frame<chamber?frame/chamber:frame<=back?1:(last-frame)/(last-back);
  return ease(Math.max(0,Math.min(1,t)),'smoothstep');
}
/** `plantedStraight`: rear-leg middle/high kicks stand on a (nearly) straight
 * front leg like their left counterparts; the hip rises by the difference. */
function plantSupportLeg(animation: Animation, result: AnglePose, straight = 0): void {
  const support=animation.trail!.joint==='rightFoot'?'leftFoot':'rightFoot', knee=support.replace('Foot','Knee');
  const guard=buildPose(poses[animation.keyframes[0].pose]), authored=buildPose(result);
  const length=data.skeleton.bones.find(bone=>bone.joint===support)!.length+data.skeleton.bones.find(bone=>bone.joint===knee)!.length;
  const hip=authored.hip, dx=guard[support][0]-hip[0];
  // Keep the authored hip height; only a nearly straight leg lowers the reach.
  // The support never floats above a landing kick foot.
  const reach=Math.sqrt(Math.max(0,(length*.998)**2-dx*dx));
  const landing=Math.max(authored[support][1],authored[animation.trail!.joint][1])-hip[1];
  // Straight variant: blend the guard's front-leg height into a nearly
  // straight leg, independent of the mirrored (rear) support of the left kick.
  const guardHeight=guard[support][1]-guard.hip[1],extended=Math.sqrt(Math.max(0,(length*.98)**2-dx*dx));
  const dy=Math.min(straight>0||animation.legInterpolation==='plantedStraight'?guardHeight+(extended-guardHeight)*straight:landing,reach);
  const bend=Math.acos(Math.min(1,Math.hypot(dx,dy)/length));
  // Support knee bends forward, the same branch as in the guard.
  result.angles[knee]=(Math.atan2(dy,dx)-bend)*180/Math.PI;
  result.angles[support]=2*bend*180/Math.PI;
}

/** Pivot weight: in through the knee chamber, held through the strike and
 * eased back from the follow-through until the repass. */
function pivotWeight(animation: Animation, frame: number): number {
  const keys=animation.keyframes,last=keys[keys.length-1].frame;
  const chamber=keys.find(key=>key.pose.endsWith('_anticipate'))!.frame,back=keys.find(key=>key.pose.endsWith('_follow'))!.frame;
  const home=keys.find(key=>key.pose.endsWith('_repass'))?.frame??last;
  if(frame>back)return 1-ease(Math.max(0,Math.min(1,(frame-back)/(home-back))),'smoothstep');
  return ease(Math.max(0,Math.min(1,frame/chamber)),'smoothstep');
}
/** `plantedPivot`: the rear-leg middle and high kicks pivot on the front foot,
 * which turns in under the body and ends behind the hip, as in fighting-game
 * sprites. The hip stays where it is, so from the chamber through the
 * follow-through the support leg stands angled back exactly like the rear
 * support of the matching left kick (authored angles) and reach and contacts
 * equal the left kick. The knee
 * keeps the forward (flexed) branch of the guard and never hyperextends. */
function pivotOverSupportLeg(animation: Animation, result: AnglePose, weight: number): void {
  const support=animation.trail!.joint==='rightFoot'?'leftFoot':'rightFoot', knee=support.replace('Foot','Knee');
  const guard=buildPose(poses[animation.keyframes[0].pose]), authored=buildPose(result);
  const length=data.skeleton.bones.find(bone=>bone.joint===support)!.length+data.skeleton.bones.find(bone=>bone.joint===knee)!.length;
  const from=[guard[support][0]-authored.hip[0],guard[support][1]-guard.hip[1]];
  const to=[authored[support][0]-authored.hip[0],authored[support][1]-authored.hip[1]];
  const dx=from[0]+(to[0]-from[0])*weight;
  const dy=Math.min(from[1]+(to[1]-from[1])*weight,Math.sqrt(Math.max(0,(length*.998)**2-dx*dx)));
  const bend=Math.acos(Math.min(1,Math.hypot(dx,dy)/length));
  result.angles[knee]=(Math.atan2(dy,dx)-bend)*180/Math.PI;
  result.angles[support]=2*bend*180/Math.PI;
}

/** Step of a grounded move (fighter position, see moveFighter) converted to rig units. */
const advanceByAnimation = new Map((moveData as {animation:string;stance:string;advance?:{frames:number;distance:number}}[])
  .filter(move=>move.advance && move.stance!=='airborne').map(move=>[move.animation,move.advance!]));
export function advanceOffset(id: string, frame: number): number {
  const advance=advanceByAnimation.get(id);
  if(!advance)return 0;
  const t=Math.max(0,Math.min(1,frame/advance.frames));
  return advance.distance/256/FIGURE_SCALE*t*t*(3-2*t);
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
/** Animations whose mirrored yaw turns toward the viewer (front view) instead of away. */
export const MIRROR_YAW_ANIMATIONS: ReadonlySet<string> = new Set(['jumping_uppercut']);
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
/** Arm chains the winner lets sink after a knockout (parent order). */
const RELAX_ARMS=[['leftShoulder','leftElbow','leftHand'],['rightShoulder','rightElbow','rightHand']];
/**
 * Absolute screen angles (90 = straight down) of upper arm, forearm and hand for
 * arms hanging loosely beside the body. Elbows keep a slight bend (~15°) so the
 * arms never look locked straight.
 */
const RELAX_ARM_TARGET: Record<string,[number,number,number]>={leftShoulder:[102,110,42],rightShoulder:[96,102,38]};
/** Upright spine for the winner (-90 = straight up in screen space). */
const RELAX_SPINE=-90;
/** Fraction of the relax phase the right arm waits before following the left (avoids a synchronous drop). */
const RELAX_RIGHT_ARM_DELAY=0.30;
/** Absolute thigh/shin angles for a relaxed, narrower stance (90 = straight down). */
const RELAX_LEGS={leftKnee:80,leftFoot:88,rightKnee:97,rightFoot:94};
/**
 * Presentation only: the winner straightens the back, lowers the guard partway
 * and narrows the stance. Head world angle (and thus gaze) is preserved.
 * `t` runs from 0 (guard) to 1 (relaxed).
 */
export function relaxArms(pose: AnglePose, t: number): AnglePose {
  if(t<=0)return pose;
  const w=Math.min(1,t), a=pose.angles, out={...a};
  const neck=lerpAngle(a.neck,RELAX_SPINE,w);
  out.neck=neck;
  out.head=a.neck+a.head-neck; // keep head orientation in world space
  for(const [s,e,h] of RELAX_ARMS) {
    // The right arm starts slightly later but still arrives by t = 1.
    const armW=s==='rightShoulder'?Math.max(0,(w-RELAX_RIGHT_ARM_DELAY)/(1-RELAX_RIGHT_ARM_DELAY)):w;
    // Blend absolute arm angles so the spine change does not swing the arms.
    const src=[a.neck+a[s]]; src.push(src[0]+a[e]); src.push(src[1]+a[h]);
    const dst=RELAX_ARM_TARGET[s];
    const armE=armW*armW*(3-2*armW); // ease out so the arms settle softly
    const abs=src.map((v,i)=>lerpAngle(v,dst[i],armE));
    out[s]=abs[0]-neck; out[e]=abs[1]-abs[0]; out[h]=abs[2]-abs[1];
  }
  for(const side of ['left','right'] as const) {
    const k=`${side}Knee` as const, f=`${side}Foot` as const;
    const knee=lerpAngle(a[k],RELAX_LEGS[k],w), shin=lerpAngle(a[k]+a[f],RELAX_LEGS[f],w);
    out[k]=knee; out[f]=shin-knee;
  }
  return {...pose,angles:out};
}
export function fighterPose(f: Fighter, previous: Fighter, alpha: number, frozen: boolean, hitLevel?: HitLevel, koTime?: number, relax = 0): Pose {
  const id=animationId(f,hitLevel), oldId=animationId(previous,hitLevel);
  if(id==='KO')return buildPose(sampleAngles(id,koTime??f.stateFrame+(frozen?0:alpha)),true,1,true);
  const time=f.state==='Attack'?f.moveFrame:f.stateFrame;
  const lying=id==='KO'||(id==='Knockdown'&&f.y===0);
  const grounded=animations[id].grounded||lying;
  if(frozen || id===oldId || f.state==='Attack' || f.state==='Blockstun' || f.state==='Hitstun' || f.state==='Landing')return buildPose(relaxArms(sampleAngles(id,time+(frozen?0:alpha)),relax),grounded,1,lying,animations[id].clampFloor);
  const oldTime=previous.state==='Attack'?previous.moveFrame:previous.stateFrame;
  return buildPose(relaxArms(blendAngles(sampleAngles(oldId,oldTime),sampleAngles(id,time),ease(alpha,'smoothstep')),relax),grounded,1,lying,animations[id].clampFloor);
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
/** Knee trails run along the raised shin and would vanish inside the own
 * silhouette. Their path is pushed out along hip→knee to just in front of the
 * kneecap, so the rising knee reads as a swoosh drawn above the figure. */
export const KNEE_SWOOSH_OFFSET = 6;
export function isKneeTrail(trail: Trail): boolean { return trail.joint.endsWith('Knee'); }
export function sampleKneeSwoosh(id: string, time: number, trail: Trail, facing = 1): number[][] {
  if(time<trail.fromFrame || time>trail.toFrame+trail.historyFrames)return [];
  const start=Math.max(trail.fromFrame,time-trail.historyFrames),end=Math.min(time,trail.toFrame);
  if(end<=start)return [];
  const count=Math.max(2,Math.ceil((end-start)*4));
  return Array.from({length:count+1},(_,i)=>{
    const pose=samplePose(id,start+(end-start)*i/count,facing),knee=pose[trail.joint],hip=pose.hip;
    const dx=knee[0]-hip[0],dy=knee[1]-hip[1],length=Math.hypot(dx,dy)||1;
    return [knee[0]+dx/length*KNEE_SWOOSH_OFFSET,knee[1]+dy/length*KNEE_SWOOSH_OFFSET];
  });
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
