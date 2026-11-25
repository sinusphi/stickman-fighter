import { describe, expect, it } from 'vitest';
import moveData from '../../src/data/moves.json';
import { MOVES, advanceAt, validateMoves } from '../../src/data/schema';
import { HitFeedback } from '../../src/render/feedback';
import { createGame, snapshot } from '../../src/simulation/state';
import { comboMoves } from '../../src/platform/combos';

describe('hold commands follow structural rules', () => {
  const withCommand = (button: string, buttons: string[], directions = [6]) => {
    const copy = structuredClone(moveData);
    const move = copy.find(m => m.id === 'spin_mk')!;
    move.id = 'new_combo'; move.button = button; Object.assign(move.command, { buttons, directions });
    return copy;
  };
  it('accepts a new two-button combo without a schema change', () => {
    expect(validateMoves(withCommand('MK', ['LK', 'MK']))).toHaveProperty('new_combo');
    expect(validateMoves(withCommand('HP', ['HP', 'LP'], [4]))).toHaveProperty('new_combo');
  });
  it('requires the highest-priority button as the move button', () => {
    // rules.normalPriority: MK ranks above LK, so LK can never start this chord.
    expect(() => validateMoves(withCommand('LK', ['LK', 'MK']))).toThrow(/Hold-Command/);
  });
  it('rejects duplicate buttons, four buttons and non-horizontal directions', () => {
    expect(() => validateMoves(withCommand('MK', ['MK', 'MK']))).toThrow(/Hold-Command/);
    // Three-key chords exist (Revenge combo); four never.
    expect(validateMoves(withCommand('HK', ['HK', 'MK', 'LK']))).toHaveProperty('new_combo');
    expect(() => validateMoves(withCommand('HK', ['HK', 'MK', 'LK', 'LP']))).toThrow(/Hold-Command/);
    expect(() => validateMoves(withCommand('MK', ['MK'], [2]))).toThrow(/Hold-Command/);
  });
});

describe('shared advance curve', () => {
  it('is smoothstep in whole subpixels and clamps outside the step', () => {
    const advance = { frames: 10, distance: 1000 };
    expect(advanceAt(undefined, 5)).toBe(0);
    expect(advanceAt(advance, -1)).toBe(0);
    expect(advanceAt(advance, 5)).toBe(500);
    expect(advanceAt(advance, 10)).toBe(1000);
    expect(advanceAt(advance, 99)).toBe(1000);
  });
});

describe('hit feedback', () => {
  it('treats blocked chip damage as a block, not as a hit', () => {
    const previous = createGame(), game = snapshot(previous);
    const defender = game.fighters[1];
    defender.hp -= 7; defender.state = 'Blockstun';
    game.lastContact = { attacker: 0, defender: 1, blocked: true, frame: 0, hitLevel: 'HIGH' };
    const feedback = new HitFeedback();
    feedback.update(game, previous);
    expect(feedback.levels[1]).toBeUndefined();
  });
  it('still records the level of a real hit', () => {
    const previous = createGame(), game = snapshot(previous);
    game.fighters[1].hp -= 30; game.fighters[1].state = 'Hitstun';
    game.lastContact = { attacker: 0, defender: 1, blocked: false, frame: 0, hitLevel: 'MID' };
    const feedback = new HitFeedback();
    feedback.update(game, previous);
    expect(feedback.levels[1]).toBe('MID');
  });
});

describe('combo list', () => {
  it('lists every multi-button move exactly once', () => {
    const ids = Object.values(MOVES).filter(m => m.command.buttons.length > 1).map(m => m.id).sort();
    expect(comboMoves.map(m => m.id).sort()).toEqual(ids);
  });
});
