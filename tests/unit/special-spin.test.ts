import { describe, expect, it } from 'vitest';
import rules from '../../src/data/rules.json';
import { MOVES } from '../../src/data/schema';
import { buttonBit, neutralInput, type Button, type RawInput } from '../../src/input/types';
import { CHORD_UPGRADES, CHORD_WINDOW_FRAMES, hitStrength, knocksDown } from '../../src/simulation/combat';
import { requiresCrouchGuard } from '../../src/simulation/guard';
import { createGame, snapshot, step } from '../../src/simulation/state';
import type { Fighter, GameState } from '../../src/simulation/types';
import { CpuPlayer } from '../../src/ai';
import { KNOWLEDGE } from '../../src/ai/knowledge';
import { samplePose } from '../../src/render/skeleton';
import poses from '../../src/data/poses.json';
import { classifyHit, newResourceStarts, swingCues } from '../../src/platform/hit-sound';
import { comboMoves } from '../../src/platform/combos';
import { SURVIVAL } from '../../src/survival/config';
import { bossSpec } from '../../src/survival/spawner';
import { createSurvival, spawnEnemy, stepSurvival, type SurvivalState } from '../../src/survival/state';
import { createReplay, playReplay } from '../../src/debug/replay';

const id = 'special_spin', move = MOVES[id], U = rules.unit;
const KEYS: Button[] = ['LP', 'LK', 'MK'];
const ALL = KEYS.reduce((bits, b) => bits | buttonBit(b), 0);
const RUN = 90;
/** Documented reach (centre to centre, px): from bodies touching to the farthest landing hit. */
const RANGE = { front: { standing: 89, crouching: 81 }, back: { standing: 85, crouching: 78 } } as const;
const MIN = 32;
const press = (facing: 1 | -1, buttons: number, direction: 4 | 5 | 6 = 4, down = false): RawInput =>
  ({ ...neutralInput(), right: direction === 6 ? facing === 1 : direction === 4 ? facing === -1 : false, left: direction === 6 ? facing === -1 : direction === 4 ? facing === 1 : false, down, buttons });
function setup(facing: 1 | -1 = 1, distance = 300, special = 100): GameState {
  const game = createGame(), [a, b] = game.fighters;
  a.x = 480 * U; b.x = a.x + facing * distance * U;
  a.facing = a.attackFacing = facing; b.facing = b.attackFacing = -facing as 1 | -1;
  a.resources.special.current = special;
  return game;
}
const groups = (f: Fighter) => f.hitTargets.map(t => t.split(':')[0]);
/**
 * Starts the Wirbel with the opponent out of reach, then places it `distance`
 * px in front of or behind the attacker (a versus opponent only gets behind by
 * crossing; the attacker keeps its facing during the attack).
 */
function wirbel(side: 'front' | 'back', distance: number, defender: RawInput = neutralInput(), facing: 1 | -1 = 1): GameState {
  const game = setup(facing), [a, b] = game.fighters;
  step(game, [press(facing, ALL), defender]);
  expect(a.moveId).toBe(id);
  b.x = a.x + (side === 'front' ? facing : -facing) * distance * U;
  for (let f = 0; f < RUN; f++) step(game, [neutralInput(), defender]);
  return game;
}
/** First active frame of a hit group. */
const start = (group: string) => move.frames.findIndex(frame => frame.hitboxes.some(box => box.hitGroup === group));

describe('Wirbel: data', () => {
  it('is a back LP+LK+MK hold chord that needs and spends the Special bar', () => {
    expect(move.command).toMatchObject({ type: 'hold', directions: [4], buttons: KEYS, resource: 'special' });
    expect(move.button).toBe('MK');
    expect(CHORD_UPGRADES.filter(chord => chord.target === id)).toHaveLength(1);
    expect(comboMoves.some(m => m.id === id)).toBe(true);
  });
  it('uses only buttons that the default gamepad layout binds', async () => {
    const controls = (await import('../../src/data/default-controls.json')).default;
    for (const player of controls.players) for (const button of KEYS) expect(player.padButtons[button], button).toBeGreaterThanOrEqual(0);
  });
  it('clashes with no other back chord: no two of its keys form one', () => {
    const others = CHORD_UPGRADES.filter(chord => chord.target !== id && chord.direction === 4).map(chord => Object.values(chord.sources));
    for (const buttons of others) expect(buttons.filter(b => KEYS.includes(b)).length, buttons.join('+')).toBeLessThan(2);
  });
  it('starts quickly with one hit behind, then one in front, no invulnerability', () => {
    expect(move.hitGroups.map(g => g.id)).toEqual(['back', 'front']);
    expect(move.startup).toBeGreaterThanOrEqual(8);
    expect(move.startup).toBeLessThanOrEqual(10);
    expect(start('back')).toBe(move.startup);
    expect(start('front')).toBeGreaterThan(start('back'));
    for (const group of move.hitGroups) expect(group.maxHitsPerTarget).toBe(1);
    move.frames.forEach((frame, f) => {
      expect(frame.hurtboxes.length, `frame ${f}`).toBeGreaterThan(0);
      for (const box of frame.hitboxes) {
        // Back group strictly behind the body, front group strictly in front.
        if (box.hitGroup === 'back') expect(box.x + box.width, `frame ${f}`).toBeLessThan(0);
        else expect(box.x, `frame ${f}`).toBeGreaterThan(0);
      }
    });
  });
  it('deals moderate damage: well below the Revenge combo and below a single spin high kick per hit', () => {
    const damage = move.hitGroups.map(g => g.damage ?? move.damage);
    expect(damage.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(120);
    for (const value of damage) expect(value).toBeLessThan(MOVES.spin_hk.damage);
  });
  it('knocks down every survival type below heavy, never heavies or bosses', () => {
    const light = Object.entries(SURVIVAL.types).filter(([, t]) => t.tier !== 'heavy').map(([, t]) => t.stability);
    const heavy = [...Object.values(SURVIVAL.types).filter(t => t.tier === 'heavy').map(t => t.stability), ...[1, 2, 5, 9].map(n => bossSpec(SURVIVAL, n).stability)];
    for (const group of move.hitGroups) {
      expect(hitStrength(move, group)).toBeGreaterThanOrEqual(Math.max(...light, rules.hitStrength.defaultStability));
      expect(hitStrength(move, group)).toBeLessThan(Math.min(...heavy));
    }
  });
  it('is MID on both sides: crouch guard only (guard rules)', () => {
    for (const group of move.hitGroups) {
      expect(group.hitLevel ?? move.hitLevel).toBe('MID');
      expect(requiresCrouchGuard(group.hitLevel ?? move.hitLevel)).toBe(true);
    }
  });
});

describe('Wirbel: input', () => {
  it('starts with a full Special bar for every key order inside the window, in both facings', () => {
    for (const facing of [1, -1] as const) {
      let path: number | undefined;
      for (let a = 0; a <= CHORD_WINDOW_FRAMES; a++) for (let b = 0; b <= CHORD_WINDOW_FRAMES; b++) for (let c = 0; c <= CHORD_WINDOW_FRAMES; c++) {
        const pattern = [a, b, c];
        if (Math.min(...pattern) !== 0) continue;
        const game = setup(facing);
        for (let frame = 0; frame <= Math.max(...pattern); frame++)
          step(game, [press(facing, KEYS.reduce((bits, key, i) => pattern[i] <= frame ? bits | buttonBit(key) : bits, 0)), neutralInput()]);
        expect(game.fighters[0].moveId, pattern.join('/')).toBe(id);
        expect(game.fighters[0].attackId).toBe(1);
        expect(game.fighters[0].resources.special.current).toBe(0);
        // Same spot whichever key came first (only the first back step of the walk).
        path ??= game.fighters[0].x;
        expect(game.fighters[0].x, pattern.join('/')).toBe(path);
      }
    }
  });
  it('empties the bar at the start, also on a whiff, and leaves the Revenge bar alone', () => {
    const game = setup(1, 300), a = game.fighters[0];
    a.resources.revenge.current = 60;
    step(game, [press(1, ALL), neutralInput()]);
    expect(a.moveId).toBe(id);
    expect(a.resources.special.current).toBe(0);
    for (let f = 0; f < RUN; f++) step(game, [neutralInput(), neutralInput()]);
    expect(game.fighters[1].hp).toBe(rules.maxHealth);
    expect(a.resources.special.current).toBe(0);
    expect(a.resources.revenge.current).toBe(60);
  });
  it('behaves exactly as before without a full bar', () => {
    for (const facing of [1, -1] as const) for (const special of [99, 40]) for (const first of KEYS) {
      const game = setup(facing, 250, special), baseline = setup(facing, 250, 0);
      for (const g of [game, baseline]) {
        step(g, [press(facing, buttonBit(first)), neutralInput()]);
        step(g, [press(facing, ALL), neutralInput()]);
        for (let f = 0; f < 60; f++) step(g, [neutralInput(), neutralInput()]);
      }
      expect(game.fighters[0].resources.special.current).toBe(special);
      const strip = (g: GameState) => g.fighters.map(({ resources: _, ...rest }) => rest);
      expect(strip(game), `${facing} ${special} ${first}`).toEqual(strip(baseline));
    }
  });
  it('needs the standing ground state and direction 4', () => {
    for (const [direction, down] of [[4, true], [5, false], [6, false]] as const) {
      const game = setup(1);
      step(game, [press(1, ALL, direction, down), neutralInput()]);
      expect(game.fighters[0].moveId, `${direction}${down ? ' down' : ''}`).not.toBe(id);
      expect(game.fighters[0].resources.special.current).toBe(100);
    }
    const game = setup(1);
    step(game, [{ ...neutralInput(), up: true, left: true }, neutralInput()]);
    for (let i = 0; i < 6; i++) step(game, [neutralInput(), neutralInput()]);
    expect(game.fighters[0].y).toBeLessThan(0);
    step(game, [press(1, ALL), neutralInput()]);
    expect(game.fighters[0].moveId).not.toBe(id);
    expect(game.fighters[0].resources.special.current).toBe(100);
  });
  it('displaces no single move and no other chord, even with full bars', () => {
    for (const facing of [1, -1] as const) {
      for (const [button, want] of [['LP', 'standing_lp'], ['LK', 'left_turn_kick'], ['MK', 'spin_mk']] as const) {
        const game = setup(facing);
        step(game, [press(facing, buttonBit(button)), neutralInput()]);
        expect(game.fighters[0].moveId).toBe(want);
        expect(game.fighters[0].resources.special.current).toBe(100);
      }
      for (const chord of CHORD_UPGRADES.filter(c => c.target !== id)) {
        const buttons = Object.values(chord.sources);
        const game = setup(facing);
        for (const resource of Object.values(game.fighters[0].resources)) resource.current = resource.max;
        step(game, [press(facing, buttons.reduce((bits, b) => bits | buttonBit(b), 0), chord.direction as 4 | 6), neutralInput()]);
        expect(game.fighters[0].moveId, chord.target).toBe(chord.target);
        expect(game.fighters[0].resources.special.current, chord.target).toBe(100);
      }
      // A late third key (outside the window) no longer upgrades.
      const game = setup(facing);
      const two = buttonBit('MK') | buttonBit('LK');
      for (let i = 0; i <= CHORD_WINDOW_FRAMES; i++) step(game, [press(facing, two), neutralInput()]);
      step(game, [press(facing, ALL), neutralInput()]);
      expect(game.fighters[0].moveId).toBe('spin_mk');
      expect(game.fighters[0].resources.special.current).toBe(100);
    }
  });
});

describe('Wirbel: reach and guard', () => {
  it('hits in front up to the documented reach, standing or crouching, in both facings', () => {
    for (const facing of [1, -1] as const) for (const stance of ['standing', 'crouching'] as const) {
      const defender = { ...neutralInput(), down: stance === 'crouching' }, max = RANGE.front[stance];
      for (const d of [MIN, 50, 70, max]) expect(groups(wirbel('front', d, defender, facing).fighters[0]), `${facing} ${stance} ${d}`).toEqual(['front']);
      expect(groups(wirbel('front', max + 1, defender, facing).fighters[0])).toEqual([]);
    }
  });
  it('hits behind up to the documented reach, standing or crouching, in both facings', () => {
    for (const facing of [1, -1] as const) for (const stance of ['standing', 'crouching'] as const) {
      const defender = { ...neutralInput(), down: stance === 'crouching' }, max = RANGE.back[stance];
      for (const d of [MIN, 50, 70, max]) expect(groups(wirbel('back', d, defender, facing).fighters[0]), `${facing} ${stance} ${d}`).toEqual(['back']);
      expect(groups(wirbel('back', max + 1, defender, facing).fighters[0])).toEqual([]);
    }
  });
  it('knocks a versus opponent down with either hit and deals the hit damage', () => {
    for (const side of ['front', 'back'] as const) {
      const game = wirbel(side, 50), b = game.fighters[1];
      const group = move.hitGroups.find(g => g.id === side)!;
      expect(b.hp).toBe(rules.maxHealth - group.damage!);
      expect(knocksDown(move, group, b)).toBe(true);
    }
    let knocked = false;
    const game = setup(1);
    step(game, [press(1, ALL), neutralInput()]);
    game.fighters[1].x = game.fighters[0].x + 50 * U;
    for (let f = 0; f < RUN; f++) { step(game, [neutralInput(), neutralInput()]); knocked ||= game.fighters[1].state === 'Knockdown'; }
    expect(knocked).toBe(true);
  });
  it('breaks the correct (crouching) guard and hits through a wrong one, on both sides', () => {
    for (const side of ['front', 'back'] as const) {
      // The defender faces the attacker, so its "back" points away from it.
      const toward = (game: GameState) => game.fighters[1].x < game.fighters[0].x ? 1 : -1;
      for (const down of [true, false]) {
        const game = setup(1), [a, b] = game.fighters;
        step(game, [press(1, ALL), neutralInput()]);
        b.x = a.x + (side === 'front' ? 1 : -1) * 50 * U;
        const guard = (): RawInput => ({ ...neutralInput(), down, left: toward(game) === 1, right: toward(game) === -1 });
        let broke = false;
        for (let f = 0; f < RUN; f++) { step(game, [neutralInput(), guard()]); broke ||= game.guardBreak !== undefined; }
        // A crouching guard is met and broken; a standing one never blocks a MID spin.
        expect(broke, `${side} ${down ? 'crouch' : 'stand'}`).toBe(down);
        expect(game.lastContact?.blocked, `${side} ${down ? 'crouch' : 'stand'}`).toBe(false);
        expect(b.hp).toBeLessThan(rules.maxHealth - 40);
      }
    }
  });
  it('works in training (bar as in versus, no damage) and replays deterministically', () => {
    const game = setup(1, 50);
    game.training = { enabled: true, dummy: 'stand' };
    const replay = createReplay(game);
    replay.frames.push({ inputs: [press(1, ALL), neutralInput()], events: [] });
    for (let f = 0; f < RUN; f++) replay.frames.push({ inputs: [neutralInput(), neutralInput()], events: [] });
    let started = false;
    const end = playReplay(replay, state => { started ||= state.fighters[0].moveId === id; });
    expect(started).toBe(true);
    expect(end.fighters[0].resources.special.current).toBeLessThan(100);
    expect(groups(end.fighters[0])).toEqual(['front']);
    expect(end.fighters[1].hp).toBe(rules.maxHealth);
    expect(playReplay(replay)).toEqual(end);
  });
});

describe('Wirbel: survival', () => {
  const quiet = (): SurvivalState => { const s = createSurvival(3); s.spawnTimer = 1e9; s.flow.bossTimer = 1e9; s.flow.waveTimer = 1e9; return s; };
  function place(s: SurvivalState, kind: Parameters<typeof spawnEnemy>[2], offset: number) {
    const side = offset < 0 ? -1 : 1, e = spawnEnemy(s, side, kind);
    e.entering = false; e.fighter.x = s.player.x + offset * U; e.fighter.facing = e.fighter.attackFacing = -side as 1 | -1;
    return e;
  }
  function spin(s: SurvivalState) {
    s.player.resources.special.current = 100;
    stepSurvival(s, press(s.player.facing, ALL));
    expect(s.player.moveId).toBe(id);
    expect(s.player.resources.special.current).toBe(0);
    const knocked = new Set<number>();
    for (let f = 0; f < RUN; f++) {
      stepSurvival(s, neutralInput());
      for (const e of s.enemies) if (e.fighter.state === 'Knockdown') knocked.add(e.uid);
    }
    return knocked;
  }
  it('frees the player from both sides at once: every type below heavy falls, in front and behind', () => {
    for (const facing of [1, -1] as const) for (const kind of Object.keys(SURVIVAL.types) as (keyof typeof SURVIVAL.types)[]) {
      const s = quiet();
      s.player.facing = s.player.attackFacing = facing;
      const front = place(s, kind, facing * 45), back = place(s, kind, -facing * 45);
      const hp = [front.fighter.hp, back.fighter.hp];
      const knocked = spin(s);
      // One hit per side.
      expect(front.fighter.hp, `${kind} front`).toBe(hp[0] - 60);
      expect(back.fighter.hp, `${kind} back`).toBe(hp[1] - 50);
      const falls = SURVIVAL.types[kind].tier !== 'heavy';
      expect(knocked.has(front.uid), `${kind} front`).toBe(falls);
      expect(knocked.has(back.uid), `${kind} back`).toBe(falls);
    }
  });
  it('breaks the guard of survival enemies too, also behind the player', () => {
    for (const down of [true, false]) {
      const s = quiet(), back = place(s, 'fighter', -45), hp = back.fighter.hp;
      s.player.resources.special.current = 100;
      stepSurvival(s, press(1, ALL));
      let broke = false;
      // The enemy left of the player faces right: left is its back direction.
      for (let f = 0; f < RUN; f++) { stepSurvival(s, neutralInput(), [{ ...neutralInput(), down, left: true }]); broke ||= back.pair.guardBreak !== undefined; }
      expect(broke, down ? 'crouch' : 'stand').toBe(down);
      expect(back.pair.lastContact?.blocked, down ? 'crouch' : 'stand').toBe(false);
      expect(back.fighter.hp).toBeLessThan(hp);
    }
  });
  it('only staggers heavy enemies and bosses: hit, but they stay on their feet', () => {
    for (const kind of ['heavy', bossSpec(SURVIVAL, 1), bossSpec(SURVIVAL, 6)] as const) {
      const s = quiet(), e = place(s, kind, 45), hp = e.fighter.hp;
      const knocked = spin(s);
      expect(e.fighter.hp).toBe(hp - 60);
      expect(knocked.has(e.uid)).toBe(false);
    }
  });
  it('needs a double tap to turn: holding back for the chord never turns the player', () => {
    const s = quiet();
    s.player.resources.special.current = 100;
    stepSurvival(s, press(1, buttonBit('LK'), 4));
    stepSurvival(s, press(1, ALL, 4));
    expect(s.player.moveId).toBe(id);
    expect(s.turn).toBeNull();
    for (let f = 0; f < RUN; f++) stepSurvival(s, neutralInput());
    expect(s.player.facing).toBe(1);
  });
});

describe('Wirbel: CPU, presentation, animation', () => {
  it('is not part of the CPU repertoire and a CPU with a full Special bar never starts it', () => {
    expect(KNOWLEDGE.some(m => m.id === id)).toBe(false);
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const game = createGame(), cpu = new CpuPlayer(difficulty, 1);
      game.fighters[0].x = 420 * U; game.fighters[1].x = 500 * U;
      for (let f = 0; f < 1500 && game.round.phase !== 'matchOver'; f++) {
        game.fighters[1].resources.special.current = 100;
        step(game, [neutralInput(), cpu.next(game)]);
        expect(game.fighters[1].moveId).not.toBe(id);
      }
    }
  });
  it('sounds like spin kicks, one whoosh per side, and reports its Special start once', () => {
    for (const group of ['back', 'front']) expect(classifyHit(id, group).kind).toBe('kick');
    expect(swingCues(id)).toHaveLength(2);
    const game = setup(1);
    let previous = snapshot(game);
    const starts: string[] = [];
    for (const buttons of [buttonBit('MK'), ALL, ALL, 0, 0]) {
      step(game, [press(1, buttons), neutralInput()]);
      starts.push(...newResourceStarts(game, previous).map(s => s.resource)); previous = snapshot(game);
    }
    expect(game.fighters[0].moveId).toBe(id);
    expect(starts).toEqual(['special']);
  });
  it('turns once completely and keeps the lead foot planted', () => {
    for (const facing of [1, -1]) {
      const first = samplePose(id, 0, facing);
      for (let f = 0; f < move.duration; f++) {
        const pose = samplePose(id, f, facing);
        expect(Math.abs(pose.leftFoot[1]), `frame ${f}`).toBeLessThan(.05);
        expect(Math.abs(pose.leftFoot[0] - first.leftFoot[0]), `frame ${f}`).toBeLessThan(.05);
      }
    }
    // One full turn (360°) over the move.
    const keys = (poses.animations as unknown as Record<string, { keyframes: { yaw?: number }[] }>)[id].keyframes;
    expect(Math.max(...keys.map(k => k.yaw ?? 0))).toBe(360);
  });
});
