import { describe, expect, it } from 'vitest';
import rules from '../../src/data/rules.json';
import { MOVES } from '../../src/data/schema';
import { buttonBit, neutralInput, type Button, type RawInput } from '../../src/input/types';
import { CHORD_UPGRADES, CHORD_WINDOW_FRAMES, hitStrength } from '../../src/simulation/combat';
import { requiresCrouchGuard } from '../../src/simulation/guard';
import { createGame, snapshot, step } from '../../src/simulation/state';
import type { GameState } from '../../src/simulation/types';
import { CpuPlayer } from '../../src/ai';
import { KNOWLEDGE } from '../../src/ai/knowledge';
import { advanceOffset, samplePose } from '../../src/render/skeleton';
import { classifyHit, newResourceStarts, swingCues } from '../../src/platform/hit-sound';
import { SURVIVAL } from '../../src/survival/config';
import { bossSpec } from '../../src/survival/spawner';
import { createSurvival, spawnEnemy, stepSurvival, type SurvivalState } from '../../src/survival/state';
import { createReplay, playReplay } from '../../src/debug/replay';

const id = 'revenge_combo', move = MOVES[id], U = rules.unit;
/** Steps for one full combo including every hitstop (77 frames + 67 hitstop frames on hit). */
const RUN = 200;
const KEYS: Button[] = ['LK', 'LMK', 'HK'];
const ALL = KEYS.reduce((bits, b) => bits | buttonBit(b), 0);
const GROUPS = ['jab', 'hook', 'leftMiddle', 'leftHigh', 'rightMiddle', 'rightHigh', 'punch'];
const press = (facing: 1 | -1, buttons: number, direction: 4 | 5 | 6 = 6, down = false): RawInput =>
  ({ ...neutralInput(), right: direction === 6 ? facing === 1 : direction === 4 ? facing === -1 : false, left: direction === 6 ? facing === -1 : direction === 4 ? facing === 1 : false, down, buttons });
function setup(facing: 1 | -1 = 1, distance = 250, revenge = 100): GameState {
  const game = createGame(), [a, b] = game.fighters;
  a.x = 480 * U; b.x = a.x + facing * distance * U;
  a.facing = a.attackFacing = facing; b.facing = b.attackFacing = -facing as 1 | -1;
  a.resources.revenge.current = revenge;
  return game;
}
/** Every key order and arrival frame inside the chord window (per key: frame it is pressed). */
function arrivals(): number[][] {
  const out: number[][] = [];
  for (let a = 0; a <= CHORD_WINDOW_FRAMES; a++) for (let b = 0; b <= CHORD_WINDOW_FRAMES; b++) for (let c = 0; c <= CHORD_WINDOW_FRAMES; c++)
    if (Math.min(a, b, c) === 0) out.push([a, b, c]);
  return out;
}
function playPattern(game: GameState, facing: 1 | -1, pattern: number[], direction: 4 | 5 | 6 = 6, down = false): void {
  for (let frame = 0; frame <= Math.max(...pattern); frame++)
    step(game, [press(facing, KEYS.reduce((bits, b, i) => pattern[i] <= frame ? bits | buttonBit(b) : bits, 0), direction, down), neutralInput()]);
}
/** First active frame of every hit group (from the frame boxes). */
const starts = GROUPS.map(group => move.frames.findIndex(frame => frame.hitboxes.some(box => box.hitGroup === group)));
/** Landed group ids of one combo at `distance`, defender standing or crouching. */
function landed(distance: number, crouch: boolean, facing: 1 | -1 = 1, shiftAfterJab = 0): string[] {
  const game = setup(facing, distance), [a, b] = game.fighters;
  const defender = { ...neutralInput(), down: crouch };
  for (let i = 0; i < 3; i++) step(game, [neutralInput(), defender]);
  step(game, [press(facing, ALL), defender]);
  let shifted = false;
  for (let f = 0; f < RUN; f++) {
    step(game, [neutralInput(), defender]);
    if (!shifted && a.hitTargets[0]?.startsWith('jab')) { b.x += facing * shiftAfterJab * U; shifted = true; }
  }
  return a.hitTargets.map(t => t.split(':')[0]);
}

describe('revenge combo: data', () => {
  it('is a forward LK+LMK+HK hold chord that needs and spends the Revenge bar', () => {
    expect(move.command).toMatchObject({ type: 'hold', directions: [6], buttons: KEYS, resource: 'revenge' });
    expect(move.button).toBe('HK');
    expect(move.standingHitstun).toBe(true);
    expect(CHORD_UPGRADES.filter(chord => chord.target === id)).toHaveLength(1);
    expect(CHORD_UPGRADES[0].target).toBe(id);
  });
  it('has seven hits in order, a quick opener and a total length well below the five-hit combo', () => {
    expect(move.hitGroups.map(g => g.id)).toEqual(GROUPS);
    expect(starts[0]).toBe(move.startup);
    expect(move.startup).toBeLessThanOrEqual(10);
    expect(move.duration).toBeGreaterThanOrEqual(65);
    expect(move.duration).toBeLessThanOrEqual(80);
    expect(move.duration).toBeLessThan(MOVES.middle_high_punch_combo.duration);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(7);
      expect(starts[i] - starts[i - 1]).toBeLessThanOrEqual(12);
    }
    const damage = move.hitGroups.reduce((sum, g) => sum + (g.damage ?? move.damage), 0);
    expect(damage).toBeGreaterThanOrEqual(450);
    expect(damage).toBeLessThanOrEqual(550);
  });
  it('chains every hit into the next one: next active start ≤ hitstun − 2', () => {
    for (let i = 0; i + 1 < GROUPS.length; i++) {
      const group = move.hitGroups[i], hitstun = group.hitstun ?? move.hitstun;
      expect(starts[i + 1] - starts[i], `${group.id} → ${GROUPS[i + 1]}`).toBeLessThanOrEqual(hitstun - 2);
      // Only the finisher pushes; the others keep the opponent in reach.
      expect(group.pushbackHit ?? move.pushbackHit, group.id).toBe(0);
    }
    expect(move.hitGroups.at(-1)!.pushbackHit).toBeGreaterThan(0);
  });
  it('knocks down only with the finisher, against every stability in versus and survival', () => {
    const stabilities = [rules.hitStrength.defaultStability, ...Object.values(SURVIVAL.types).map(t => t.stability), bossSpec(SURVIVAL, 9).stability];
    for (const group of move.hitGroups.slice(0, -1)) expect(hitStrength(move, group), group.id).toBeLessThan(Math.min(...stabilities));
    expect(hitStrength(move, move.hitGroups.at(-1)!)).toBeGreaterThanOrEqual(Math.max(...stabilities));
  });
  it('uses the hit levels jab HIGH, hook MID, middles MID, highs and finisher HIGH (guard rules)', () => {
    const levels = move.hitGroups.map(g => g.hitLevel ?? move.hitLevel);
    expect(levels).toEqual(['HIGH', 'MID', 'MID', 'HIGH', 'MID', 'HIGH', 'HIGH']);
    expect(levels.map(level => requiresCrouchGuard(level))).toEqual([false, true, true, false, true, false, false]);
  });
});

describe('revenge combo: input', () => {
  it('starts with a full bar for every key order inside the window, in both facings, on the same path', () => {
    for (const facing of [1, -1] as const) {
      let path: number | null = null;
      for (const pattern of arrivals()) {
        const game = setup(facing);
        playPattern(game, facing, pattern);
        const a = game.fighters[0];
        expect(a.moveId, pattern.join('/')).toBe(id);
        expect(a.attackId).toBe(1);
        expect(a.resources.revenge.current).toBe(0);
        // Same world path whichever key came first (standing_lk's own step is replaced).
        for (let f = Math.max(...pattern); f < 30; f++) step(game, [neutralInput(), neutralInput()]);
        path ??= a.x;
        expect(a.x, pattern.join('/')).toBe(path);
      }
    }
  });
  it('spends the bar at the start, also on a whiff', () => {
    const game = setup(1, 300);
    step(game, [press(1, ALL), neutralInput()]);
    expect(game.fighters[0].moveId).toBe(id);
    expect(game.fighters[0].resources.revenge.current).toBe(0);
    for (let f = 0; f < 100; f++) step(game, [neutralInput(), neutralInput()]);
    expect(game.fighters[1].hp).toBe(rules.maxHealth);
    expect(game.fighters[0].resources.revenge.current).toBe(0);
  });
  it('behaves exactly as before without a full bar', () => {
    for (const facing of [1, -1] as const) for (const pattern of arrivals()) for (const revenge of [99, 50]) {
      const game = setup(facing, 250, revenge), baseline = setup(facing, 250, 0);
      playPattern(game, facing, pattern); playPattern(baseline, facing, pattern);
      for (let f = 0; f < 40; f++) { step(game, [neutralInput(), neutralInput()]); step(baseline, [neutralInput(), neutralInput()]); }
      expect(game.fighters[0].resources.revenge.current).toBe(revenge);
      const strip = (g: GameState) => g.fighters.map(({ resources: _, ...rest }) => rest);
      expect(strip(game), pattern.join('/')).toEqual(strip(baseline));
    }
  });
  it('needs the standing ground state and direction 6', () => {
    // Crouching, no direction and back: never the Revenge combo, bar kept.
    for (const [direction, down] of [[6, true], [5, false], [4, false]] as const) {
      const game = setup(1);
      step(game, [press(1, ALL, direction, down), neutralInput()]);
      expect(game.fighters[0].moveId, `${direction}${down ? ' down' : ''}`).not.toBe(id);
      expect(game.fighters[0].resources.revenge.current).toBe(100);
    }
    // In the air.
    const game = setup(1);
    step(game, [{ ...neutralInput(), up: true, right: true }, neutralInput()]);
    for (let i = 0; i < 6; i++) step(game, [neutralInput(), neutralInput()]);
    expect(game.fighters[0].y).toBeLessThan(0);
    step(game, [press(1, ALL), neutralInput()]);
    expect(game.fighters[0].moveId).not.toBe(id);
    expect(game.fighters[0].resources.revenge.current).toBe(100);
  });
  it('displaces no single kick and no other chord, even with a full bar', () => {
    for (const facing of [1, -1] as const) {
      for (const [button, want] of [['LK', 'standing_lk'], ['LMK', 'standing_lmk'], ['HK', 'spin_hk']] as const) {
        const game = setup(facing);
        step(game, [press(facing, buttonBit(button)), neutralInput()]);
        expect(game.fighters[0].moveId).toBe(want);
        expect(game.fighters[0].resources.revenge.current).toBe(100);
      }
      // Other full-bar chords need their own bar (special_spin: tests/unit/special-spin.test.ts).
      for (const chord of CHORD_UPGRADES.filter(c => c.target !== id && !MOVES[c.target].command.resource)) {
        const buttons = Object.values(chord.sources);
        for (let gap = 0; gap <= CHORD_WINDOW_FRAMES; gap++) {
          const game = setup(facing);
          for (let i = 0; i < gap; i++) step(game, [press(facing, buttonBit(buttons[0]), chord.direction as 4 | 6), neutralInput()]);
          step(game, [press(facing, buttons.reduce((bits, b) => bits | buttonBit(b), 0), chord.direction as 4 | 6), neutralInput()]);
          expect(game.fighters[0].moveId, `${chord.target} ${gap}`).toBe(chord.target);
          expect(game.fighters[0].resources.revenge.current).toBe(100);
        }
      }
      // A late third key (outside the window) no longer upgrades.
      const game = setup(facing);
      step(game, [press(facing, buttonBit('HK') | buttonBit('LMK')), neutralInput()]);
      for (let i = 0; i < CHORD_WINDOW_FRAMES; i++) step(game, [press(facing, buttonBit('HK') | buttonBit('LMK')), neutralInput()]);
      step(game, [press(facing, ALL), neutralInput()]);
      expect(game.fighters[0].moveId).toBe('spin_hk');
      expect(game.fighters[0].resources.revenge.current).toBe(100);
    }
  });
});

/** Documented start distances (centre to centre, px): bodies touching up to the opener's reach. */
const RANGE = { standing: [38, 93], crouching: [38, 86] } as const;
describe('revenge combo: hits', () => {
  it('lands all seven hits once the jab lands, standing or crouching, in both facings', () => {
    for (const facing of [1, -1] as const) for (const crouch of [false, true]) {
      const [min, max] = RANGE[crouch ? 'crouching' : 'standing'];
      for (let d = min; d <= max; d++) expect(landed(d, crouch, facing), `${facing} ${crouch} ${d}`).toEqual(GROUPS);
      // Beyond the documented maximum the opener (and everything) whiffs: never a broken chain.
      for (let d = max + 1; d <= max + 15; d++) {
        const hits = landed(d, crouch, facing);
        if (hits[0] === 'jab') expect(hits, `${facing} ${crouch} ${d}`).toEqual(GROUPS);
      }
    }
  });
  it('keeps a reach reserve: the follow-ups still land with the opponent shifted 2 px further after the jab', () => {
    for (const facing of [1, -1] as const) for (const crouch of [false, true]) {
      const [, max] = RANGE[crouch ? 'crouching' : 'standing'];
      for (let d = max - 4; d <= max; d++) expect(landed(d, crouch, facing, 2), `${facing} ${crouch} ${d}`).toEqual(GROUPS);
    }
  });
  it('deals the full damage, stands a crouching opponent up and knocks down with the finisher', () => {
    const game = setup(1, 60), [a, b] = game.fighters, crouch = { ...neutralInput(), down: true };
    step(game, [neutralInput(), crouch]);
    step(game, [press(1, ALL), crouch]);
    let knocked = false;
    for (let f = 0; f < RUN; f++) {
      step(game, [neutralInput(), crouch]);
      if (a.hitTargets.length >= 1 && b.state === 'Hitstun') expect(b.crouching).toBe(false);
      knocked ||= b.state === 'Knockdown';
    }
    expect(b.hp).toBe(rules.maxHealth - 500);
    expect(knocked).toBe(true);
  });
  it('stays blockable after a blocked opener (no special rule)', () => {
    const game = setup(1, 60), block = { ...neutralInput(), left: false, right: true };
    step(game, [neutralInput(), block]);
    step(game, [press(1, ALL), block]);
    for (let f = 0; f < 10; f++) step(game, [neutralInput(), block]);
    expect(game.lastContact?.blocked).toBe(true);
    expect(game.fighters[1].hp).toBeGreaterThan(rules.maxHealth - 10);
  });
  it('works in training (bar handled as in versus, no damage) and replays deterministically', () => {
    const game = setup(1, 60);
    game.training = { enabled: true, dummy: 'stand' };
    const replay = createReplay(game);
    replay.frames.push({ inputs: [press(1, ALL), neutralInput()], events: [] });
    for (let f = 0; f < RUN; f++) replay.frames.push({ inputs: [neutralInput(), neutralInput()], events: [] });
    let started = false;
    const end = playReplay(replay, state => { started ||= state.fighters[0].moveId === id; });
    expect(started).toBe(true);
    expect(end.fighters[0].resources.revenge.current).toBe(0);
    expect(end.fighters[0].hitTargets.map(t => t.split(':')[0])).toEqual(GROUPS);
    expect(end.fighters[1].hp).toBe(rules.maxHealth);
    // The dummy still charges its own Revenge from the hits, as in versus.
    expect(end.fighters[1].resources.revenge.current).toBe(100);
    expect(playReplay(replay)).toEqual(end);
  });
});

describe('revenge combo: survival', () => {
  const quiet = (): SurvivalState => { const s = createSurvival(3); s.spawnTimer = 1e9; s.flow.bossTimer = 1e9; s.flow.waveTimer = 1e9; return s; };
  function survivalRun(kind: Parameters<typeof spawnEnemy>[2], distance: number, facing: 1 | -1 = 1) {
    const s = quiet();
    s.player.facing = s.player.attackFacing = facing;
    const e = spawnEnemy(s, facing, kind);
    e.entering = false; e.fighter.x = s.player.x + facing * distance * U; e.fighter.facing = -facing as 1 | -1;
    s.player.resources.revenge.current = 100;
    stepSurvival(s, press(facing, ALL));
    expect(s.player.moveId).toBe(id);
    expect(s.player.resources.revenge.current).toBe(0);
    let hits = 0, hp = e.fighter.hp, knockdownBeforeFinisher = false;
    for (let f = 0; f < RUN; f++) {
      stepSurvival(s, neutralInput());
      if (e.fighter.hp < hp) { hits++; hp = e.fighter.hp; }
      if (e.fighter.state === 'Knockdown' && hits < 7 && e.fighter.hp > 0) knockdownBeforeFinisher = true;
    }
    return { hits, e, knockdownBeforeFinisher };
  }
  it('lands all seven hits on heavy enemies and bosses at the documented distances', () => {
    for (const facing of [1, -1] as const) for (const kind of ['heavy', bossSpec(SURVIVAL, 1), bossSpec(SURVIVAL, 6)] as const)
      for (const d of [RANGE.standing[0], 60, RANGE.standing[1]]) {
        const { hits, e, knockdownBeforeFinisher } = survivalRun(kind, d, facing);
        expect(hits, `${typeof kind === 'string' ? kind : 'boss'} ${d}`).toBe(7);
        expect(knockdownBeforeFinisher).toBe(false);
        expect(e.fighter.state === 'Knockdown' || e.fighter.state === 'Idle').toBe(true);
      }
  });
  it('is not cut short by stagger: light enemies take every hit until they fall KO', () => {
    for (const kind of Object.keys(SURVIVAL.types) as (keyof typeof SURVIVAL.types)[]) {
      const { hits, e, knockdownBeforeFinisher } = survivalRun(kind, 50);
      expect(knockdownBeforeFinisher, kind).toBe(false);
      // Enough hits to empty the energy, or all seven.
      const needed = move.hitGroups.findIndex((_, i) => move.hitGroups.slice(0, i + 1).reduce((n, g) => n + (g.damage ?? 0), 0) >= SURVIVAL.types[kind].hp) + 1 || 7;
      expect(hits, kind).toBe(needed);
      if (needed < 7) expect(e.dead).toBe(true);
    }
  });
});

describe('revenge combo: CPU, presentation, animation', () => {
  it('is not part of the CPU repertoire and a CPU with a full bar never starts it', () => {
    expect(KNOWLEDGE.some(m => m.id === id)).toBe(false);
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const game = createGame(), cpu = new CpuPlayer(difficulty, 1);
      game.fighters[0].x = 420 * U; game.fighters[1].x = 500 * U;
      for (let f = 0; f < 1500 && game.round.phase !== 'matchOver'; f++) {
        game.fighters[1].resources.revenge.current = 100;
        step(game, [neutralInput(), cpu.next(game)]);
        expect(game.fighters[1].moveId).not.toBe(id);
      }
    }
  });
  it('sounds like punches and kicks, one whoosh per strike, and reports its start once', () => {
    expect(GROUPS.map(g => classifyHit(id, g).kind)).toEqual(['punch', 'punch', 'kick', 'kick', 'kick', 'kick', 'punch']);
    expect(swingCues(id)).toHaveLength(7);
    // Chord upgrade (HK first, LK+LMK a frame later): the start is reported on the upgrade step only.
    const game = setup(1);
    let previous = snapshot(game), reported = 0;
    for (const buttons of [buttonBit('HK'), ALL, ALL, 0, 0]) {
      step(game, [press(1, buttons), neutralInput()]);
      reported += newResourceStarts(game, previous).length; previous = snapshot(game);
    }
    expect(game.fighters[0].moveId).toBe(id);
    expect(reported).toBe(1);
  });
  it('never slides a planted foot and keeps one foot on the floor throughout', () => {
    // Exact on the baked frames; between them the engine interpolates angles, which
    // during the step-in moves a planted foot by at most a fraction of a pixel.
    for (const facing of [1, -1]) for (const [stepSize, tolerance] of [[1, .02], [.25, .3]]) {
      for (let f = 0; f < move.duration - 1; f += stepSize) {
        const a = samplePose(id, f, facing), b = samplePose(id, f + stepSize, facing);
        const da = advanceOffset(id, f), db = advanceOffset(id, f + stepSize);
        expect(Math.min(Math.abs(a.leftFoot[1]), Math.abs(a.rightFoot[1])), `frame ${f}`).toBeLessThan(.05);
        for (const foot of ['leftFoot', 'rightFoot'] as const)
          if (Math.abs(a[foot][1]) < .01 && Math.abs(b[foot][1]) < .01)
            expect(Math.abs(b[foot][0] + facing * db - a[foot][0] - facing * da), `${foot} frame ${f}`).toBeLessThan(tolerance);
      }
    }
  });
});
