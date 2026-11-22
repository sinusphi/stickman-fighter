import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import rig from '../../src/data/poses.json';
import rules from '../../src/data/rules.json';
import moveData from '../../src/data/moves.json';
import { MOVES, PLAYABLE_MOVES, THROW_BUTTON, validateMoves } from '../../src/data/schema';
import { FIGURE_SCALE } from '../../src/data/figure-scale';
import { createGame, snapshot, step } from '../../src/simulation/state';
import { collectContacts, localBoxes } from '../../src/simulation/combat';
import { overlaps, pushbox } from '../../src/simulation/collision';
import { isActionable } from '../../src/simulation/movement';
import { grabBox, inGrabRange, isThrowable } from '../../src/simulation/throws';
import { BUTTONS, buttonBit, neutralInput, type RawInput } from '../../src/input/types';
import { createReplay, hash, parseReplay, playReplay, validateSnapshot } from '../../src/debug/replay';
import { animations, buildPose, sampleAngles, samplePose } from '../../src/render/skeleton';
import { figureBottom, jointBottom } from '../../src/render/figure-geometry';
import { HitEffects, ParticleKind } from '../../src/render/effects';
import { thrownOffset } from '../../src/render/canvas';
import { HitFeedback, THROW_KO_FRAME } from '../../src/render/feedback';
import { classifyHit, newContactSounds, newSwingSounds, newThrowSounds } from '../../src/platform/hit-sound';
import { stateLine } from '../../src/debug/display';
import type { Fighter, GameState } from '../../src/simulation/types';
import { CpuPlayer } from '../../src/ai';
import { UtilityBrain } from '../../src/ai/brain';
import { Controller } from '../../src/ai/controller';
import { observe } from '../../src/ai/observation';
import { PROFILES, type Difficulty } from '../../src/ai/profiles';
import { Rng } from '../../src/ai/rng';

const U = rules.unit;
const THROW = buttonBit('THROW');
const IDS = ['throw_forward', 'throw_back'] as const;
type Id = typeof IDS[number];
const attempt = (id: Id) => MOVES[id];
const execute = (id: Id) => MOVES[`${id}_exec`];
/** Throws on missing values instead of a non-null assertion. */
function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw Error(`missing ${what}`);
  return value;
}
/** The execute move's validated per-frame table. */
function table(id: Id) {
  const data = must(execute(id).throw, 'throw');
  return { path: must(data.path, 'path'), impactFrame: must(data.impactFrame, 'impactFrame'), releaseFrame: must(data.releaseFrame, 'releaseFrame'), victimAnimation: must(data.victimAnimation, 'victimAnimation') };
}
const direction = (id: Id) => id === 'throw_forward' ? 6 : 4;
/** Raw input for a numpad direction relative to `facing`, plus buttons. */
function held(facing: number, numpad: number, buttons = 0): RawInput {
  const horizontal = (numpad - 1) % 3 - 1;
  return { ...neutralInput(), left: horizontal * facing < 0, right: horizontal * facing > 0, up: numpad >= 7, down: numpad <= 3, buttons };
}
function setup(facing: 1 | -1 = 1, distance = 50, x = 450): GameState {
  const game = createGame(), [a, b] = game.fighters;
  a.x = x * U; b.x = a.x + facing * distance * U;
  a.facing = a.attackFacing = facing; b.facing = b.attackFacing = facing === 1 ? -1 : 1;
  return game;
}
/** Puts `f` one frame before the grab frame of a throw attempt. */
function arm(f: Fighter, id: Id): void {
  f.state = 'Attack'; f.moveId = id; f.moveFrame = attempt(id).startup - 1; f.attackFacing = f.facing; f.stateFrame = 0;
}
const run = (game: GameState, frames: number, inputs: (frame: number) => [RawInput, RawInput] = () => [neutralInput(), neutralInput()]) => {
  for (let i = 0; i < frames; i++) step(game, inputs(i));
};
/** Largest centre distance (px) at which the attempt still grabs. */
function maxRange(id: Id): number {
  let distance = 30;
  while (true) {
    const game = setup(1, distance + 1), [a, b] = game.fighters; a.attackFacing = 1;
    if (!inGrabRange(a, b, attempt(id))) return distance;
    distance++;
  }
}

describe('throw button and data', () => {
  it('adds THROW as the last button and as the lowest normal priority', () => {
    expect(BUTTONS.at(-1)).toBe('THROW');
    expect(THROW_BUTTON).toBe('THROW');
    expect(rules.normalPriority.at(-1)).toBe('THROW');
    expect(new Set(rules.normalPriority).size).toBe(BUTTONS.length);
  });
  it('exempts only THROW from the normal-move requirement and keeps it for every other button', () => {
    const withoutLp = moveData.filter(m => m.id !== 'standing_lp');
    expect(() => validateMoves(withoutLp)).toThrow(/standing\/LP fehlt/);
    expect(Object.values(MOVES).some(m => m.button === 'THROW' && m.command.type === 'normal')).toBe(false);
    // THROW is neither crouch nor air capable and only exists as 6/4 commands.
    expect(Object.values(PLAYABLE_MOVES).filter(m => m.button === 'THROW').map(m => [m.id, m.stance, m.command.directions])).toEqual([
      ['throw_forward', 'standing', [6]], ['throw_back', 'standing', [4]],
    ]);
  });
  it('validates the throw fields', () => {
    const broken = (id: string, change: (move: typeof moveData[number] & { throw?: Record<string, unknown> }) => void) => {
      const copy = structuredClone(moveData) as (typeof moveData[number] & { throw?: Record<string, unknown> })[];
      change(must(copy.find(m => m.id === id)));
      return () => validateMoves(copy);
    };
    expect(broken('throw_forward', m => { must(m.throw).range = 0; })).toThrow(/Reichweite/);
    expect(broken('throw_forward', m => { must(m.throw).execute = 'standing_lp'; })).toThrow(/Ausführung/);
    expect(broken('throw_back_exec', m => { (must(m.throw).path as number[][])[3][1] = 5; })).toThrow(/Bahnpunkte/);
    expect(broken('throw_back_exec', m => { (must(m.throw).path as number[][]).pop(); })).toThrow(/Wurfbahn/);
    expect(broken('throw_forward', m => { m.frameRanges[0].hitboxes = [{ x: 0, y: -100, width: 10, height: 10, hitGroup: 'throw' }]; })).toThrow(/Hitbox/);
    expect(broken('throw_forward', m => { delete m.throw; })).toThrow(/Wurfdaten/);
    expect(broken('throw_forward', m => { m.stance = 'crouching'; })).toThrow(/Hold-Command|Würfe sind/);
  });
  it('uses the chosen frame data, damage and grab range', () => {
    for (const id of IDS) {
      expect([attempt(id).startup, attempt(id).active, attempt(id).recovery]).toEqual([4, 1, 22]);
      expect(attempt(id).throw?.range).toBe(29 * 256);
    }
    expect(execute('throw_forward').damage).toBe(110);
    expect(execute('throw_back').damage).toBe(130);
    // Between "pushboxes touch" and "just outside the standing light punch".
    const touch = Math.ceil(2 * 4096 * FIGURE_SCALE / U);
    const lp = MOVES.standing_lp, lpReach = Math.max(...lp.frames.flatMap(f => f.hitboxes.map(b => Math.ceil((b.x + b.width) * FIGURE_SCALE)))) / U + 4608 * FIGURE_SCALE / U;
    for (const id of IDS) { expect(maxRange(id)).toBeGreaterThan(touch + 20); expect(maxRange(id)).toBeLessThan(lpReach); }
  });
});

describe('throw input', () => {
  it.each(IDS)('%s starts from its direction plus THROW in both facings', id => {
    for (const facing of [1, -1] as const) {
      const game = setup(facing), a = game.fighters[0];
      step(game, [held(facing, direction(id), THROW), neutralInput()]);
      expect(a.moveId).toBe(id);
      expect(a.attackFacing).toBe(facing);
    }
  });
  it('does nothing on neutral, the diagonals, crouching, in the air or while busy', () => {
    for (const facing of [1, -1] as const) for (const numpad of [5, 1, 2, 3, 7, 8, 9]) {
      const game = setup(facing), a = game.fighters[0];
      run(game, 3, () => [held(facing, numpad), neutralInput()]);
      step(game, [held(facing, numpad, THROW), neutralInput()]);
      run(game, 8, () => [held(facing, numpad, THROW), neutralInput()]);
      expect(a.moveId, `numpad ${numpad}`).toBeNull();
      expect(a.attackId).toBe(0);
    }
    // In hitstun or blockstun THROW is buffered at most and never starts a throw.
    const busy = setup(), [a] = busy.fighters;
    a.state = 'Hitstun'; a.remaining = 10;
    step(busy, [held(1, 6, THROW), neutralInput()]);
    expect(a.moveId).toBeNull();
  });
  it('buffers like every other hold command: the press must meet an actionable standing frame', () => {
    // Pressed during recovery and held: the THROW command has no normal fallback and expires.
    const duration = MOVES.standing_lp.duration;
    const game = setup(1, 200), a = game.fighters[0];
    step(game, [{ ...neutralInput(), buttons: buttonBit('LP') }, neutralInput()]);
    run(game, duration - 3);
    step(game, [held(1, 6, THROW), neutralInput()]);
    expect(a.input.pending?.button).toBe('THROW');
    run(game, rules.bufferFrames + 2, () => [held(1, 6, THROW), neutralInput()]);
    expect(a.attackId).toBe(1);
    expect(a.input.pending).toBeNull();
    // Pressed once the fighter stands actionable again: starts.
    const fresh = setup(1, 200), b = fresh.fighters[0];
    step(fresh, [{ ...neutralInput(), buttons: buttonBit('LP') }, neutralInput()]);
    run(fresh, duration);
    expect(isActionable(b)).toBe(true);
    step(fresh, [held(1, 6, THROW), neutralInput()]);
    expect(b.moveId).toBe('throw_forward');
  });
  it('replays the THROW bit (bit 9) deterministically', () => {
    const game = setup(), replay = createReplay(game);
    const frames: [RawInput, RawInput][] = [[held(1, 6, THROW), neutralInput()], ...Array.from({ length: 80 }, () => [neutralInput(), neutralInput()] as [RawInput, RawInput])];
    for (const inputs of frames) { replay.frames.push({ inputs, events: [] }); step(game, inputs); }
    expect(THROW).toBe(512);
    expect(playReplay(JSON.parse(JSON.stringify(replay)))).toEqual(game);
  });
});

describe('throw rules', () => {
  it.each(IDS)('%s grabs just inside the range and whiffs just outside, in both facings', id => {
    const limit = maxRange(id);
    for (const facing of [1, -1] as const) for (const [distance, grabbed] of [[limit, true], [limit + 1, false]] as const) {
      const game = setup(facing, distance), [a, b] = game.fighters;
      arm(a, id);
      step(game);
      expect(b.state, `${facing}/${distance}`).toBe(grabbed ? 'Thrown' : 'Idle');
      expect(a.moveId).toBe(grabbed ? `${id}_exec` : id);
    }
  });
  it('grabs standing, walking and crouching opponents only', () => {
    const cases: [Fighter['state'], boolean, Partial<Fighter>?][] = [
      ['Idle', true], ['Walk', true], ['Crouch', true, { crouching: true }], ['CrouchWalk', true, { crouching: true }],
      ['Airborne', false, { y: -20 * U }], ['JumpSquat', false], ['Landing', false, { remaining: 4 }], ['Hitstun', false, { remaining: 20 }],
      ['Blockstun', false, { remaining: 20 }], ['Knockdown', false, { remaining: 20 }], ['KO', false],
    ];
    for (const [state, grabbed, extra] of cases) {
      const game = setup(1, 50), [a, b] = game.fighters;
      Object.assign(b, { state, ...extra });
      expect(isThrowable(b), state).toBe(grabbed);
      arm(a, 'throw_forward');
      step(game);
      expect(b.state === 'Thrown', state).toBe(grabbed);
    }
    // An opponent in the startup of its own (later) throw or any other attack is not grabbable.
    const busy = setup(1, 50), [c, d] = busy.fighters;
    arm(c, 'throw_forward'); d.state = 'Attack'; d.moveId = 'throw_back'; d.moveFrame = 1; d.attackFacing = -1;
    step(busy);
    expect(d.state).toBe('Attack'); expect(c.moveId).toBe('throw_forward');
  });
  it('cannot be blocked: holding back (also with auto-block) is grabbed', () => {
    for (const autoBlock of [false, true]) {
      const game = setup(1, 50), [a, b] = game.fighters;
      game.inputConfig.autoBlock = [autoBlock, autoBlock];
      arm(a, 'throw_back');
      step(game, [neutralInput(), held(-1, 4)]);
      expect(b.state).toBe('Thrown');
      run(game, 60, () => [neutralInput(), held(-1, 4)]);
      expect(b.hp).toBe(1000 - 130);
    }
  });
  it('whiffs with a long recovery and never grabs late', () => {
    const game = setup(1, 120), [a, b] = game.fighters;
    step(game, [held(1, 6, THROW), neutralInput()]);
    let frames = 1;
    while (!isActionable(a)) { step(game); frames++; if (game.fighters[1].x - a.x < 50 * U) b.x = a.x + 120 * U; }
    // Press frame plus the whole attempt, actionable on the next step.
    expect(frames).toBe(attempt('throw_forward').duration + 1);
    expect(b.state).toBe('Idle');
    expect(attempt('throw_forward').recovery).toBeGreaterThanOrEqual(20);
    expect(attempt('throw_forward').recovery).toBeLessThanOrEqual(25);
    // Walking into range after the grab frame does not grab any more.
    const late = setup(1, 120), [c, d] = late.fighters;
    arm(c, 'throw_forward'); step(late);
    d.x = c.x + 50 * U; run(late, 10);
    expect(d.state).not.toBe('Thrown');
  });
  it('is interrupted by a hit during its startup', () => {
    const game = setup(1, 45), [a, b] = game.fighters;
    step(game, [held(1, 6, THROW), { ...neutralInput(), buttons: buttonBit('LP') }]);
    expect(a.moveId).toBe('throw_forward');
    run(game, 12);
    expect(['Hitstun', 'Idle', 'Walk']).toContain(a.state);
    expect(b.state).not.toBe('Thrown');
    expect(a.hp).toBeLessThan(1000);
    expect(b.hp).toBe(1000);
  });
  it('resolves a throw clash symmetrically: both fail, separate and recover briefly', () => {
    const results = [1, -1].map(facing => {
      const game = setup(facing as 1 | -1, 50), [a, b] = game.fighters;
      arm(a, 'throw_forward'); arm(b, 'throw_back');
      const distance = Math.abs(b.x - a.x);
      step(game);
      expect(a.moveId).toBe('throw_break'); expect(b.moveId).toBe('throw_break');
      expect(Math.abs(b.x - a.x)).toBe(distance + 2 * MOVES.throw_break.pushbackHit);
      expect(game.hitstop).toBe(MOVES.throw_break.hitstop);
      expect(game.fighters.map(f => f.state)).toEqual(['Attack', 'Attack']);
      let recovery = 0;
      while (!isActionable(a)) { step(game); recovery++; }
      expect(isActionable(b)).toBe(true);
      expect(recovery).toBeLessThan(attempt('throw_forward').recovery);
      return [a.hp, b.hp, Math.abs(b.x - a.x)];
    });
    expect(results[0]).toEqual(results[1]);
    // Player order makes no difference: P2 throwing P1 is mirrored exactly.
    const swapped = setup(1, 50), [c, d] = swapped.fighters;
    arm(d, 'throw_forward'); arm(c, 'throw_back'); d.attackFacing = -1;
    step(swapped);
    expect([c.moveId, d.moveId]).toEqual(['throw_break', 'throw_break']);
  });
  it('makes the thrown fighter invulnerable until it gets up', () => {
    const game = setup(1, 50), [a, b] = game.fighters;
    arm(a, 'throw_forward'); step(game);
    expect(b.state).toBe('Thrown');
    expect(localBoxes(b).hurtboxes).toEqual([]);
    // Even a strike placed right on it does not connect.
    a.state = 'Attack'; const executing = a.moveId; a.moveId = 'standing_hp'; a.moveFrame = MOVES.standing_hp.startup;
    expect(collectContacts(game)).toEqual([]);
    a.moveId = executing; a.moveFrame = 0;
    const states = new Set<string>();
    // Read through a function: step() mutates the fighter behind TypeScript's narrowing.
    const state = (): Fighter['state'] => b.state;
    for (let i = 0; i < 120 && state() !== 'Idle'; i++) { step(game); states.add(state()); if (state() !== 'Idle') expect(collectContacts(game)).toEqual([]); }
    expect([...states]).toEqual(expect.arrayContaining(['Thrown', 'Knockdown']));
  });
  it.each(IDS)('%s applies damage, resources, hitstop and a knockdown on the impact', id => {
    const game = setup(1, 50), [a, b] = game.fighters;
    arm(a, id); step(game);
    expect(game.hitstop).toBe(attempt(id).hitstop);
    const data = table(id);
    let impact = -1, hitstop = 0;
    for (let i = 0; i < 120; i++) {
      step(game);
      if (b.state === 'Knockdown' && impact < 0) { impact = a.moveFrame; hitstop = game.hitstop; expect(b.stateFrame).toBe(0); expect(b.remaining).toBe(rules.knockdownFrames); }
    }
    expect(impact).toBe(data.impactFrame);
    expect(hitstop).toBe(execute(id).hitstop);
    expect(b.hp).toBe(1000 - execute(id).damage);
    expect(a.resources.special.current).toBe(Math.round(execute(id).damage * rules.resources.special.gainPerHit / 100));
    expect(b.resources.revenge.current).toBe(Math.round(execute(id).damage * rules.resources.revenge.gainPerHit / 100));
    expect(a.comboCount).toBe(1);
    expect(game.lastContact).toMatchObject({ attacker: 0, defender: 1, blocked: false });
    expect(b.state).toBe('Idle');
  });
  it('knocks out through the normal round logic and costs no health in training', () => {
    const game = setup(1, 50), [a, b] = game.fighters;
    b.hp = 100; arm(a, 'throw_back'); run(game, 60);
    expect(b.hp).toBe(0); expect(b.state).toBe('KO');
    expect(game.round).toMatchObject({ phase: 'roundOver', winner: 0, reason: 'KO' });
    const training = setup(1, 50); training.training.enabled = true;
    arm(training.fighters[0], 'throw_forward'); run(training, 60);
    expect(training.fighters[1].hp).toBe(1000);
    expect(training.fighters[1].resources.revenge.current).toBe(Math.round(execute('throw_forward').damage * rules.resources.revenge.gainPerHit / 100));
  });
  it('lands without damage when the round ends during the throw', () => {
    const game = setup(1, 50), [a, b] = game.fighters;
    arm(a, 'throw_forward'); step(game);
    game.round.timer = 2;
    run(game, 60);
    expect(game.round.reason).toBe('DRAW');
    expect(b.hp).toBe(1000);
    expect(['Knockdown', 'Idle']).toContain(b.state);
    expect(b.thrownBy).toBeUndefined();
  });
});

describe('throw path and side switch', () => {
  const stagePx = rules.stageWidth;
  const inStage = (f: Fighter) => { const box = pushbox(f); return box.x >= 0 && box.x + box.width <= stagePx; };
  it.each(IDS)('%s keeps both fighters on stage and never overlapping after the impact (open field and corners)', id => {
    for (const facing of [1, -1] as const) for (const x of [450, 30, 950]) {
      const game = setup(facing, 50, x);
      const [a, b] = game.fighters;
      // Keep the setup on stage.
      a.x = Math.min(Math.max(a.x, 25 * U), stagePx - 25 * U); b.x = a.x + facing * 50 * U;
      if (b.x < 25 * U || b.x > stagePx - 25 * U) { b.x = Math.min(Math.max(b.x, 25 * U), stagePx - 25 * U); a.x = b.x - facing * 50 * U; }
      arm(a, id);
      const states: GameState[] = [];
      for (let i = 0; i < 80; i++) { step(game); states.push(snapshot(game)); }
      for (const s of states) for (const f of s.fighters) expect(inStage(f), `${id} ${facing} ${x}`).toBe(true);
      const thrown = states.filter(s => s.fighters[1].state === 'Thrown');
      // Every frame up to the impact plus the grab hitstop.
      expect(thrown.length).toBe(table(id).impactFrame + attempt(id).hitstop);
      // Continuous relative path: no jump through the thrower.
      for (let i = 1; i < thrown.length; i++) {
        const rel = (s: GameState) => s.fighters[1].x - s.fighters[0].x;
        expect(Math.abs(rel(thrown[i]) - rel(thrown[i - 1]))).toBeLessThan(20 * U);
      }
      const end = must(states.at(-1));
      expect(overlaps(pushbox(end.fighters[0]), pushbox(end.fighters[1]))).toBe(false);
      const side = Math.sign(end.fighters[1].x - end.fighters[0].x);
      expect(side, `${id} ${facing} ${x}`).toBe(id === 'throw_back' ? -facing : facing);
    }
  });
  it('switches sides with the back throw even with the thrower\'s back to the wall', () => {
    const game = setup(1, 50, 0), [a, b] = game.fighters;
    a.x = Math.ceil(4096 * FIGURE_SCALE); b.x = a.x + 50 * U;
    arm(a, 'throw_back'); run(game, 80);
    expect(b.x).toBeLessThan(a.x);
    expect(pushbox(b).x).toBeGreaterThanOrEqual(0);
    expect(overlaps(pushbox(a), pushbox(b))).toBe(false);
    expect(a.facing).toBe(-1); expect(b.facing).toBe(1);
  });
  it('the thrown fighter hangs on the thrower\'s hands until the release', () => {
    for (const id of IDS) {
      const data = table(id);
      for (let f = 0; f <= data.releaseFrame; f++) {
        const thrower = samplePose(`${id}_exec`, f), hands = [(thrower.leftHand[0] + thrower.rightHand[0]) / 2, (thrower.leftHand[1] + thrower.rightHand[1]) / 2];
        const victim = samplePose(data.victimAnimation, f, -1), [x, y] = data.path[f];
        const neck = [x / U / FIGURE_SCALE + victim.neck[0], y / U / FIGURE_SCALE + victim.neck[1]];
        // Frame 0 is the exact guard (it blends in from any grabbable stance), afterwards an exact grip.
        expect(Math.hypot(neck[0] - hands[0] - 2, neck[1] - hands[1]), `${id} ${f}`).toBeLessThan(f === 0 ? 1.5 : 0.05);
      }
    }
  });
  it('draws the thrown fighter from the table at sub-frame times, exact on whole frames', () => {
    const game = setup(1, 50), [a, b] = game.fighters;
    arm(a, 'throw_forward'); run(game, 9);
    const data = table('throw_forward'), i = a.moveFrame;
    expect(thrownOffset(game, b, 0)).toEqual([b.x - a.x, b.y]);
    const half = must(thrownOffset(game, b, 0.5));
    expect(half[1]).toBeCloseTo((data.path[i][1] + data.path[i + 1][1]) / 2, 6);
    expect(thrownOffset(game, a, 0.5)).toBeNull();
  });
});

describe('throw animation invariants', () => {
  const thrower = IDS.flatMap(id => [id, `${id}_exec`]).concat('throw_break');
  it.each(thrower)('%s keeps fixed bones, stays above the floor and returns to Idle', id => {
    const duration = animations[id].durationFrames;
    for (let frame = 0; frame < duration; frame++) for (const fraction of [0, .5]) for (const facing of [-1, 1]) {
      const pose = samplePose(id, frame + fraction, facing);
      for (const bone of rig.skeleton.bones) expect(Math.hypot(pose[bone.parent][0] - pose[bone.joint][0], pose[bone.parent][1] - pose[bone.joint][1])).toBeCloseTo(bone.length, 8);
      expect(Math.max(pose.leftFoot[1], pose.rightFoot[1])).toBeLessThan(1e-8);
      expect(figureBottom(pose)).toBeLessThan(6);
    }
    expect(samplePose(id, duration - 1)).toEqual(samplePose('Idle', 0));
    // Attempts start in the guard; executions and the clash start exactly on the grab pose.
    if (MOVES[id].throw?.phase === 'attempt') expect(samplePose(id, 0)).toEqual(samplePose('Idle', 0));
    else expect(samplePose(id, 0)).toEqual(samplePose('throw_forward', MOVES.throw_forward.startup));
  });
  it.each(IDS)('%s victim: fixed bones, whole-body rotation, never below the floor, ends in the knockdown pose', id => {
    const data = table(id), clip = data.victimAnimation;
    let turned = 0, previous = sampleAngles(clip, 0).angles.neck;
    for (let frame = 0; frame <= data.impactFrame; frame++) for (const fraction of [0, .5]) {
      const time = Math.min(data.impactFrame, frame + fraction);
      const pose = samplePose(clip, time, -1);
      for (const bone of rig.skeleton.bones) expect(Math.hypot(pose[bone.parent][0] - pose[bone.joint][0], pose[bone.parent][1] - pose[bone.joint][1])).toBeCloseTo(bone.length, 8);
      const i = Math.floor(time), j = Math.min(data.impactFrame, i + 1), y = (data.path[i][1] + (data.path[j][1] - data.path[i][1]) * (time - i)) / U / FIGURE_SCALE;
      expect(y + jointBottom(pose), `${id} ${time}`).toBeLessThan(0.75);
      const neck = sampleAngles(clip, time).angles.neck;
      turned += ((neck - previous) % 360 + 540) % 360 - 180; previous = neck;
    }
    // A full flip of the body (more than 270° in total).
    expect(Math.abs(turned)).toBeGreaterThan(270);
    expect(sampleAngles(clip, 0).angles).toEqual(rig.poses.guard.angles);
    // The last frame is the knockdown pose as the renderer lays it down (mirrored behind the thrower).
    const facing = id === 'throw_back' ? 1 : -1, last = samplePose(clip, data.impactFrame, -1);
    const lying = buildPose(sampleAngles('Knockdown', 0), true, facing, true);
    for (const joint of Object.keys(lying)) for (const k of [0, 1]) expect(last[joint][k]).toBeCloseTo(lying[joint][k], 3);
  });
  it('is up to date with the generator (npm run generate:throws -- --check)', () => {
    const result = spawnSync(process.execPath, ['scripts/generate-throws.mjs', '--check'], { encoding: 'utf8', timeout: 120000 });
    expect(result.stderr + result.stdout).toContain('up to date');
    expect(result.status).toBe(0);
  }, 130000);
});

describe('throw presentation', () => {
  it('shows a grab spark, a heavy impact with shake and a single-throw "1 HIT" counter', () => {
    const game = setup(1, 50), effects = new HitEffects(), [a, b] = game.fighters;
    arm(a, 'throw_forward');
    let previous = snapshot(game); step(game); effects.update(game, previous);
    expect(b.state).toBe('Thrown');
    expect(effects.particles().some(p => p.kind === ParticleKind.Flash)).toBe(true);
    let impact = false;
    for (let i = 0; i < 60; i++) {
      previous = snapshot(game); step(game); effects.update(game, previous);
      if (previous.fighters[1].state === 'Thrown' && b.state === 'Knockdown') {
        impact = true;
        expect(effects.shake).toBeGreaterThan(3);
        expect(effects.particles().filter(p => p.kind === ParticleKind.Ring).length).toBeGreaterThanOrEqual(1);
        expect(effects.particles().filter(p => p.kind === ParticleKind.Dust).length).toBeGreaterThanOrEqual(8);
        expect(effects.combo(0)).toMatchObject({ count: 1, damage: 110 });
      }
    }
    expect(impact).toBe(true);
    const off = new HitEffects({ effects: false, shake: false });
    expect(off.camera(false)).toBeNull();
  });
  it('plays a grab thud, the flight whoosh and a heavy slam of kind throw, never a strike sound', () => {
    expect(classifyHit('throw_back_exec')).toEqual({ kind: 'throw', strength: 'high' });
    const game = setup(1, 50), [a] = game.fighters;
    arm(a, 'throw_back');
    const heard = { grabs: 0, flights: 0, slams: 0, other: 0, lead: 0 };
    for (let i = 0; i < 80; i++) {
      const previous = snapshot(game); step(game);
      const sounds = newThrowSounds(game, previous);
      heard.grabs += sounds.grabs.length; heard.flights += sounds.flights.length; heard.slams += sounds.slams.length;
      heard.other += newContactSounds(game, previous).length + newSwingSounds(game, previous).length;
      for (const flight of sounds.flights) heard.lead = flight.leadSeconds;
      for (const slam of sounds.slams) { expect(slam).toMatchObject({ kind: 'throw', blocked: false, finisher: false }); }
    }
    expect(heard).toMatchObject({ grabs: 1, flights: 1, slams: 1, other: 0 });
    const data = table('throw_back');
    expect(heard.lead).toBeCloseTo((data.impactFrame - data.releaseFrame) / rules.hz);
  });
  it('starts a knockout by a throw in the lying KO pose', () => {
    const game = setup(1, 50), feedback = new HitFeedback(), [a, b] = game.fighters;
    b.hp = 50; arm(a, 'throw_forward');
    for (let i = 0; i < 60 && b.state !== 'KO'; i++) { const previous = snapshot(game); step(game); feedback.update(game, previous); }
    expect(b.state).toBe('KO');
    expect(feedback.koFrames[1]).toBe(THROW_KO_FRAME);
    expect(THROW_KO_FRAME).toBeGreaterThan(20);
  });
  it('labels the throw phases in the frame display', () => {
    const game = setup(1, 50), [a, b] = game.fighters;
    arm(a, 'throw_forward'); a.moveFrame = 0;
    expect(stateLine(a)).toContain('STARTUP');
    a.moveFrame = attempt('throw_forward').startup; expect(stateLine(a)).toContain('GRAB');
    arm(a, 'throw_forward'); step(game);
    expect(stateLine(a)).toContain('THROW');
    expect(stateLine(b)).toContain('Thrown');
  });
  it('shows the grab range as a box in front of the pushbox', () => {
    const game = setup(1, 50), [a] = game.fighters; arm(a, 'throw_forward');
    const box = grabBox(a, attempt('throw_forward')), push = pushbox(a);
    expect(Math.abs(box.x - (push.x + push.width))).toBeLessThanOrEqual(1);
    expect(box.width).toBeGreaterThan(30 * U);
  });
});

describe('throw replays and snapshots', () => {
  it('replays throws, clashes and whiffs identically and resumes from a mid-throw snapshot', () => {
    const game = setup(1, 50), replay = createReplay(game), hashes: string[] = [];
    let saved: GameState | undefined, cut = 0;
    const script = (frame: number): [RawInput, RawInput] => {
      if (frame === 0) return [held(1, 6, THROW), neutralInput()];
      if (frame === 120) return [held(game.fighters[0].facing, 4, THROW), held(game.fighters[1].facing, 6, THROW)];
      if (frame === 200) return [held(game.fighters[0].facing, 4, THROW), neutralInput()];
      if (frame > 140 && frame < 160) return [held(game.fighters[0].facing, 6), held(game.fighters[1].facing, 6)];
      return [neutralInput(), neutralInput()];
    };
    for (let frame = 0; frame < 320; frame++) {
      const inputs = script(frame);
      replay.frames.push({ inputs, events: [] }); step(game, inputs); hashes.push(hash(game));
      if (!saved && game.fighters[1].state === 'Thrown' && game.fighters[0].moveFrame > 5) { saved = snapshot(game); cut = frame + 1; }
    }
    expect(saved).toBeDefined();
    const seen: string[] = [];
    expect(playReplay(JSON.parse(JSON.stringify(replay)), s => seen.push(hash(s)))).toEqual(game);
    expect(seen).toEqual(hashes);
    const restored = validateSnapshot(JSON.parse(JSON.stringify(saved)));
    for (const frame of replay.frames.slice(cut)) step(restored, frame.inputs, frame.events);
    expect(restored).toEqual(game);
  });
  it('rejects inconsistent thrown states and replays of the previous engine', () => {
    const game = setup(1, 50), [a] = game.fighters;
    arm(a, 'throw_forward'); run(game, 4);
    expect(game.fighters[1].state).toBe('Thrown');
    expect(() => validateSnapshot(snapshot(game))).not.toThrow();
    const orphan = snapshot(game); orphan.fighters[0].moveId = 'throw_back_exec';
    expect(() => validateSnapshot(orphan)).toThrow(/Wurfzustand/);
    const stray = snapshot(game); stray.fighters[0].thrownBy = 'throw_forward_exec';
    expect(() => validateSnapshot(stray)).toThrow(/Wurfzustand/);
    const old = { ...createReplay(createGame()), engineVersion: '1.9.0' };
    expect(() => parseReplay(old)).toThrow(/Engine 1\.10\.0/);
  });
});

describe('CPU throws', () => {
  const count = (level: Difficulty, opponent: (game: GameState) => RawInput, seeds = 6, frames = 1800) => {
    let throws = 0, attempts = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const game = setup(-1, 52), cpu = new CpuPlayer(level, 1); cpu.reset(seed);
      game.fighters[0].hp = 5000; game.fighters[1].hp = 5000;
      let previous = 0;
      for (let i = 0; i < frames && game.round.phase === 'fighting'; i++) {
        step(game, [opponent(game), cpu.next(game)]);
        const self = game.fighters[1];
        if (self.attackId !== previous && self.moveId && MOVES[self.moveId].throw) attempts++;
        if (game.fighters[0].state === 'Thrown' && game.fighters[0].stateFrame === 0) throws++;
        previous = self.attackId;
      }
    }
    return { throws, attempts };
  };
  const passive = () => neutralInput();
  const blocking = (game: GameState) => held(game.fighters[0].facing, 4);
  it('throws passive and blocking opponents in real matches on every difficulty, the easy CPU least', () => {
    const results = Object.fromEntries((['easy', 'medium', 'hard'] as const).map(level => [level, count(level, passive).throws + count(level, blocking).throws]));
    expect(results.easy).toBeGreaterThan(0);
    expect(results.medium).toBeGreaterThan(results.easy);
    expect(results.hard).toBeGreaterThan(results.easy);
    expect(count('hard', blocking).throws).toBeGreaterThan(0);
  });
  const view = (game: GameState, frame: number) => ({ frame, round: { phase: 'fighting' as const, timer: 5000 }, hitstop: 0, lastContact: null, self: observe(game).fighters[0], opponent: observe(game).fighters[1] });
  const throwIntents = (level: Difficulty, game: GameState, decisions = 400) => {
    const brain = new UtilityBrain(PROFILES[level], new Rng(3));
    let throws = 0;
    for (let i = 0; i < decisions; i++) { const intent = brain.decide(view(game, 900 + i * 300)); if (intent.kind === 'attack' && intent.moveId.startsWith('throw')) throws++; }
    return throws;
  };
  it('chooses a throw per opportunity according to the difficulty, never out of range or against an airborne opponent', () => {
    const close = setup(1, 50);
    const rates = (['easy', 'medium', 'hard'] as const).map(level => throwIntents(level, close));
    expect(rates[0]).toBeLessThan(rates[1]); expect(rates[1]).toBeLessThan(rates[2]);
    expect(rates[2]).toBeGreaterThan(400 * PROFILES.hard.throwChance * .6);
    expect(throwIntents('hard', setup(1, 120))).toBe(0);
    const air = setup(1, 50); air.fighters[1].y = -30 * U; air.fighters[1].state = 'Airborne';
    expect(throwIntents('hard', air)).toBe(0);
    const stunned = setup(1, 50); stunned.fighters[1].state = 'Hitstun';
    expect(throwIntents('hard', stunned)).toBe(0);
    // Against a jumping opponent the delayed perception may still try once, but nobody is ever grabbed in the air.
    const jumper = (game: GameState) => game.fighters[0].y === 0 && game.fighters[0].state !== 'JumpSquat' ? held(game.fighters[0].facing, 8) : neutralInput();
    expect(count('hard', jumper).throws).toBe(0);
  });
  it('drives the hold command through the controller like any other hold move', () => {
    const game = setup(1, 50), controller = new Controller();
    controller.set({ kind: 'attack', moveId: 'throw_back', score: 1, reason: 'throw' }, observe(game).fighters[0]);
    for (let i = 0; i < 3; i++) step(game, [controller.next(observe(game).fighters[0]), neutralInput()]);
    expect(game.fighters[0].moveId).toBe('throw_back');
  });
});
