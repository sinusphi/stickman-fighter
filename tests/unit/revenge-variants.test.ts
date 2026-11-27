import { describe, expect, it } from 'vitest';
import rules from '../../src/data/rules.json';
import { MOVES } from '../../src/data/schema';
import { buttonBit, neutralInput, type Button, type RawInput } from '../../src/input/types';
import { CHORD_UPGRADES, hitStrength } from '../../src/simulation/combat';
import { requiresCrouchGuard } from '../../src/simulation/guard';
import { createGame, snapshot, step } from '../../src/simulation/state';
import type { GameState } from '../../src/simulation/types';
import { CpuPlayer } from '../../src/ai';
import { KNOWLEDGE } from '../../src/ai/knowledge';
import { advanceOffset, samplePose } from '../../src/render/skeleton';
import { classifyHit, describeStrike, newResourceStarts, swingCues } from '../../src/platform/hit-sound';
import { SURVIVAL } from '../../src/survival/config';
import { bossSpec } from '../../src/survival/spawner';
import { createSurvival, spawnEnemy, stepSurvival, type SurvivalState } from '../../src/survival/state';
import { createReplay, playReplay } from '../../src/debug/replay';
import { GUARD_BREAK_FREEZE_FRAMES } from '../../src/simulation/guard-break';

/**
 * The two Revenge variants on the same input (23: hold down, add forward, keep both) as `revenge_combo` (+LP):
 *  - F (+LK):  `revenge_combo_f`, the kick ladder: seven kicks, opens LOW, push-kick finisher,
 *  - V (+RLK): `revenge_combo_v`, the salvo: hook opener (MID), low-kick mix-up, uppercut finisher.
 * The classic combo is covered by revenge-combo.test.ts.
 */
interface Variant {
  id: string; button: Button; single: string; groups: string[]; levels: string[]; kinds: string[]; damage: number; duration: number;
  /** Start distances (centre to centre, px) within which every hit lands: bodies touching up to the opener's reach. */
  range: { standing: readonly [number, number]; crouching: readonly [number, number] };
  starts: number[];
}
const VARIANTS: Variant[] = [
  { id: 'revenge_combo_f', button: 'LK', single: 'standing_lk', duration: 105, damage: 490,
    groups: ['lowRight', 'lowLeft', 'midRight', 'midLeft', 'highRight', 'highLeft', 'thrust'],
    levels: ['LOW', 'LOW', 'MID', 'MID', 'HIGH', 'HIGH', 'MID'], kinds: Array(7).fill('kick'),
    range: { standing: [38, 93], crouching: [38, 99] }, starts: [10, 22, 34, 46, 58, 70, 86] },
  { id: 'revenge_combo_v', button: 'RLK', single: 'standing_rlk', duration: 82, damage: 475,
    groups: ['hookA', 'jab', 'hookB', 'low', 'middle', 'high', 'upper'],
    levels: ['MID', 'HIGH', 'MID', 'LOW', 'MID', 'HIGH', 'HIGH'], kinds: ['punch', 'punch', 'punch', 'kick', 'kick', 'kick', 'punch'],
    range: { standing: [38, 75], crouching: [38, 79] }, starts: [8, 16, 25, 34, 47, 56, 69] },
];
const U = rules.unit, RUN = 260;
const QCF = [2, 3];
/** Numpad direction (relative to `facing`) plus buttons as raw input. */
const pad = (facing: 1 | -1, direction: number, buttons = 0): RawInput => {
  const x = (direction - 1) % 3 - 1;
  return { ...neutralInput(), down: direction <= 3, up: direction >= 7, right: x * facing > 0, left: x * facing < 0, buttons };
};
/** Input variants of 23: held parts (also long), button after down-forward, down-forward let go just before the button, a short neutral in between. */
const INPUTS: [number[], number][] = [
  [[2, 3], 1], [[2, 3, 3], 2], [[2, 2, 2, 3, 3], 4], [[2, 3, 3, 3, 3, 3], 5], [[...Array(40).fill(2), ...Array(60).fill(3)], 99], [[2, 3, 5], 2], [[2, 5, 3], 2],
];
function setup(facing: 1 | -1 = 1, distance = 250, revenge = 100): GameState {
  const game = createGame(), [a, b] = game.fighters;
  a.x = 480 * U; b.x = a.x + facing * distance * U;
  a.facing = a.attackFacing = facing; b.facing = b.attackFacing = -facing as 1 | -1;
  a.resources.revenge.current = revenge;
  return game;
}
function playMotion(game: GameState, facing: 1 | -1, button: Button, directions: number[] = QCF, at = directions.length - 1, defender = neutralInput()): void {
  directions.forEach((direction, frame) => step(game, [pad(facing, direction, frame >= at ? buttonBit(button) : 0), defender]));
}
/** Landed group ids of one combo at `distance`, defender standing or crouching. */
function landed(v: Variant, distance: number, crouch: boolean, facing: 1 | -1 = 1, shiftAfterOpener = 0): string[] {
  const game = setup(facing, distance), [a, b] = game.fighters, defender = { ...neutralInput(), down: crouch };
  for (let i = 0; i < 3; i++) step(game, [neutralInput(), defender]);
  playMotion(game, facing, v.button, QCF, 1, defender);
  let shifted = false;
  for (let f = 0; f < RUN; f++) {
    step(game, [neutralInput(), defender]);
    if (!shifted && a.hitTargets[0]?.startsWith(v.groups[0])) { b.x += facing * shiftAfterOpener * U; shifted = true; }
  }
  return a.hitTargets.map(t => t.split(':')[0]);
}

describe('revenge variants: the three combos are told apart by button and by character', () => {
  it('start with LP, LK and RLK on the same input, each one only on its own button', () => {
    for (const facing of [1, -1] as const) for (const [button, id] of [['LP', 'revenge_combo'], ['LK', 'revenge_combo_f'], ['RLK', 'revenge_combo_v']] as const) {
      const game = setup(facing);
      playMotion(game, facing, button);
      expect(game.fighters[0].moveId, `${facing} ${button}`).toBe(id);
      expect(game.fighters[0].resources.revenge.current).toBe(0);
    }
  });
  it('open on three different guards and end in three different finishers', () => {
    const opener = (id: string) => (MOVES[id].hitGroups[0].hitLevel ?? MOVES[id].hitLevel);
    expect(['revenge_combo', 'revenge_combo_f', 'revenge_combo_v'].map(opener)).toEqual(['HIGH', 'LOW', 'MID']);
    expect(new Set(['revenge_combo', 'revenge_combo_f', 'revenge_combo_v'].map(id => MOVES[id].duration)).size).toBe(3);
    expect(MOVES.revenge_combo_f.hitGroups.at(-1)!.id).toBe('thrust');
    expect(MOVES.revenge_combo_v.hitGroups.at(-1)!.id).toBe('upper');
    expect(MOVES.revenge_combo.hitGroups.at(-1)!.id).toBe('punch');
  });
  it('sound the uppercut for the finisher of V only', () => {
    expect(describeStrike('revenge_combo_v', 'upper').style).toBe('uppercut');
    expect(describeStrike('revenge_combo_v', 'jab').style).toBe('normal');
    expect(describeStrike('revenge_combo_f', 'thrust').style).toBe('normal');
  });
});

describe.each(VARIANTS)('$id: data', v => {
  const move = MOVES[v.id];
  it('is a 23 + K motion on its own button that needs and spends the Revenge bar, no chord', () => {
    expect(move.command).toMatchObject({ type: 'motion', motionId: '23+K', buttons: [v.button], resource: 'revenge' });
    expect(move.button).toBe(v.button);
    expect(move.standingHitstun).toBe(true);
    expect(CHORD_UPGRADES.some(chord => chord.target === v.id)).toBe(false);
  });
  it('has seven hits in order, the documented length and total damage', () => {
    expect(move.hitGroups.map(g => g.id)).toEqual(v.groups);
    expect(move.duration).toBe(v.duration);
    expect(move.hitGroups.reduce((sum, g) => sum + (g.damage ?? move.damage), 0)).toBe(v.damage);
    const starts = v.groups.map(group => move.frames.findIndex(frame => frame.hitboxes.some(box => box.hitGroup === group)));
    expect(starts).toEqual(v.starts);
  });
  it('chains every hit into the next one: next active start ≤ hitstun − 2, only the finisher pushes', () => {
    for (let i = 0; i + 1 < v.groups.length; i++) {
      const group = move.hitGroups[i], hitstun = group.hitstun ?? move.hitstun;
      expect(v.starts[i + 1] - v.starts[i], `${group.id} → ${v.groups[i + 1]}`).toBeLessThanOrEqual(hitstun - 2);
      expect(group.pushbackHit ?? move.pushbackHit, group.id).toBe(0);
    }
    expect(move.hitGroups.at(-1)!.pushbackHit).toBeGreaterThan(0);
  });
  it('knocks down only with the finisher, against every stability in versus and survival', () => {
    const stabilities = [rules.hitStrength.defaultStability, ...Object.values(SURVIVAL.types).map(t => t.stability), bossSpec(SURVIVAL, 9).stability];
    for (const group of move.hitGroups.slice(0, -1)) expect(hitStrength(move, group), group.id).toBeLessThan(Math.min(...stabilities));
    expect(hitStrength(move, move.hitGroups.at(-1)!)).toBeGreaterThanOrEqual(Math.max(...stabilities));
  });
  it('uses its hit levels (guard rules)', () => {
    const levels = move.hitGroups.map(g => g.hitLevel ?? move.hitLevel);
    expect(levels).toEqual(v.levels);
    expect(levels.map(level => requiresCrouchGuard(level))).toEqual(v.levels.map(level => level !== 'HIGH'));
  });
});

describe.each(VARIANTS)('$id: input', v => {
  it('starts with a full bar for every input variant, in both facings, on the same path', () => {
    for (const facing of [1, -1] as const) {
      let path: number | null = null;
      for (const [directions, at] of INPUTS) {
        const game = setup(facing), a = game.fighters[0], label = `${facing} ${directions.join('')}@${at}`;
        playMotion(game, facing, v.button, directions, at);
        expect(a.moveId, label).toBe(v.id);
        expect(a.attackId).toBe(1);
        expect(a.resources.revenge.current).toBe(0);
        const from = a.x;
        for (let f = 0; f < 30; f++) step(game, [neutralInput(), neutralInput()]);
        path ??= a.x - from;
        expect(a.x - from, label).toBe(path);
      }
    }
  });
  it('spends the bar at the start, also on a whiff', () => {
    const game = setup(1, 300);
    playMotion(game, 1, v.button);
    expect(game.fighters[0].moveId).toBe(v.id);
    expect(game.fighters[0].resources.revenge.current).toBe(0);
    for (let f = 0; f < 140; f++) step(game, [neutralInput(), neutralInput()]);
    expect(game.fighters[1].hp).toBe(rules.maxHealth);
    expect(game.fighters[0].resources.revenge.current).toBe(0);
  });
  it('behaves exactly as before without a full bar: the button stays its single attack', () => {
    for (const facing of [1, -1] as const) for (const [directions, at] of INPUTS) for (const revenge of [99, 50]) {
      const game = setup(facing, 250, revenge), baseline = setup(facing, 250, 0);
      playMotion(game, facing, v.button, directions, at); playMotion(baseline, facing, v.button, directions, at);
      expect(game.fighters[0].moveId).toBe(directions[at] === 5 ? v.single : v.single.replace('standing_', 'crouching_'));
      for (let f = 0; f < 40; f++) { step(game, [neutralInput(), neutralInput()]); step(baseline, [neutralInput(), neutralInput()]); }
      expect(game.fighters[0].resources.revenge.current).toBe(revenge);
      const strip = (g: GameState) => g.fighters.map(({ resources: _, ...rest }) => rest);
      expect(strip(game), directions.join('')).toEqual(strip(baseline));
    }
  });
  it('needs down first, then down-forward held, and its own button', () => {
    for (const facing of [1, -1] as const) {
      const button = buttonBit(v.button);
      const misses: [number[], number, number][] = [
        [[5], 0, button], [[6], 0, button], [[4], 0, button], [[2], 0, button], [[3], 0, button], [[3, 3, 3], 2, button], [[6, 3], 1, button], [[2, 6], 1, button], [[2, 3, 6], 2, button], [[2, 1, 4], 2, button],
        [[2, 3, 5, 5, 5, 5, 5], 6, button],
        [[2, 3], 1, buttonBit('MK')], [[2, 3], 1, buttonBit('HK')], [[2, 3], 1, buttonBit('LMK')], [[2, 3], 1, buttonBit('RHK')],
      ];
      for (const [directions, at, pressed] of misses) {
        const game = setup(facing);
        directions.forEach((direction, frame) => step(game, [pad(facing, direction, frame >= at ? pressed : 0), neutralInput()]));
        expect(game.fighters[0].moveId, `${facing} ${directions.join('')}@${at}`).not.toBe(v.id);
        expect(game.fighters[0].resources.revenge.current).toBe(100);
      }
    }
    // In the air.
    const game = setup(1);
    step(game, [{ ...neutralInput(), up: true, right: true }, neutralInput()]);
    for (let i = 0; i < 6; i++) step(game, [neutralInput(), neutralInput()]);
    expect(game.fighters[0].y).toBeLessThan(0);
    playMotion(game, 1, v.button);
    expect(game.fighters[0].moveId).not.toBe(v.id);
    expect(game.fighters[0].resources.revenge.current).toBe(100);
  });
  it('displaces no single attack and no chord that uses the same button, even with a full bar', () => {
    for (const facing of [1, -1] as const) {
      const game = setup(facing);
      step(game, [pad(facing, 6, buttonBit(v.button)), neutralInput()]);
      expect(game.fighters[0].moveId).toBe(v.single);
      expect(game.fighters[0].resources.revenge.current).toBe(100);
      for (const chord of CHORD_UPGRADES.filter(c => !MOVES[c.target].command.resource && Object.values(c.sources).includes(v.button))) {
        const buttons = Object.values(chord.sources), other = setup(facing);
        step(other, [pad(facing, chord.direction, buttonBit(buttons[0])), neutralInput()]);
        step(other, [pad(facing, chord.direction, buttons.reduce((bits, b) => bits | buttonBit(b), 0)), neutralInput()]);
        expect(other.fighters[0].moveId, chord.target).toBe(chord.target);
        expect(other.fighters[0].resources.revenge.current).toBe(100);
      }
    }
  });
});

describe.each(VARIANTS)('$id: hits', v => {
  const move = MOVES[v.id];
  it('lands all seven hits once the opener lands, standing or crouching, in both facings', () => {
    for (const facing of [1, -1] as const) for (const crouch of [false, true]) {
      const [min, max] = v.range[crouch ? 'crouching' : 'standing'];
      for (let d = min; d <= max; d++) expect(landed(v, d, crouch, facing), `${facing} ${crouch} ${d}`).toEqual(v.groups);
      // Beyond the documented maximum the opener whiffs: never a broken chain after a landed opener.
      for (let d = max + 1; d <= max + 15; d++) {
        const hits = landed(v, d, crouch, facing);
        if (hits[0] === v.groups[0]) expect(hits, `${facing} ${crouch} ${d}`).toEqual(v.groups);
      }
    }
  });
  it('keeps a reach reserve: the follow-ups still land with the opponent shifted 2 px further after the opener', () => {
    for (const facing of [1, -1] as const) for (const crouch of [false, true]) {
      const [, max] = v.range[crouch ? 'crouching' : 'standing'];
      for (let d = max - 4; d <= max; d++) expect(landed(v, d, crouch, facing, 2), `${facing} ${crouch} ${d}`).toEqual(v.groups);
    }
  });
  it('deals the full damage, stands a crouching opponent up and knocks down with the finisher', () => {
    const game = setup(1, 60), [a, b] = game.fighters, crouch = { ...neutralInput(), down: true };
    step(game, [neutralInput(), crouch]);
    playMotion(game, 1, v.button, QCF, 1, crouch);
    let knocked = false;
    for (let f = 0; f < RUN; f++) {
      step(game, [neutralInput(), crouch]);
      if (a.hitTargets.length >= 1 && b.state === 'Hitstun') expect(b.crouching).toBe(false);
      knocked ||= b.state === 'Knockdown';
    }
    expect(b.hp).toBe(rules.maxHealth - v.damage);
    expect(knocked).toBe(true);
  });
  it('breaks the guard its opener asks for and hits through the wrong one: the full combo always lands', () => {
    for (const right of [true, false]) {
      const level = v.levels[0] as 'LOW' | 'MID' | 'HIGH';
      for (const down of [requiresCrouchGuard(level), !requiresCrouchGuard(level)]) {
        const game = setup(1, 60), guard = { ...neutralInput(), right, down };
        step(game, [neutralInput(), guard]);
        playMotion(game, 1, v.button, QCF, 1, guard);
        for (let f = 0; f < RUN + GUARD_BREAK_FREEZE_FRAMES; f++) step(game, [neutralInput(), guard]);
        // Walking back before any contact may leave the opener short; from the first hit on, every hit lands.
        const hits = game.fighters[0].hitTargets.map(t => t.split(':')[0]);
        expect(hits.length, `${right} ${down}`).toBeGreaterThanOrEqual(v.groups.length - 1);
        expect(hits, `${right} ${down}`).toEqual(v.groups.slice(v.groups.indexOf(hits[0])));
        if (!right) expect(game.fighters[1].hp).toBe(rules.maxHealth - v.damage);
      }
    }
  });
  it('works in training (bar handled as in versus, no damage) and replays deterministically', () => {
    const game = setup(1, 60);
    game.training = { enabled: true, dummy: 'stand' };
    const replay = createReplay(game);
    for (const direction of QCF) replay.frames.push({ inputs: [pad(1, direction, direction === 3 ? buttonBit(v.button) : 0), neutralInput()], events: [] });
    for (let f = 0; f < RUN; f++) replay.frames.push({ inputs: [neutralInput(), neutralInput()], events: [] });
    let started = false;
    const end = playReplay(replay, state => { started ||= state.fighters[0].moveId === v.id; });
    expect(started).toBe(true);
    expect(end.fighters[0].resources.revenge.current).toBe(0);
    expect(end.fighters[0].hitTargets.map(t => t.split(':')[0])).toEqual(v.groups);
    expect(end.fighters[1].hp).toBe(rules.maxHealth);
    expect(playReplay(replay)).toEqual(end);
  });
  it('has frame data that matches its hit boxes', () => {
    expect(move.startup).toBe(v.starts[0]);
    expect(move.startup + move.active + move.recovery).toBe(move.duration);
  });
});

describe.each(VARIANTS)('$id: survival', v => {
  const quiet = (): SurvivalState => { const s = createSurvival(3); s.spawnTimer = 1e9; s.flow.bossTimer = 1e9; s.flow.waveTimer = 1e9; return s; };
  function survivalRun(kind: Parameters<typeof spawnEnemy>[2], distance: number, facing: 1 | -1 = 1) {
    const s = quiet();
    s.player.facing = s.player.attackFacing = facing;
    const e = spawnEnemy(s, facing, kind);
    e.entering = false; e.fighter.x = s.player.x + facing * distance * U; e.fighter.facing = -facing as 1 | -1;
    s.player.resources.revenge.current = 100;
    for (const direction of QCF) stepSurvival(s, pad(facing, direction, direction === 3 ? buttonBit(v.button) : 0));
    expect(s.player.moveId).toBe(v.id);
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
      for (const d of [v.range.standing[0], 60, v.range.standing[1]]) {
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
      const move = MOVES[v.id];
      const needed = move.hitGroups.findIndex((_, i) => move.hitGroups.slice(0, i + 1).reduce((n, g) => n + (g.damage ?? 0), 0) >= SURVIVAL.types[kind].hp) + 1 || 7;
      expect(hits, kind).toBe(needed);
      if (needed < 7) expect(e.dead).toBe(true);
    }
  });
});

describe.each(VARIANTS)('$id: CPU, presentation, animation', v => {
  it('is not part of the CPU repertoire and a CPU with a full bar never starts it', () => {
    expect(KNOWLEDGE.some(m => m.id === v.id)).toBe(false);
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const game = createGame(), cpu = new CpuPlayer(difficulty, 1);
      game.fighters[0].x = 420 * U; game.fighters[1].x = 500 * U;
      for (let f = 0; f < 1500 && game.round.phase !== 'matchOver'; f++) {
        game.fighters[1].resources.revenge.current = 100;
        step(game, [neutralInput(), cpu.next(game)]);
        expect(game.fighters[1].moveId).not.toBe(v.id);
      }
    }
  });
  it('sounds like its punches and kicks, one whoosh per strike, and reports its start once', () => {
    expect(v.groups.map(g => classifyHit(v.id, g).kind)).toEqual(v.kinds);
    expect(swingCues(v.id)).toHaveLength(7);
    const game = setup(1), bit = buttonBit(v.button);
    let previous = snapshot(game), reported = 0;
    for (const [direction, buttons] of [[2, 0], [3, 0], [3, bit], [3, bit], [5, 0], [5, 0]]) {
      step(game, [pad(1, direction, buttons), neutralInput()]);
      reported += newResourceStarts(game, previous).length; previous = snapshot(game);
    }
    expect(game.fighters[0].moveId).toBe(v.id);
    expect(reported).toBe(1);
  });
  it('never slides a planted foot and keeps one foot on the floor throughout', () => {
    for (const facing of [1, -1]) for (const [stepSize, tolerance] of [[1, .02], [.25, .3]]) {
      for (let f = 0; f < MOVES[v.id].duration - 1; f += stepSize) {
        const a = samplePose(v.id, f, facing), b = samplePose(v.id, f + stepSize, facing);
        const da = advanceOffset(v.id, f), db = advanceOffset(v.id, f + stepSize);
        expect(Math.min(Math.abs(a.leftFoot[1]), Math.abs(a.rightFoot[1])), `frame ${f}`).toBeLessThan(.05);
        for (const foot of ['leftFoot', 'rightFoot'] as const)
          if (Math.abs(a[foot][1]) < .01 && Math.abs(b[foot][1]) < .01)
            expect(Math.abs(b[foot][0] + facing * db - a[foot][0] - facing * da), `${foot} frame ${f}`).toBeLessThan(tolerance);
      }
    }
  });
});
