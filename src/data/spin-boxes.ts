/** Offline authoring helper. The simulation consumes the baked JSON, not this geometry. */
import rig from './poses.json';
import rules from './rules.json';
import bodies from './bodies.json';
import type { Pose } from '../render/skeleton';
import type { FrameBoxes } from './schema';
import type { Box } from '../simulation/collision';

function enclosing(points: number[][], padding: number): Box {
  const left=Math.floor((Math.min(...points.map(p=>p[0]))-padding)*rules.unit);
  const top=Math.floor((Math.min(...points.map(p=>p[1]))-padding)*rules.unit);
  const right=Math.ceil((Math.max(...points.map(p=>p[0]))+padding)*rules.unit);
  const bottom=Math.ceil((Math.max(...points.map(p=>p[1]))+padding)*rules.unit);
  return {x:left,y:top,width:right-left,height:bottom-top};
}
export function spinFrameBoxes(pose: Pose, active: boolean, side: 'left'|'right' = 'right', hitGroup = 'main'): FrameBoxes {
  return {
    hitboxes:active?[{...enclosing([pose[side+'Knee'],pose[side+'Foot']],4),hitGroup}]:[],
    hurtboxes:[enclosing([pose.head],rig.skeleton.headRadius+1),...rig.skeleton.bones.map(bone=>enclosing([pose[bone.parent],pose[bone.joint]],Math.max(bone.width,bone.tipWidth)/2+1))],
    pushbox:{...bodies.standing.pushbox},
  };
}
