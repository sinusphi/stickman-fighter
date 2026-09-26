import data from '../data/poses.json';
import { animations, animationId } from './skeleton';
import type { SegmentDepths } from './animation-types';
import type { Fighter } from '../simulation/types';
import type { HitLevel } from '../data/schema';

export const DEFAULT_DEPTHS: Readonly<SegmentDepths> = data.segmentDepths;
/** Hold authored order until the next key: interpolation would reorder limbs
 * halfway through an arbitrary visible phase. No mutable history is needed. */
export function sampleDepths(id: string, time: number): SegmentDepths {
  const animation=animations[id]??animations.Idle;
  const frame=animation.loop?((time%animation.durationFrames)+animation.durationFrames)%animation.durationFrames:Math.max(0,Math.min(time,animation.durationFrames-1));
  const depths={...DEFAULT_DEPTHS};
  for(const key of animation.keyframes) {
    if(key.frame>frame)break;
    Object.assign(depths,key.depths);
  }
  return depths;
}
export function fighterDepths(f: Fighter, alpha: number, frozen: boolean, hitLevel?: HitLevel): SegmentDepths {
  return sampleDepths(animationId(f,hitLevel),(f.state==='Attack'?f.moveFrame:f.stateFrame)+(frozen?0:alpha));
}
