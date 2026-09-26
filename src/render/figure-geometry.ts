import { FIGURE_STYLE } from '../platform/theme';
import data from '../data/poses.json';
import type { Pose } from './skeleton';

export function segmentWidths(joint: string): readonly [number, number] {
  const widths=FIGURE_STYLE.widths;
  if(joint==='neck')return widths.torso;
  if(joint==='head')return widths.neck;
  if(joint.endsWith('Shoulder'))return widths.shoulder;
  if(joint.endsWith('Elbow'))return widths.upperArm;
  if(joint.endsWith('Hand'))return widths.forearm;
  if(joint.endsWith('Knee'))return widths.thigh;
  return widths.shin;
}

/** Visible floor support, including all capsule radii and the head outline. */
export function figureBottom(pose: Pose): number {
  return Math.max(pose.head[1]+FIGURE_STYLE.headRadius,...data.skeleton.bones.flatMap(bone=>{
    const [base,tip]=segmentWidths(bone.joint);
    return [pose[bone.parent][1]+base/2,pose[bone.joint][1]+tip/2];
  }))+FIGURE_STYLE.outlineWidth;
}
