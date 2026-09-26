import rules from '../data/rules.json';
import { neutralInput, type InputFrame, type InputHistory, type InputState } from './types';

export function createInputState(): InputState {
  return { history: { frames: Array(rules.historySize).fill(null), cursor: 0, length: 0 }, previous: neutralInput(), horizontalLast: 0, verticalLast: 0,
    current: { frame: -1, direction: 5, pressed: 0, held: 0, released: 0 }, pending: null, motions: [], display: [] };
}
export function pushHistory(history: InputHistory, frame: InputFrame): void {
  history.frames[history.cursor] = frame;
  history.cursor = (history.cursor + 1) % history.frames.length;
  history.length = Math.min(history.length + 1, history.frames.length);
}
export function readHistory(history: InputHistory): InputFrame[] {
  return Array.from({ length: history.length }, (_, i) => history.frames[(history.cursor - history.length + i + history.frames.length) % history.frames.length]!);
}
