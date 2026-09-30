import data from '../data/contact-geometry.json';
import {FIGURE_SCALE} from '../data/figure-scale';
import type {Fighter} from './types';
import type {Capsule} from '../data/contact-shapes';
interface Geometry {loop:boolean;frames:{body:Capsule[];strikes:Record<string,Capsule>}[]}
const geometry=data as unknown as Record<string,Geometry>;
export function usesPoseContact(id:string):boolean {
 return /^(standing|crouching|airborne)_(hp|mk|lmk|hk|rhk)$/.test(id) || ['spin_mk','spin_hk','tornado_mk','forward_spin_hk','tornado_spin_combo'].includes(id);
}
function frameFor(f:Fighter,hitLevel?:string) {
 const id=f.state==='Attack'&&f.moveId?f.moveId:f.state==='Walk'&&f.vx*f.facing<0?'WalkBackward':
  f.state==='Hitstun'&&f.hitReaction==='middlePunch'?'HitMiddlePunch':f.state==='Hitstun'&&hitLevel?`Hit${hitLevel}`:f.state==='Blockstun'&&f.crouching?'CrouchBlock':f.state;
 const clip=geometry[id]??geometry.Idle,time=f.state==='Attack'?f.moveFrame:f.stateFrame;
 return clip.frames[clip.loop?time%clip.frames.length:Math.min(time,clip.frames.length-1)];
}
function world(c:Capsule,f:Fighter):Capsule {
 const facing=f.state==='Attack'?f.attackFacing:f.facing;
 return [f.x+facing*Math.round(c[0]*FIGURE_SCALE),f.y+Math.round(c[1]*FIGURE_SCALE),f.x+facing*Math.round(c[2]*FIGURE_SCALE),f.y+Math.round(c[3]*FIGURE_SCALE),Math.round(c[4]*FIGURE_SCALE)];
}
function pointDistanceSquared(x:number,y:number,c:Capsule):number {
 const dx=c[2]-c[0],dy=c[3]-c[1],length=dx*dx+dy*dy;
 const t=length?Math.max(0,Math.min(1,((x-c[0])*dx+(y-c[1])*dy)/length)):0;
 return (x-c[0]-t*dx)**2+(y-c[1]-t*dy)**2;
}
export function capsulesOverlap(a:Capsule,b:Capsule):boolean {
 const cross=(ax:number,ay:number,bx:number,by:number)=>ax*by-ay*bx;
 const dx=a[2]-a[0],dy=a[3]-a[1],ex=b[2]-b[0],ey=b[3]-b[1],den=cross(dx,dy,ex,ey);
 if(den) {
  const t=cross(b[0]-a[0],b[1]-a[1],ex,ey)/den,u=cross(b[0]-a[0],b[1]-a[1],dx,dy)/den;
  if(t>=0&&t<=1&&u>=0&&u<=1)return true;
 }
 return Math.min(pointDistanceSquared(a[0],a[1],b),pointDistanceSquared(a[2],a[3],b),pointDistanceSquared(b[0],b[1],a),pointDistanceSquared(b[2],b[3],a))<=(a[4]+b[4])**2;
}
export function hasPoseContact(attacker:Fighter,defender:Fighter,group:string,hitLevel?:string):boolean {
 const strike=frameFor(attacker).strikes[group];
 return Boolean(strike && frameFor(defender,hitLevel).body.some(body=>capsulesOverlap(world(strike,attacker),world(body,defender))));
}
