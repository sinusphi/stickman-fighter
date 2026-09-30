/** Offline geometry authoring. Runtime combat reads only baked fixed-point data. */
import rig from './poses.json';
import type { Pose } from '../render/skeleton';
import type { Box } from '../simulation/collision';
export type Capsule = [number,number,number,number,number];
const capsule=(a:number[],b:number[],radius:number):Capsule=>[...a,...b,radius].map(v=>Math.round(v*256)) as Capsule;
export function bodyCapsules(pose:Pose):Capsule[] {
  // Collision radii stay inside the visible filled silhouette (without glow).
  const radius=(joint:string)=>joint==='neck'?4.5:joint==='head'?3.5:joint.endsWith('Knee')?4.25:joint.endsWith('Foot')?3.75:3.4;
  return [capsule(pose.head,pose.head,12),...rig.skeleton.bones.map(b=>capsule(pose[b.parent],pose[b.joint],radius(b.joint)))];
}
export function strikeCapsule(pose:Pose,joint:string):Capsule {
  const from=pose[joint.replace('Foot','Knee').replace('Hand','Elbow')],to=pose[joint];
  return capsule(from,to,joint.endsWith('Hand')?3.8:4);
}
/** Knee strike: distal half of the thigh up to the kneecap. The radius keeps
 * the same margin over the drawn thigh tip as the foot capsule over the shin. */
export function kneeCapsule(pose:Pose,side:'left'|'right'):Capsule {
  const hip=pose.hip,knee=pose[side+'Knee'];
  return capsule([(hip[0]+knee[0])/2,(hip[1]+knee[1])/2],knee,4.5);
}
export function capsuleBoxes([ax,ay,bx,by,r]:Capsule):Box[] {
  const count=Math.max(1,Math.ceil(Math.hypot(bx-ax,by-ay)/(4*256)));
  return Array.from({length:count},(_,i)=>{
    const x1=ax+(bx-ax)*i/count,y1=ay+(by-ay)*i/count,x2=ax+(bx-ax)*(i+1)/count,y2=ay+(by-ay)*(i+1)/count;
    const x=Math.floor(Math.min(x1,x2)-r),y=Math.floor(Math.min(y1,y2)-r);
    return {x,y,width:Math.ceil(Math.max(x1,x2)+r)-x,height:Math.ceil(Math.max(y1,y2)+r)-y};
  });
}
