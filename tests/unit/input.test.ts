import { describe, expect, it } from 'vitest';
import { cleanInput } from '../../src/input/socd';
import { createInputState, readHistory } from '../../src/input/history';
import { captureInput, consumeCommand } from '../../src/input/commands';
import { MOTIONS, matchesMotion, parseMotions } from '../../src/input/motions';
import { buttonBit, neutralInput, type Direction, type InputFrame, type RawInput } from '../../src/input/types';
import { DEFAULT_CONTROLS, validateControls } from '../../src/platform/devices';

const socd = { horizontal: 'neutral', vertical: 'positive' } as const;
function history(directions: number[], button = 'LP'): InputFrame[] {
  return directions.map((direction, frame) => ({ direction: direction as Direction, frame, pressed: frame === directions.length - 1 ? buttonBit(button as 'LP') : 0, held: 0, released: 0 }));
}
function rawDirection(direction: number, facing = 1): RawInput {
  const x = ((direction - 1) % 3 - 1) * facing;
  return { ...neutralInput(), left: x < 0, right: x > 0, up: direction >= 7, down: direction <= 3 };
}

describe('SOCD and frame inputs', () => {
  it('neutralizes horizontal opposition and gives up vertical priority', () => {
    expect(cleanInput({ ...neutralInput(), left: true, right: true }, createInputState(), socd, 1)).toBe(5);
    expect(cleanInput({ ...neutralInput(), up: true, down: true }, createInputState(), socd, 1)).toBe(8);
  });
  it('supports neutral and last-input modes including simultaneous edges', () => {
    const state = createInputState();
    captureInput(state, { ...neutralInput(), left: true }, 1, 0, 0, { ...socd, horizontal: 'lastInputWins' }, 5);
    expect(cleanInput({ ...neutralInput(), left: true, right: true }, state, { ...socd, horizontal: 'lastInputWins' }, 1)).toBe(6);
    expect(cleanInput({ ...neutralInput(), up: true, down: true }, createInputState(), { ...socd, vertical: 'neutral' }, 1)).toBe(5);
    expect(cleanInput({ ...neutralInput(), left: true, right: true }, createInputState(), { ...socd, horizontal: 'lastInputWins' }, 1)).toBe(5);
  });
  it('records button edges, held inputs, taps and a wrapping 120-frame history', () => {
    const state = createInputState();
    for (let frame = 0; frame < 150; frame++) captureInput(state, { ...neutralInput(), buttons: frame === 148 ? 1 : 0 }, 1, frame, frame, socd, 5);
    expect(readHistory(state.history)).toHaveLength(120);
    expect(readHistory(state.history)[0].frame).toBe(30);
    expect(state.current.released).toBe(1);
    captureInput(state, { ...neutralInput(), taps: 2 }, 1, 150, 150, socd, 5);
    expect(state.current.pressed).toBe(2); expect(state.current.held).toBe(0); expect(state.current.released).toBe(2);
    captureInput(state, { ...neutralInput(), buttons: 1 }, 1, 151, 151, socd, 5);
    captureInput(state, { ...neutralInput(), buttons: 1 }, 1, 152, 152, socd, 5);
    expect(state.current.pressed).toBe(0); expect(state.current.held).toBe(1);
  });
  it('buffers once until the first actionable frame, then expires', () => {
    const state = createInputState();
    captureInput(state, { ...neutralInput(), buttons: 1 }, 1, 0, 10, socd, 5);
    expect(consumeCommand(state, false, 12)).toBe(null);
    expect(consumeCommand(state, true, 14)).toBe('LP');
    expect(consumeCommand(state, true, 14)).toBe(null);
    captureInput(state, { ...neutralInput(), buttons: 0, taps: 1 }, 1, 1, 20, socd, 5);
    expect(consumeCommand(state, true, 25)).toBe(null);
  });
  it('validates portable device settings and rejects double assignment', () => {
    expect(validateControls(DEFAULT_CONTROLS)).toEqual(DEFAULT_CONTROLS);
    const config = structuredClone(DEFAULT_CONTROLS); config.players.forEach(p => p.gamepadIndex = 0);
    expect(() => validateControls(config)).toThrow();
    expect(() => validateControls({ ...DEFAULT_CONTROLS, bufferFrames: 0 })).toThrow();
  });
  it('retains the last display changes beyond the motion buffer duration',()=>{
    const state=createInputState();captureInput(state,{...neutralInput(),buttons:1},1,0,0,socd,5);
    for(let frame=1;frame<400;frame++)captureInput(state,neutralInput(),1,frame,frame,socd,5);
    expect(state.display[0].pressed).toBe(1);expect(state.display.at(-1)!.duration).toBe(399);
  });
});

describe('motion parser', () => {
  it.each(MOTIONS.filter(m => !m.charge))('recognizes $id with neutral gaps on both sides', motion => {
    for (const facing of [-1, 1]) {
      const state = createInputState();
      const sequence = motion.sequence.flatMap((d, i) => i ? [5, d] : [d]);
      sequence.forEach((direction, frame) => captureInput(state, { ...rawDirection(direction, facing), buttons: frame === sequence.length - 1 ? buttonBit(motion.buttons[0] as 'LP') : 0 }, facing, frame, frame, socd, 5));
      expect(state.motions).toContain(motion.id);
    }
  });
  it('rejects missing diagonals, wrong order and wrong button group', () => {
    expect(parseMotions(history([2, 6]))).toEqual([]);
    expect(parseMotions(history([3, 2, 6]))).toEqual([]);
    expect(parseMotions(history([2, 3, 6], 'LK'))).toEqual([]);
  });
  it('can begin a quarter-circle from a held down direction',()=>{
    expect(parseMotions(history([...Array(80).fill(2),3,6]))).toContain('236+P');
    expect(parseMotions(history([2,...Array(80).fill(3),6]))).not.toContain('236+P');
  });
  it('enforces exact gap, total and button-window boundaries', () => {
    const qcf = MOTIONS[0];
    expect(matchesMotion(history([2, ...Array(7).fill(5), 3, 6]), qcf)).toBe(true);
    expect(matchesMotion(history([2, ...Array(8).fill(5), 3, 6]), qcf)).toBe(false);
    expect(matchesMotion(history([2, 3, 6, 6, 6, 6]), qcf)).toBe(true);
    expect(matchesMotion(history([2, 3, 6, 6, 6, 6, 6]), qcf)).toBe(false);
    expect(matchesMotion(history([2, 3, 6]), { ...qcf, maxTotalFrames: 3 })).toBe(true);
    expect(matchesMotion(history([2, 3, 6]), { ...qcf, maxTotalFrames: 2 })).toBe(false);
  });
  it('recognizes diagonal charge and enforces 44/45 and release limits', () => {
    const charge = MOTIONS[4];
    expect(matchesMotion(history([...Array(44).fill(4), 6]), charge)).toBe(false);
    expect(matchesMotion(history([...Array(45).fill(1), 6]), charge)).toBe(true);
    expect(matchesMotion(history([...Array(45).fill(4), ...Array(7).fill(5), 6]), charge)).toBe(true);
    expect(matchesMotion(history([...Array(45).fill(4), ...Array(8).fill(5), 6]), charge)).toBe(false);
    expect(matchesMotion(history([...Array(25).fill(4), 5, ...Array(25).fill(4), 6]), charge)).toBe(false);
  });
  it('keeps historical directions when facing changes', () => {
    const state = createInputState();
    captureInput(state, rawDirection(4), 1, 0, 0, socd, 5);
    captureInput(state, rawDirection(4), -1, 1, 1, socd, 5);
    expect(readHistory(state.history).map(f => f.direction)).toEqual([4, 6]);
  });
  it('sorts competing commands by declared priority', () => {
    const candidates = [MOTIONS[0], { ...MOTIONS[2], sequence: [2,3,6] }];
    expect(parseMotions(history([2,3,6]), candidates)).toEqual(['623+P','236+P']);
    expect(parseMotions(history([4,1,2,3,6]))).toEqual(['41236+P','236+P']);
  });
});
