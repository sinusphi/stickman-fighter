import type { AnglePose, Animation } from './animation-types';

export const ARM_JOINTS = ['leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftHand', 'rightHand'] as const;
const delta = (a: number, b: number): number => ((b-a)%360+540)%360-180;

/** Monotone cubic tangents: carry motion through intermediate keys, but stop
 * at reversals and holds. Unequal key spacing is measured in animation frames. */
function tangent(before: number, after: number, beforeTime: number, afterTime: number): number {
  if(before*after<=0)return 0;
  const w1=2*afterTime+beforeTime, w2=afterTime+2*beforeTime;
  return (w1+w2)/(w1/before+w2/after);
}

export function interpolateArms(animation: Animation, poses: Record<string, AnglePose>, index: number, t: number, result: AnglePose): void {
  const keys=animation.keyframes, a=keys[index], b=keys[index+1];
  if(!b)return;
  const duration=b.frame-a.frame;
  for(const joint of ARM_JOINTS) {
    const start=poses[a.pose].angles[joint], distance=delta(start,poses[b.pose].angles[joint]);
    const slope=distance/duration;
    const previous=keys[index-1], next=keys[index+2];
    // Endpoints meet a held pose (also the duplicated endpoint in loop clips).
    const incoming=previous?tangent(delta(poses[previous.pose].angles[joint],start)/(a.frame-previous.frame),slope,a.frame-previous.frame,duration):0;
    const outgoing=next?tangent(slope,delta(poses[b.pose].angles[joint],poses[next.pose].angles[joint])/(next.frame-b.frame),duration,next.frame-b.frame):0;
    result.angles[joint]=start+(-2*t*t*t+3*t*t)*distance
      +(t*t*t-2*t*t+t)*duration*incoming+(t*t*t-t*t)*duration*outgoing;
  }
}
