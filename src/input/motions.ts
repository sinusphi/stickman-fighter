import definitions from '../data/motions.json';
import { buttonBit, type Button, type InputFrame } from './types';

export interface Motion {
  id: string; sequence: number[]; buttons: string[]; maxTotalFrames: number; maxGapFrames: number; buttonWindowFrames: number; priority: number;
  charge?: { directions: number[]; finishDirections: number[]; minFrames: number; releaseWindowFrames: number };
}
export const MOTIONS: Motion[] = definitions;

export function matchesMotion(history: InputFrame[], motion: Motion): boolean {
  const last = history.at(-1);
  if (!last || !motion.buttons.some(b => last.pressed & buttonBit(b as Button))) return false;
  let index = history.length - 1;
  const charge = motion.charge;
  const finish = charge?.finishDirections ?? [motion.sequence.at(-1)!];
  while (index >= 0 && history[index].direction === 5 && last.frame - history[index].frame <= motion.buttonWindowFrames) index--;
  if (index < 0 || !finish.includes(history[index].direction)) return false;
  const finishEnd = history[index].frame;
  while (index > 0 && finish.includes(history[index - 1].direction)) index--;
  const finishStart = history[index].frame;
  if (last.frame - finishStart > motion.buttonWindowFrames) return false;
  index--;
  if (charge) {
    while (index >= 0 && history[index].direction === 5) index--;
    if (index < 0 || finishStart - history[index].frame > charge.releaseWindowFrames) return false;
    const end = history[index].frame;
    while (index >= 0 && charge.directions.includes(history[index].direction)) index--;
    const start = history[index + 1]?.frame ?? end + 1;
    return end - start + 1 >= charge.minFrames;
  }
  let nextStart = finishStart;
  for (let part = motion.sequence.length - 2; part >= 0; part--) {
    while (index >= 0 && history[index].direction === 5) index--;
    if (index < 0 || history[index].direction !== motion.sequence[part]) return false;
    if (nextStart - history[index].frame > motion.maxGapFrames) return false;
    const partEnd = history[index].frame;
    while (index > 0 && history[index - 1].direction === motion.sequence[part]) index--;
    nextStart = history[index].frame;
    if (finishEnd - (part === 0 ? partEnd : nextStart) >= motion.maxTotalFrames) return false;
    index--;
  }
  return true;
}

export function parseMotions(history: InputFrame[], motions: Motion[] = MOTIONS): string[] {
  return motions.filter(motion => matchesMotion(history, motion))
    .sort((a, b) => b.priority - a.priority || (a.id === b.id ? 0 : a.id < b.id ? -1 : 1)).map(motion => motion.id);
}
