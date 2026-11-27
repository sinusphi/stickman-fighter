import { describe, expect, it } from 'vitest';
import contactGeometry from '../../src/data/contact-geometry';
import { FIGURE_SCALE } from '../../src/data/figure-scale';
import rig from '../../src/data/poses.json';
import rules from '../../src/data/rules.json';
import { MOVES } from '../../src/data/schema';
import type { Capsule } from '../../src/data/contact-shapes';
import { neutralInput, type RawInput } from '../../src/input/types';
import { createGame, snapshot, step } from '../../src/simulation/state';
import type { GameState } from '../../src/simulation/types';
import { capsulesOverlap } from '../../src/simulation/pose-contact';
import {
  INTRO_FIGHT_FRAMES, INTRO_READY_FRAMES, INTRO_SALUTE_FRAMES, SALUTE_DISTANCE, SALUTE_MOVE, SALUTE_PEAK_FRAME,
  fistReach, fistTipX, saluteContact, saluteDistance,
} from '../../src/simulation/intro';
import { createReplay, parseReplay, playReplay, validateSnapshot } from '../../src/debug/replay';
import { newSwingSounds } from '../../src/platform/hit-sound';

const FULL_TIMER = rules.roundSeconds * rules.hz;
const geometry = contactGeometry as unknown as Record<string, { frames: { body: Capsule[] }[] }>;
const handIndices = rig.skeleton.bones.flatMap((b, i) => b.joint.endsWith('Hand') ? [i + 1] : []);
/** Every LP press, direction and jump the players could mash. */
const mash = (i: number): [RawInput, RawInput] => [
  { ...neutralInput(), buttons: i % 2 ? 0x3f : 0, right: i % 3 === 0, up: i % 7 === 0 },
  { ...neutralInput(), buttons: i % 2 ? 0 : 0x3f, left: i % 4 === 0, down: i % 5 === 0 },
];
function runIntro(game: GameState, inputs: (i: number) => [RawInput, RawInput] = () => [neutralInput(), neutralInput()]): GameState[] {
  const states: GameState[] = [];
  for (let i = 0; game.round.phase === 'intro'; i++) { step(game, inputs(i)); states.push(snapshot(game)); if (i > 1000) throw Error('intro does not end'); }
  return states;
}
/** World capsule like simulation/pose-contact. */
const world = (c: Capsule, x: number, facing: number): Capsule =>
  [x + facing * Math.round(c[0] * FIGURE_SCALE), Math.round(c[1] * FIGURE_SCALE), x + facing * Math.round(c[2] * FIGURE_SCALE), Math.round(c[3] * FIGURE_SCALE), Math.round(c[4] * FIGURE_SCALE)];

describe('round intro: phases', () => {
  it('runs ready -> approach -> salute -> fight in order with the configured lengths', () => {
    const game = createGame({ intro: true });
    expect(game.round.phase).toBe('intro');
    expect(game.round.intro).toEqual({ step: 'ready', frame: 0 });
    expect(game.fighters.map(f => f.x)).toEqual(rules.spawns);
    const states = runIntro(game);
    const steps = states.map(s => s.round.intro!.step);
    const ready = steps.filter(s => s === 'ready').length, approach = steps.filter(s => s === 'approach').length, salute = steps.filter(s => s === 'salute').length;
    expect(ready).toBe(INTRO_READY_FRAMES - 1);
    expect(approach).toBeGreaterThan(10);
    expect(salute).toBe(INTRO_SALUTE_FRAMES);
    expect(steps).toEqual([...Array(ready).fill('ready'), ...Array(approach).fill('approach'), ...Array(salute).fill('salute'), 'fight']);
    // Ready: standing at the spawns; approach: walking forward, facing each other.
    for (const s of states.filter(s => s.round.intro!.step === 'ready')) expect(s.fighters.map(f => [f.x, f.state])).toEqual([[rules.spawns[0], 'Idle'], [rules.spawns[1], 'Idle']]);
    const walking = states.filter(s => s.round.intro!.step === 'approach');
    for (const s of walking.slice(1)) for (const f of s.fighters) { expect(f.state).toBe('Walk'); expect(Math.sign(f.vx)).toBe(f.facing); }
    // The FIGHT banner stays for INTRO_FIGHT_FRAMES while the round already runs.
    expect(game.round.phase).toBe('fighting');
    for (let i = 1; i < INTRO_FIGHT_FRAMES; i++) { step(game); expect(game.round.intro).toEqual({ step: 'fight', frame: i }); }
    step(game); expect(game.round.intro).toBe(null);
  });

  it('plays standing LP during the salute and returns to Idle before FIGHT', () => {
    expect(INTRO_SALUTE_FRAMES).toBeGreaterThanOrEqual(MOVES[SALUTE_MOVE].duration);
    const game = createGame({ intro: true });
    const salute = runIntro(game).filter(s => s.round.phase === 'intro' && s.round.intro!.step === 'salute');
    salute.slice(0, MOVES[SALUTE_MOVE].duration).forEach((s, frame) => {
      for (const f of s.fighters) { expect(f.state).toBe('Attack'); expect(f.moveId).toBe(SALUTE_MOVE); expect(f.moveFrame).toBe(frame); expect(f.attackFacing).toBe(f.facing); }
    });
    for (const f of game.fighters) { expect(f.state).toBe('Idle'); expect(f.moveId).toBe(null); expect(f.vx).toBe(0); }
    // The fighters stay where they greeted: inside near-reach, as before.
    expect(game.fighters[1].x - game.fighters[0].x).toBe(SALUTE_DISTANCE);
  });

  it('replays the intro after every round, never in training', () => {
    const game = createGame({ intro: true });
    runIntro(game);
    game.fighters[1].hp = 0; step(game);
    expect(game.round.phase).toBe('roundOver');
    while (game.round.phase === 'roundOver') step(game);
    expect(game.round.number).toBe(2);
    expect(game.round.phase).toBe('intro');
    expect(game.round.intro).toEqual({ step: 'ready', frame: 0 });
    expect(game.fighters.map(f => f.x)).toEqual(rules.spawns);

    step(game, undefined, [{ type: 'training', enabled: true, dummy: 'stand' }]);
    expect(game.round.phase).toBe('fighting'); expect(game.round.intro).toBe(null);
    step(game, undefined, [{ type: 'reset' }]);
    expect(game.round.phase).toBe('fighting');
    step(game, undefined, [{ type: 'training', enabled: false, dummy: 'stand' }]);
    expect(game.round.phase).toBe('intro');
  });

  it('keeps plain games (tests, survival views) without an intro', () => {
    const game = createGame();
    expect(game.round.phase).toBe('fighting'); expect(game.round.intro).toBe(null);
    step(game, undefined, [{ type: 'reset' }]);
    expect(game.round.phase).toBe('fighting');
  });
});

describe('round intro: salute distance from the move data', () => {
  it('derives the fist reach from the standing LP hand capsules', () => {
    const frames = geometry[SALUTE_MOVE].frames;
    const reach = (frame: number) => Math.max(...handIndices.map(i => Math.round(frames[frame].body[i][2] * FIGURE_SCALE) + Math.round(frames[frame].body[i][4] * FIGURE_SCALE)));
    const all = Array.from({ length: MOVES[SALUTE_MOVE].duration }, (_, frame) => reach(frame));
    expect(fistReach(SALUTE_MOVE, SALUTE_PEAK_FRAME)).toBe(Math.max(...all));
    expect(all.indexOf(Math.max(...all))).toBe(SALUTE_PEAK_FRAME);
    expect(SALUTE_DISTANCE).toBe(saluteDistance([SALUTE_MOVE, SALUTE_MOVE]));
    expect(SALUTE_DISTANCE).toBe(2 * Math.max(...all));
    // The fist peaks in front of the body, beyond the pushboxes, and the spawns are far enough apart for a visible approach.
    expect(SALUTE_DISTANCE).toBeGreaterThan(MOVES[SALUTE_MOVE].frames[0].pushbox.width * FIGURE_SCALE);
    expect(rules.spawns[1] - rules.spawns[0] - SALUTE_DISTANCE).toBeGreaterThan(40 * rules.unit);
  });

  it.each([1, -1] as const)('fist tips touch exactly at the peak, mirrored (fighter 0 facing %i)', leftFacing => {
    const left = 100 * rules.unit;
    const [a, b] = leftFacing === 1
      ? [{ x: left, facing: 1 }, { x: left + SALUTE_DISTANCE, facing: -1 }]
      : [{ x: left + SALUTE_DISTANCE, facing: -1 }, { x: left, facing: 1 }];
    expect(fistTipX(a)).toBe(fistTipX(b));
    // The baked hand capsules just touch at this distance and not one step further apart.
    const hands = (f: { x: number; facing: number }, shift = 0) => handIndices.map(i => world(geometry[SALUTE_MOVE].frames[SALUTE_PEAK_FRAME].body[i], f.x + shift, f.facing));
    const touching = (apart: number) => hands(a).some(h => hands(b, -b.facing * apart).some(k => capsulesOverlap(h, k)));
    expect(touching(0)).toBe(true);
    expect(touching(2)).toBe(false);
  });

  it('reaches the distance from the spawns of both sides, also swapped', () => {
    for (const swapped of [false, true]) {
      const game = createGame({ intro: true });
      if (swapped) { const [a, b] = game.fighters; [a.x, b.x] = [b.x, a.x]; a.facing = -1; b.facing = 1; }
      runIntro(game);
      const [a, b] = game.fighters;
      expect(Math.abs(b.x - a.x)).toBe(SALUTE_DISTANCE);
      // Both walked the same distance (up to one subpixel).
      expect(Math.abs(Math.abs(a.x - (swapped ? rules.spawns[1] : rules.spawns[0])) - Math.abs(b.x - (swapped ? rules.spawns[0] : rules.spawns[1])))).toBeLessThanOrEqual(1);
    }
  });

  it('reports the fist contact exactly once, at the salute peak', () => {
    const game = createGame({ intro: true });
    let contacts = 0, previous = snapshot(game);
    while (game.round.phase === 'intro') {
      step(game);
      const contact = saluteContact(game);
      if (contact && !saluteContact(previous)) {
        contacts++;
        expect(game.fighters.map(f => f.moveFrame)).toEqual([SALUTE_PEAK_FRAME, SALUTE_PEAK_FRAME]);
        expect(contact.x).toBe(fistTipX(game.fighters[0]));
        expect(contact.y).toBeLessThan(0);
      }
      expect(newSwingSounds(game, previous)).toEqual([]);
      previous = snapshot(game);
    }
    expect(contacts).toBe(1);
  });
});

describe('round intro: locked inputs, no combat, timer', () => {
  it('ignores every input and causes no damage, resources or measurements', () => {
    const quiet = createGame({ intro: true }), mashed = createGame({ intro: true });
    const a = runIntro(quiet), b = runIntro(mashed, mash);
    expect(b.length).toBe(a.length);
    b.forEach((s, i) => {
      expect(s.fighters.map(f => [f.x, f.y, f.state, f.moveId, f.moveFrame, f.facing])).toEqual(a[i].fighters.map(f => [f.x, f.y, f.state, f.moveId, f.moveFrame, f.facing]));
      for (const f of s.fighters) {
        expect(f.hp).toBe(rules.maxHealth);
        expect(f.resources).toEqual(rules.resources);
        expect(f.hitTargets).toEqual([]);
        expect(f.input.pending).toBe(null);
        expect(f.comboCount).toBe(0);
      }
      expect(s.hitstop).toBe(0); expect(s.lastContact).toBe(null); expect(s.measurements).toEqual([]);
      expect(s.combatFrame).toBe(0);
    });
  });

  it('a button held through the intro is no press at FIGHT; a fresh press attacks', () => {
    const game = createGame({ intro: true });
    const lp: [RawInput, RawInput] = [{ ...neutralInput(), buttons: 1 }, neutralInput()];
    runIntro(game, () => lp);
    step(game, lp);
    expect(game.fighters[0].state).toBe('Idle');
    step(game); step(game, lp);
    expect(game.fighters[0].state).toBe('Attack');
    expect(game.fighters[0].moveId).toBe('standing_lp');
  });

  it('starts the round timer only at FIGHT', () => {
    const game = createGame({ intro: true });
    for (const s of runIntro(game, mash)) expect(s.round.timer).toBe(FULL_TIMER);
    expect(game.round.timer).toBe(FULL_TIMER);
    step(game); expect(game.round.timer).toBe(FULL_TIMER - 1);
  });
});

describe('round intro: determinism and replays', () => {
  it('produces identical states for identical inputs', () => {
    const a = createGame({ intro: true }), b = createGame({ intro: true });
    for (let i = 0; i < 400; i++) { step(a, mash(i)); step(b, mash(i)); }
    expect(b).toEqual(a);
  });

  it('records and replays a match start including the intro', () => {
    const game = createGame({ intro: true });
    const replay = createReplay(game);
    for (let i = 0; i < 260; i++) { const inputs = mash(i); replay.frames.push(structuredClone({ inputs, events: [] })); step(game, inputs); }
    const phases: string[] = [];
    const replayed = playReplay(JSON.parse(JSON.stringify(replay)), state => phases.push(state.round.phase));
    expect(replayed).toEqual(game);
    expect(phases).toContain('intro'); expect(phases.at(-1)).toBe('fighting');
  });

  it('accepts snapshots in every intro step and rejects inconsistent ones', () => {
    const game = createGame({ intro: true });
    for (const s of runIntro(game)) expect(() => validateSnapshot(s)).not.toThrow();
    const ticking = createGame({ intro: true }); ticking.round.timer--;
    expect(() => validateSnapshot(ticking)).toThrow(/Runden-Intro/);
    const lost = createGame({ intro: true }); lost.round.intro = null;
    expect(() => validateSnapshot(lost)).toThrow(/Runden-Intro/);
    const training = createGame({ intro: true }); training.training.enabled = true;
    expect(() => validateSnapshot(training)).toThrow(/Runden-Intro/);
    const unmarked = createGame({ intro: true }); delete unmarked.roundIntro;
    expect(() => validateSnapshot(unmarked)).toThrow(/Runden-Intro/);
    const fightLabel = createGame(); fightLabel.round.intro = { step: 'salute', frame: 0 }; fightLabel.roundIntro = true;
    expect(() => validateSnapshot(fightLabel)).toThrow(/Runden-Intro/);
    expect(() => parseReplay({ ...createReplay(createGame({ intro: true })), engineVersion: '1.13.0' })).toThrow(/Engine 1\.16\.0/);
  });
});
