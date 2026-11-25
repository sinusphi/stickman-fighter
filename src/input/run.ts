import type { InputFrame } from './types';

/**
 * Maximum frames between releasing the first forward tap and pressing forward
 * again. The second press must then be held to keep running.
 */
export const RUN_TAP_FRAMES = 12;

/**
 * True on the frame forward (6) is pressed again after a short forward tap.
 * Works on the cleaned, facing-relative directions, so keyboard, D-pad and
 * stick behave the same and SOCD is already resolved. Only neutral (5) may lie
 * between the two taps; any other direction cancels the double tap.
 */
export function detectRunTap(history: readonly InputFrame[], window = RUN_TAP_FRAMES): boolean {
  const current = history.at(-1);
  if (current?.direction !== 6) return false;
  let index = history.length - 2;
  if (index < 0 || history[index].direction === 6) return false;
  while (index >= 0 && history[index].direction === 5) index--;
  return index >= 0 && history[index].direction === 6 && current.frame - history[index].frame <= window;
}
