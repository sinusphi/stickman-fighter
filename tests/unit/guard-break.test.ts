import { describe, expect, it } from 'vitest';
import rules from '../../src/data/rules.json';
import { MOVES } from '../../src/data/schema';
import { buttonBit, neutralInput, type RawInput } from '../../src/input/types';
import { createGame, snapshot, step } from '../../src/simulation/state';
import type { GameState } from '../../src/simulation/types';
import { COMBO_LOCK_MOVES, GUARD_BREAK_FREEZE_FRAMES, GUARD_BREAK_MOVES, UNSTOPPABLE_MOVES, lastHitFrame, shieldedFrom } from '../../src/simulation/guard-break';
import { createReplay, parseReplay, playReplay, validateSnapshot } from '../../src/debug/replay';
import { HitEffects, ParticleKind } from '../../src/render/effects';
import { guardBreakGlow } from '../../src/render/guard-break';
import { newContactSounds, newGuardBreaks } from '../../src/platform/hit-sound';

const U = rules.unit, LP = buttonBit('LP');
/** Back for the defender on the right (facing left). */
const BLOCK: RawInput = { ...neutralInput(), right: true };
function setup(distance = 60): GameState {
  const game = createGame(), [a, b] = game.fighters;
  a.x = 480 * U; b.x = a.x + distance * U;
  a.facing = a.attackFacing = 1; b.facing = b.attackFacing = -1;
  a.resources.revenge.current = 100;
  return game;
}
/** 236+LP for P1 from the left while P2 holds `defender`. */
function revenge(game: GameState, defender: RawInput = neutralInput()): void {
  for (const [down, right, buttons] of [[true, false, 0], [true, true, 0], [false, true, LP]] as const)
    step(game, [{ ...neutralInput(), down, right, buttons }, defender]);
}
/** Steps until a guard break is pending (or `limit` steps passed). */
function untilBreak(game: GameState, defender: RawInput, limit = 40): void {
  for (let i = 0; i < limit && !game.guardBreak; i++) step(game, [neutralInput(), defender]);
}

describe('guard break: move properties', () => {
  it('belongs to every full-bar move and to nothing else by default', () => {
    const fullBar = Object.values(MOVES).filter(m => m.command.resource).map(m => m.id).sort();
    expect(fullBar).toEqual(['revenge_combo', 'revenge_combo_f', 'revenge_combo_v', 'special_spin']);
    expect([...GUARD_BREAK_MOVES].sort()).toEqual(fullBar);
    expect([...COMBO_LOCK_MOVES].sort()).toEqual(fullBar);
  });
  it('knows the last hit frame of a move', () => {
    const move = MOVES.revenge_combo;
    expect(lastHitFrame('revenge_combo')).toBe(move.frames.map(f => f.hitboxes.length > 0).lastIndexOf(true));
    expect(lastHitFrame('revenge_combo')).toBeLessThan(move.duration);
  });
  it('leaves normal attacks blockable', () => {
    const game = setup(48);
    step(game, [{ ...neutralInput(), buttons: LP }, BLOCK]);
    for (let i = 0; i < MOVES.standing_lp.startup + 2; i++) step(game, [neutralInput(), BLOCK]);
    expect(game.lastContact?.blocked).toBe(true);
    expect(game.guardBreak).toBeUndefined();
    expect(game.fighters[1].state).toBe('Blockstun');
  });
});

describe('guard break: sequence', () => {
  it('freezes both fighters in the block, then lands the strike as a hit', () => {
    const game = setup(), [a, b] = game.fighters;
    revenge(game, BLOCK);
    untilBreak(game, BLOCK);
    expect(game.guardBreak).toMatchObject({ attacker: 0, defender: 1, group: 'jab', side: 1 });
    expect(game.hitstop).toBe(GUARD_BREAK_FREEZE_FRAMES);
    expect(b.state).toBe('Blockstun');
    // No block result: no hit target, no chip, no block contact.
    expect(a.hitTargets).toEqual([]);
    expect(b.hp).toBe(rules.maxHealth);
    const frozen = snapshot(game);
    for (let i = 1; i < GUARD_BREAK_FREEZE_FRAMES; i++) {
      step(game, [neutralInput(), BLOCK]);
      expect(game.guardBreak).toBeDefined();
      expect([a.x, a.moveFrame, b.x, b.state]).toEqual([frozen.fighters[0].x, frozen.fighters[0].moveFrame, frozen.fighters[1].x, 'Blockstun']);
    }
    step(game, [neutralInput(), BLOCK]);
    expect(game.guardBreak).toBeUndefined();
    expect(a.hitTargets).toEqual(['jab:1']);
    expect(game.lastContact).toMatchObject({ attacker: 0, defender: 1, blocked: false });
    expect(b.state).toBe('Hitstun');
    expect(b.lockedBy).toBe(a.attackId);
    expect(b.hp).toBeLessThan(rules.maxHealth);
    // The hit brings its own hitstop.
    expect(game.hitstop).toBeGreaterThan(0);
  });
  it('drops the pending strike when the attacker no longer runs that attack', () => {
    const game = setup(), [a] = game.fighters;
    revenge(game, BLOCK);
    untilBreak(game, BLOCK);
    a.attackId++;
    for (let i = 0; i < GUARD_BREAK_FREEZE_FRAMES; i++) step(game, [neutralInput(), BLOCK]);
    expect(game.guardBreak).toBeUndefined();
    expect(game.fighters[1].hp).toBe(rules.maxHealth);
  });
  it('is part of snapshots and replays', () => {
    const game = setup();
    revenge(game, BLOCK);
    untilBreak(game, BLOCK);
    expect(validateSnapshot(snapshot(game)).guardBreak).toEqual(game.guardBreak);
    expect(() => validateSnapshot({ ...snapshot(game), guardBreak: { ...game.guardBreak, defender: 0 } })).toThrow(/Guard Break/);
    expect(() => validateSnapshot({ ...snapshot(game), fighters: [game.fighters[0], { ...game.fighters[1], lockedBy: -1 }] })).toThrow(/Combo-Lock/);
    const replay = createReplay(setup());
    for (const [down, right, buttons] of [[true, false, 0], [true, true, 0], [false, true, LP]] as const)
      replay.frames.push({ inputs: [{ ...neutralInput(), down, right, buttons }, BLOCK], events: [] });
    for (let i = 0; i < 200; i++) replay.frames.push({ inputs: [neutralInput(), BLOCK], events: [] });
    let broke = false;
    const end = playReplay(replay, state => { broke ||= state.guardBreak !== undefined; });
    expect(broke).toBe(true);
    expect(end.fighters[0].hitTargets).toHaveLength(MOVES.revenge_combo.hitGroups.length);
    expect(playReplay(replay)).toEqual(end);
  });
});

describe('unstoppable Revenge combos', () => {
  const JAB: RawInput = { ...neutralInput(), buttons: LP };
  /** P2 jabs into P1's revenge startup, pressed on the step the motion completes. */
  function jabIntoStartup(moveId: string, button: 'LP' | 'LK' | 'RLK'): GameState {
    const game = setup(48), bit = buttonBit(button);
    for (const [down, right, buttons] of [[true, false, 0], [true, true, 0], [false, true, bit]] as const)
      step(game, [{ ...neutralInput(), down, right, buttons }, buttons ? JAB : neutralInput()]);
    expect(game.fighters[0].moveId).toBe(moveId);
    expect(game.fighters[1].moveId).toBe('standing_lp');
    // The jab is faster than the combo's opener.
    expect(MOVES.standing_lp.startup).toBeLessThan(MOVES[moveId].startup);
    return game;
  }
  it('belongs to the Revenge combos only, the Wirbel keeps its vulnerable startup', () => {
    expect([...UNSTOPPABLE_MOVES].sort()).toEqual(['revenge_combo', 'revenge_combo_f', 'revenge_combo_v']);
  });
  for (const [moveId, button] of [['revenge_combo', 'LP'], ['revenge_combo_f', 'LK'], ['revenge_combo_v', 'RLK']] as const) {
    it(`${moveId}: a faster attack passes through the startup, the combo lands in full`, () => {
      const game = jabIntoStartup(moveId, button), [a, b] = game.fighters;
      const attackId = a.attackId;
      for (let i = 0; i < MOVES[moveId].duration + 60; i++) {
        step(game);
        if (a.attackId === attackId && a.state !== 'Attack') break;
        if (a.attackId === attackId) expect(a.state).toBe('Attack');
      }
      expect(a.hp).toBe(rules.maxHealth);
      expect(a.resources.revenge.current).toBe(0);
      expect(a.hitTargets).toHaveLength(MOVES[moveId].hitGroups.length);
      expect(b.hp).toBeLessThan(rules.maxHealth);
    });
  }
  it('still trades with another unstoppable move, and protects only while the move runs', () => {
    const game = setup(), [a, b] = game.fighters;
    a.state = 'Attack'; a.moveId = 'revenge_combo';
    b.state = 'Attack'; b.moveId = 'standing_lp';
    expect(shieldedFrom(a, b)).toBe(true);
    expect(shieldedFrom(b, a)).toBe(false);
    b.moveId = 'revenge_combo_v';
    expect(shieldedFrom(a, b)).toBe(false);
    a.moveId = 'special_spin'; b.moveId = 'standing_lp';
    expect(shieldedFrom(a, b)).toBe(false);
    a.moveId = 'revenge_combo';
    a.state = 'Idle'; a.moveId = null; b.moveId = 'standing_lp';
    expect(shieldedFrom(a, b)).toBe(false);
  });
});

describe('guard break: presentation', () => {
  it('flashes, cracks the guard and shatters it on the breakthrough', () => {
    const game = setup(), effects = new HitEffects();
    revenge(game, BLOCK);
    let previous = snapshot(game);
    for (let i = 0; i < 40 && !game.guardBreak; i++) { step(game, [neutralInput(), BLOCK]); effects.update(game, previous); previous = snapshot(game); }
    expect(effects.particles().filter(p => p.kind === ParticleKind.Crack).length).toBeGreaterThanOrEqual(4);
    expect(effects.flash).toBeGreaterThan(0.4);
    // The glow on the defender rises through the freeze, the attacker shines faintly.
    const glowStart = guardBreakGlow(game.guardBreak, game.hitstop, 1);
    expect(glowStart).toBeGreaterThan(guardBreakGlow(game.guardBreak, game.hitstop, 0));
    expect(guardBreakGlow(game.guardBreak, 1, 1)).toBeGreaterThan(glowStart);
    expect(guardBreakGlow(undefined, 10, 1)).toBe(0);
    for (let i = 0; i < GUARD_BREAK_FREEZE_FRAMES; i++) { step(game, [neutralInput(), BLOCK]); effects.update(game, previous); previous = snapshot(game); }
    expect(game.guardBreak).toBeUndefined();
    expect(effects.flash).toBeGreaterThan(0.7);
  });
  it('sounds the blocked strike and the charge once, the breakthrough as a hit', () => {
    const game = setup();
    revenge(game, BLOCK);
    let previous = snapshot(game), breaks = 0, hits = 0;
    for (let i = 0; i < 80; i++) {
      step(game, [neutralInput(), BLOCK]);
      breaks += newGuardBreaks(game, previous).length;
      hits += newContactSounds(game, previous).filter(s => !s.blocked).length;
      previous = snapshot(game);
    }
    expect(breaks).toBe(1);
    expect(hits).toBeGreaterThanOrEqual(1);
    expect(newGuardBreaks(game, game)).toEqual([]);
  });
});

describe('training: full bars', () => {
  const bars = (game: GameState) => game.fighters.map(f => [f.resources.revenge.current, f.resources.special.current]);
  it('keeps the chosen bars full for both fighters, only while training runs', () => {
    const game = createGame();
    step(game, [neutralInput(), neutralInput()], [{ type: 'trainingBars', revenge: true, special: false }]);
    expect(bars(game)).toEqual([[0, 0], [0, 0]]);
    step(game, [neutralInput(), neutralInput()], [{ type: 'training', enabled: true, dummy: 'stand' }]);
    expect(game.training).toMatchObject({ enabled: true, fullRevenge: true, fullSpecial: false });
    expect(bars(game)).toEqual([[100, 0], [100, 0]]);
    step(game, [neutralInput(), neutralInput()], [{ type: 'trainingBars', revenge: false, special: true }]);
    expect(bars(game)).toEqual([[100, 100], [100, 100]]);
    // Switching the dummy or resetting keeps the options.
    step(game, [neutralInput(), neutralInput()], [{ type: 'training', enabled: true, dummy: 'block' }, { type: 'reset' }]);
    expect(game.training).toMatchObject({ dummy: 'block', fullRevenge: false, fullSpecial: true });
    expect(bars(game)).toEqual([[0, 100], [0, 100]]);
  });
  it('refills a spent bar right away, so full-bar moves can follow each other', () => {
    const game = setup();
    step(game, [neutralInput(), neutralInput()], [{ type: 'training', enabled: true, dummy: 'stand' }]);
    step(game, [neutralInput(), neutralInput()], [{ type: 'trainingBars', revenge: true, special: true }]);
    game.fighters[0].x = 480 * U; game.fighters[1].x = 540 * U;
    revenge(game);
    expect(game.fighters[0].moveId).toBe('revenge_combo');
    step(game, [neutralInput(), neutralInput()]);
    expect(game.fighters[0].resources.revenge.current).toBe(100);
  });
  it('is validated in replays', () => {
    const replay = createReplay(createGame());
    replay.frames.push({ inputs: [neutralInput(), neutralInput()], events: [{ type: 'trainingBars', revenge: true, special: false }] });
    expect(() => parseReplay(replay)).not.toThrow();
    replay.frames.push({ inputs: [neutralInput(), neutralInput()], events: [{ type: 'trainingBars', revenge: 1, special: false } as never] });
    expect(() => parseReplay(replay)).toThrow(/Steuerereignisse/);
    const state = { ...createGame(), training: { enabled: true, dummy: 'stand', fullRevenge: 'yes' } };
    expect(() => validateSnapshot(state)).toThrow(/Trainingszustand/);
  });
});
