import { cleanInput } from './socd';
import { pushHistory, readHistory } from './history';
import { parseMotions } from './motions';
import { buttonBit, type Button, type InputState, type RawInput, type SocdConfig } from './types';
import rules from '../data/rules.json';

const priority = rules.normalPriority as Button[];
export function captureInput(state: InputState, raw: RawInput, facing: number, frame: number, combatFrame: number, config: SocdConfig, bufferFrames: number): void {
  const direction = cleanInput(raw, state, config, facing);
  state.current = { frame, direction, held: raw.buttons, pressed: (raw.buttons & ~state.previous.buttons) | (raw.taps ?? 0), released: (state.previous.buttons | (raw.taps ?? 0)) & ~raw.buttons };
  state.previous = { ...raw, taps: 0 };
  pushHistory(state.history, state.current);
  const last = state.display.at(-1);
  if (last && last.direction===direction && last.held===raw.buttons && !state.current.pressed && !state.current.released) last.duration++;
  else { state.display.push({...state.current,duration:1}); if(state.display.length>rules.displayHistorySize)state.display.shift(); }
  state.motions = parseMotions(readHistory(state.history));
  if (state.pending && combatFrame > state.pending.expires) state.pending = null;
  const button = priority.find(b => state.current.pressed & buttonBit(b));
  if (button) state.pending = { button, expires: combatFrame + bufferFrames - 1, motions: [...state.motions] };
}
export function consumeCommand(state: InputState, actionable: boolean, combatFrame: number): Button | null {
  if (!state.pending || !actionable || combatFrame > state.pending.expires) return null;
  const button = state.pending.button; state.pending = null;
  return button;
}
