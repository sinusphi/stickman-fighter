import { animations, type Pose } from '../../../src/render/skeleton';

/** Right crouching kicks run on the mirrored squat: between the first and the
 * last key the right leg holds the front position and the left leg the rear
 * one. Both squats look identical, so tests compare legs by their role. */
export const mirroredCrouchKick = (id: string): boolean => /^crouching_(rlk|mk|rhk)$/.test(id);
export const swapSide = (joint: string): string =>
  joint.startsWith('left') ? 'right'+joint.slice(4) : joint.startsWith('right') ? 'left'+joint.slice(5) : joint;
export function legsSwappedAt(id: string, time: number): boolean {
  const keys=animations[id].keyframes;
  return mirroredCrouchKick(id) && time>keys[0].frame && time<keys[keys.length-1].frame;
}
/** Leg joint that shows the given authored-crouch role at `time`. */
export const legRole = (id: string, time: number, joint: string): string =>
  legsSwappedAt(id,time) && /Knee|Foot/.test(joint) ? swapSide(joint) : joint;
/** Pose with legs labelled as in the authored crouch (left front, right rear). */
export function byLegRole(id: string, time: number, pose: Pose): Pose {
  return Object.fromEntries(Object.keys(pose).map(joint=>[joint,pose[legRole(id,time,joint)]]));
}
