import type { Pose } from './skeleton';
import type { SegmentDepths } from './animation-types';

/** Shared X reflection. Turning also reverses depth via facingDepth below;
 * anatomical joint names remain unchanged. */
function facingMatrix(facing:number): [number,number,number,number,number,number] {
  return [facing,0,0,1,0,0];
}
export function facePoint(point:readonly number[], facing:number): number[] {
  const matrix=facingMatrix(facing);
  // Diagonal reflection also preserves the sign of zero in numerical poses.
  return [matrix[0]*point[0],matrix[3]*point[1]];
}
export function facePose(pose:Pose, facing:number): Pose {
  return Object.fromEntries(Object.entries(pose).map(([joint,point])=>[joint,facePoint(point,facing)]));
}
export function applyFacing(ctx:CanvasRenderingContext2D, facing:number): void {
  ctx.transform(...facingMatrix(facing));
}

/** Authored depths describe the right-side, left-facing back view. A turn to
 * face right exposes the chest: reverse occlusion, not anatomical limb names. */
export function facingDepth(depth:number, facing:number, segment:string, depths:Readonly<SegmentDepths>): number {
  // Head-on-neck layering is structural, not a left/right limb relationship.
  if(segment==='neck'||segment==='head'||segment==='headCircle')return depth;
  if(facing===-1)return depth;
  // Move an arm across the torso as one layer group. Preserve its authored
  // internal offsets so a folded forearm stays in front of its upper arm.
  if(/^(left|right)(Shoulder|Elbow|Hand)$/.test(segment)) {
    const shoulder=segment.startsWith('left')?'leftShoulder':'rightShoulder';
    return depth-2*depths[shoulder];
  }
  return -depth;
}
