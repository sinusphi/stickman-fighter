import type { Direction, InputState, RawInput, SocdConfig, SocdMode } from './types';

function axis(negative: boolean, positive: boolean, last: number, mode: SocdMode): number {
  if (!negative || !positive) return Number(positive) - Number(negative);
  return mode === 'positive' ? 1 : mode === 'lastInputWins' ? last : 0;
}

export function cleanInput(raw: RawInput, state: InputState, config: SocdConfig, facing: number): Direction {
  const old = state.previous;
  const left = raw.left && !old.left, right = raw.right && !old.right;
  const up = raw.up && !old.up, down = raw.down && !old.down;
  if (left || right) state.horizontalLast = left === right ? 0 : right ? 1 : -1;
  if (up || down) state.verticalLast = up === down ? 0 : up ? 1 : -1;
  const x = axis(raw.left, raw.right, state.horizontalLast, config.horizontal) * facing;
  const y = axis(raw.down, raw.up, state.verticalLast, config.vertical);
  return (5 + x + y * 3) as Direction;
}
