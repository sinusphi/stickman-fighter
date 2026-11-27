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
import { GUARD_BREAK_FREEZE_FRAMES } from '../../src/simulation/guard-break';

const id = 'revenge_combo', move = MOVES[id], U = rules.unit;
/** Steps for one full combo including every hitstop (77 frames + 67 hitstop frames on hit). */
const RUN = 200;
const LP = buttonBit('LP');
/** The former forward chord LK+LMK+HK: no longer the Revenge combo. */
const OLD_CHORD = (['LK', 'LMK', 'HK'] as Button[]).reduce((bits, b) => bits | buttonBit(b), 0);
const GROUPS = ['jab', 'hook', 'leftMiddle', 'leftHigh', 'rightMiddle', 'rightHigh', 'punch'];
function setup(facing: 1 | -1 = 1, distance = 250, revenge = 100): GameState {
  const game = createGame(), [a, b] = game.fighters;
  a.x = 480 * U; b.x = a.x + facing * distance * U;
  a.facing = a.attackFacing = facing; b.facing = b.attackFacing = -facing as 1 | -1;
  a.resources.revenge.current = revenge;
  return game;
}
/** Numpad direction (relative to `facing`) plus buttons as raw input. */
const pad = (facing: 1 | -1, direction: number, buttons = 0): RawInput => {
  const x = (direction - 1) % 3 - 1;
  return { ...neutralInput(), down: direction <= 3, up: direction >= 7, right: x * facing > 0, left: x * facing < 0, buttons };
};
/** Hold down, add forward and keep both, then LP (the shortest input). */
const QCF = [2, 3];
/** Input variants of 23+LP: held parts (also long), LP after down-forward, down-forward let go just before LP, a short neutral in between. */
const VARIANTS: [number[], number][] = [
  [[2, 3], 1], [[2, 3, 3], 2], [[2, 2, 2, 3, 3], 4], [[2, 3, 3, 3, 3, 3], 5], [[...Array(40).fill(2), ...Array(60).fill(3)], 99], [[2, 3, 5], 2], [[2, 5, 3], 2],
];
/** Plays `directions` with LP pressed on frame `lp` (0 = none) and held from there. */
function playMotion(game: GameState, facing: 1 | -1, directions: number[] = QCF, lp = directions.length - 1, defender = neutralInput()): void {
  directions.forEach((direction, frame) => step(game, [pad(facing, direction, frame >= lp ? LP : 0), defender]));
}
/** First active frame of every hit group (from the frame boxes). */
const starts = GROUPS.map(group => move.frames.findIndex(frame => frame.hitboxes.some(box => box.hitGroup === group)));
/** Landed group ids of one combo at `distance`, defender standing or crouching. */
function landed(distance: number, crouch: boolean, facing: 1 | -1 = 1, shiftAfterJab = 0): string[] {
  const game = setup(facing, distance), [a, b] = game.fighters;
  const defender = { ...neutralInput(), down: crouch };
  for (let i = 0; i < 3; i++) step(game, [neutralInput(), defender]);
  playMotion(game, facing, QCF, 1, defender);
  let shifted = false;
  for (let f = 0; f < RUN; f++) {
    step(game, [neutralInput(), defender]);
    if (!shifted && a.hitTargets[0]?.startsWith('jab')) { b.x += facing * shiftAfterJab * U; shifted = true; }
  }
  return a.hitTargets.map(t => t.split(':')[0]);
}

describe('revenge combo: data', () => {
  it('is a 23+LP motion that needs and spends the Revenge bar, no chord', () => {
    expect(move.command).toMatchObject({ type: 'motion', motionId: '23+P', buttons: ['LP'], resource: 'revenge' });
    expect(move.button).toBe('LP');
    expect(move.standingHitstun).toBe(true);
    expect(CHORD_UPGRADES.some(chord => chord.target === id)).toBe(false);
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
  it('starts with a full bar for every input variant, in both facings, on the same path', () => {
    for (const facing of [1, -1] as const) {
      let path: number | null = null;
      for (const [directions, lp] of VARIANTS) {
        const game = setup(facing), a = game.fighters[0], label = `${facing} ${directions.join('')}@${lp}`;
        playMotion(game, facing, directions, lp);
        expect(a.moveId, label).toBe(id);
        expect(a.attackId).toBe(1);
        expect(a.resources.revenge.current).toBe(0);
        // Same world path relative to where the combo started.
        const from = a.x;
        for (let f = 0; f < 30; f++) step(game, [neutralInput(), neutralInput()]);
        path ??= a.x - from;
        expect(a.x - from, label).toBe(path);
      }
    }
  });
  it('spends the bar at the start, also on a whiff', () => {
    const game = setup(1, 300);
    playMotion(game, 1);
    expect(game.fighters[0].moveId).toBe(id);
    expect(game.fighters[0].resources.revenge.current).toBe(0);
    for (let f = 0; f < 100; f++) step(game, [neutralInput(), neutralInput()]);
    expect(game.fighters[1].hp).toBe(rules.maxHealth);
    expect(game.fighters[0].resources.revenge.current).toBe(0);
  });
  it('behaves exactly as before without a full bar: LP stays the crouching jab', () => {
    for (const facing of [1, -1] as const) for (const [directions, lp] of VARIANTS) for (const revenge of [99, 50]) {
      const game = setup(facing, 250, revenge), baseline = setup(facing, 250, 0);
      playMotion(game, facing, directions, lp); playMotion(baseline, facing, directions, lp);
      expect(game.fighters[0].moveId).toBe(directions[lp] === 5 ? 'standing_lp' : 'crouching_lp');
      for (let f = 0; f < 40; f++) { step(game, [neutralInput(), neutralInput()]); step(baseline, [neutralInput(), neutralInput()]); }
      expect(game.fighters[0].resources.revenge.current).toBe(revenge);
      const strip = (g: GameState) => g.fighters.map(({ resources: _, ...rest }) => rest);
      expect(strip(game), directions.join('')).toEqual(strip(baseline));
    }
  });
  it('needs down first, then down-forward held, and LP', () => {
    for (const facing of [1, -1] as const) {
      // Down-forward without down first, forward first, the old quarter circle (ends standing), letting go too long before LP, plain LP, other punches or kicks: never the Revenge combo, bar kept (LK and RLK start the F and V variants, see their own tests).
      const misses: [number[], number, number][] = [
        [[5], 0, LP], [[6], 0, LP], [[4], 0, LP], [[2], 0, LP], [[3], 0, LP], [[3, 3, 3], 2, LP], [[6, 3], 1, LP], [[2, 6], 1, LP], [[2, 3, 6], 2, LP], [[2, 1, 4], 2, LP],
        [[2, 3], 1, buttonBit('MP')], [[2, 3], 1, buttonBit('MK')], [[2, 3], 1, buttonBit('HK')], [[2, 3, 5, 5, 5, 5, 5], 6, LP],
      ];
      for (const [directions, at, button] of misses) {
        const game = setup(facing);
        directions.forEach((direction, frame) => step(game, [pad(facing, direction, frame >= at ? button : 0), neutralInput()]));
        expect(game.fighters[0].moveId, `${facing} ${directions.join('')}@${at}`).not.toBe(id);
        expect(game.fighters[0].resources.revenge.current).toBe(100);
      }
    }
    // In the air.
    const game = setup(1);
    step(game, [{ ...neutralInput(), up: true, right: true }, neutralInput()]);
    for (let i = 0; i < 6; i++) step(game, [neutralInput(), neutralInput()]);
    expect(game.fighters[0].y).toBeLessThan(0);
    playMotion(game, 1);
    expect(game.fighters[0].moveId).not.toBe(id);
    expect(game.fighters[0].resources.revenge.current).toBe(100);
  });
  it('displaces no single attack and no chord, even with a full bar', () => {
    for (const facing of [1, -1] as const) {
      for (const [button, want] of [['LP', 'standing_lp'], ['LK', 'standing_lk'], ['LMK', 'standing_lmk'], ['HK', 'spin_hk']] as const) {
        const game = setup(facing);
        step(game, [pad(facing, 6, buttonBit(button)), neutralInput()]);
        expect(game.fighters[0].moveId).toBe(want);
        expect(game.fighters[0].resources.revenge.current).toBe(100);
      }
      // The old Revenge chord (forward LK+LMK+HK) no longer spends the bar.
      const old = setup(facing);
      step(old, [pad(facing, 6, OLD_CHORD), neutralInput()]);
      expect(old.fighters[0].moveId).not.toBe(id);
      expect(old.fighters[0].resources.revenge.current).toBe(100);
      // Other full-bar chords need their own bar (special_spin: tests/unit/special-spin.test.ts).
      for (const chord of CHORD_UPGRADES.filter(c => !MOVES[c.target].command.resource)) {
        const buttons = Object.values(chord.sources);
        for (let gap = 0; gap <= CHORD_WINDOW_FRAMES; gap++) {
          const game = setup(facing);
          for (let i = 0; i < gap; i++) step(game, [pad(facing, chord.direction, buttonBit(buttons[0])), neutralInput()]);
          step(game, [pad(facing, chord.direction, buttons.reduce((bits, b) => bits | buttonBit(b), 0)), neutralInput()]);
          expect(game.fighters[0].moveId, `${chord.target} ${gap}`).toBe(chord.target);
          expect(game.fighters[0].resources.revenge.current).toBe(100);
        }
      }
    }
  });
});

/** Documented start distances (centre to centre, px): bodies touching up to the opener's reach. */
const RANGE = { standing: [38, 90], crouching: [38, 83] } as const;
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
    playMotion(game, 1, QCF, 1, crouch);
    let knocked = false;
    for (let f = 0; f < RUN; f++) {
      step(game, [neutralInput(), crouch]);
      if (a.hitTargets.length >= 1 && b.state === 'Hitstun') expect(b.crouching).toBe(false);
      knocked ||= b.state === 'Knockdown';
    }
    expect(b.hp).toBe(rules.maxHealth - 500);
    expect(knocked).toBe(true);
  });
  it('breaks a blocked opener: both freeze, then the opener lands and every hit of the combo connects', () => {
    const game = setup(1, 60), [a, b] = game.fighters, block = { ...neutralInput(), left: false, right: true };
    step(game, [neutralInput(), block]);
    playMotion(game, 1, QCF, 1, block);
    let freeze = 0, aFrame = -1;
    for (let f = 0; f < RUN + GUARD_BREAK_FREEZE_FRAMES; f++) {
      step(game, [neutralInput(), block]);
      if (game.guardBreak) {
        freeze++;
        // Frozen: the defender holds the block, the attacker does not advance, nothing has landed yet.
        expect(b.state).toBe('Blockstun');
        expect(a.hitTargets).toEqual([]);
        if (aFrame >= 0) expect(a.moveFrame).toBe(aFrame);
        aFrame = a.moveFrame;
      }
    }
    expect(freeze).toBe(GUARD_BREAK_FREEZE_FRAMES);
    expect(a.hitTargets.map(t => t.split(':')[0])).toEqual(GROUPS);
    expect(b.hp).toBe(rules.maxHealth - move.hitGroups.reduce((sum, g) => sum + (g.damage ?? move.damage), 0));
  });
  it('locks the defender after the first hit: holding back or up never escapes the combo', () => {
    for (const escape of [{ right: true }, { up: true }, { up: true, right: true }]) {
      const game = setup(1, 60), [a, b] = game.fighters, input = { ...neutralInput(), ...escape };
      playMotion(game, 1, QCF, 1);
      while (!a.hitTargets.length) step(game, [neutralInput(), neutralInput()]);
      for (let f = 0; f < RUN; f++) {
        step(game, [neutralInput(), input]);
        if (a.state === 'Attack' && a.moveFrame < starts[starts.length - 1]) expect(['Hitstun', 'Knockdown'], JSON.stringify(escape)).toContain(b.state);
      }
      expect(a.hitTargets.map(t => t.split(':')[0]), JSON.stringify(escape)).toEqual(GROUPS);
      expect(b.lockedBy).toBeUndefined();
    }
  });
  it('works in training (bar handled as in versus, no damage) and replays deterministically', () => {
    const game = setup(1, 60);
    game.training = { enabled: true, dummy: 'stand' };
    const replay = createReplay(game);
    for (const direction of QCF) replay.frames.push({ inputs: [pad(1, direction, direction === 3 ? LP : 0), neutralInput()], events: [] });
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
    for (const direction of QCF) stepSurvival(s, pad(facing, direction, direction === 3 ? LP : 0));
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
    // Motion with LP held a few frames: the start is reported once.
    const game = setup(1);
    let previous = snapshot(game), reported = 0;
    for (const [direction, buttons] of [[2, 0], [3, 0], [3, LP], [3, LP], [5, 0], [5, 0]]) {
      step(game, [pad(1, direction, buttons), neutralInput()]);
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
