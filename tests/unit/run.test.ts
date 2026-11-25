import { describe, expect, it } from 'vitest';
import rules from '../../src/data/rules.json';
import { buttonBit, neutralInput, type RawInput } from '../../src/input/types';
import { RUN_TAP_FRAMES } from '../../src/input/run';
import { createGame, snapshot, step } from '../../src/simulation/state';
import { pushbox } from '../../src/simulation/collision';
import type { GameState } from '../../src/simulation/types';
import { CpuPlayer } from '../../src/ai';
import { createReplay, parseReplay } from '../../src/debug/replay';
import { animationId, animations, samplePose } from '../../src/render/skeleton';
import { FIGURE_SCALE } from '../../src/data/figure-scale';
import { createSurvival, spawnEnemy, stepSurvival } from '../../src/survival/state';
import { SURVIVAL } from '../../src/survival/config';

const N = neutralInput();
const input = (dir: Partial<RawInput> = {}): RawInput => ({ ...neutralInput(), ...dir });
const R = input({ right: true }), L = input({ left: true });

/** Steps P1 through `frames` (P2 neutral); returns the game for chaining. */
function play(game: GameState, frames: RawInput[]): GameState {
  for (const raw of frames) step(game, [raw, N]);
  return game;
}
/** Forward tap, `gap` neutral frames, forward again (held from here on). */
const doubleTap = (forward: RawInput, gap = 3, first = 2): RawInput[] =>
  [...Array(first).fill(forward), ...Array(gap).fill(N), forward];
/** Game with the opponent parked far away so P1 can run freely. */
function open(): GameState {
  const game = createGame();
  game.fighters[0].x = 20 * 256; game.fighters[1].x = rules.stageWidth - 20 * 256;
  return game;
}

describe('run: double tap and hold forward', () => {
  it('runs about 1.8 times as fast as the forward walk', () => {
    expect(rules.runSpeed / rules.forwardSpeed).toBeGreaterThanOrEqual(1.7);
    expect(rules.runSpeed / rules.forwardSpeed).toBeLessThanOrEqual(1.9);
    const game = play(open(), doubleTap(R)), a = game.fighters[0];
    expect(a.state).toBe('Run');
    for (let i = 0; i < 20; i++) {
      const x = a.x; play(game, [R]);
      expect(a.state).toBe('Run');
      expect(a.x - x).toBe(rules.runSpeed);
      expect(a.vx).toBe(rules.runSpeed);
    }
    expect(animationId(a)).toBe('Run');
  });

  it.each([1, 5, RUN_TAP_FRAMES - 1])('starts within the tap window (gap of %i neutral frames)', gap => {
    expect(play(open(), doubleTap(R, gap)).fighters[0].state).toBe('Run');
  });

  it('ignores a second press after the tap window', () => {
    const game = play(open(), doubleTap(R, RUN_TAP_FRAMES));
    expect(game.fighters[0].state).toBe('Walk');
    play(game, Array(10).fill(R));
    expect(game.fighters[0].state).toBe('Walk');
    expect(RUN_TAP_FRAMES).toBe(12);
  });

  it('keeps walking for a single held press and for a slow double press', () => {
    const game = play(open(), Array(30).fill(R));
    expect(game.fighters[0].state).toBe('Walk');
    expect(game.fighters[0].vx).toBe(rules.forwardSpeed);
  });

  it('needs the second press to be held: tap, tap, release stays a walk/idle', () => {
    const game = play(open(), [...doubleTap(R), N]), a = game.fighters[0];
    expect(a.state).toBe('Idle');
    expect(a.vx).toBe(0);
    expect(a.input.run).toBe(false);
    // Pressing forward again long after: an ordinary walk.
    play(game, [...Array(RUN_TAP_FRAMES + 2).fill(N), R, R]);
    expect(a.state).toBe('Walk');
  });

  it('does not count a back or down direction between the taps', () => {
    for (const between of [L, input({ down: true }), input({ down: true, right: true })]) {
      const game = play(open(), [R, R, between, R, R]);
      expect(game.fighters[0].state).toBe('Walk');
    }
  });

  it('respects SOCD: left+right resolves to neutral (neutral mode) and cannot be forward', () => {
    const game = open();
    play(game, [R, R, N, input({ left: true, right: true }), input({ left: true, right: true })]);
    expect(game.fighters[0].state).toBe('Idle');
    // Releasing left out of left+right is a fresh forward press within the window: that runs.
    play(game, [R]);
    expect(game.fighters[0].state).toBe('Run');
  });

  it('uses the facing as forward (P2 runs to the left)', () => {
    const game = open(), b = game.fighters[1];
    for (const raw of doubleTap(L)) step(game, [N, raw]);
    expect(b.facing).toBe(-1);
    expect(b.state).toBe('Run');
    const x = b.x; step(game, [N, L]);
    expect(b.x - x).toBe(-rules.runSpeed);
    // Back taps (towards the own back) never run.
    const other = open();
    for (const raw of [...doubleTap(R), R, R]) step(other, [N, raw]);
    expect(other.fighters[1].state).toBe('Walk');
  });

  it('never runs from input flagged noRun (CPU) and the CPU flags its input', () => {
    const game = play(open(), doubleTap(input({ right: true, noRun: true })));
    expect(game.fighters[0].state).toBe('Walk');
    const cpu = new CpuPlayer('hard', 1);
    expect(cpu.next(createGame()).noRun).toBe(true);
  });
});

describe('run: ending conditions', () => {
  it('stops at once when forward is released (no slide)', () => {
    const game = play(open(), [...doubleTap(R), R, R]), a = game.fighters[0];
    play(game, [N]);
    const x = a.x;
    expect(a.state).toBe('Idle');
    play(game, [N, N]);
    expect(a.x).toBe(x);
    // Pressing forward again (outside a fresh double tap) walks.
    play(game, Array(RUN_TAP_FRAMES + 1).fill(N));
    play(game, [R]);
    expect(a.state).toBe('Walk');
  });

  it('ends in a crouch on down / down-forward', () => {
    for (const down of [input({ down: true }), input({ down: true, right: true })]) {
      const game = play(open(), [...doubleTap(R), R, down]);
      expect(game.fighters[0].state).toBe('Crouch');
      play(game, [R, R]);
      expect(game.fighters[0].state).toBe('Walk');
    }
  });

  it('jumps with the normal forward jump', () => {
    const game = play(open(), [...doubleTap(R), R, input({ up: true, right: true })]), a = game.fighters[0];
    expect(a.state).toBe('JumpSquat');
    expect(a.jumpX).toBe(rules.jumpSpeed);
    for (let i = 0; i < rules.jumpSquat; i++) play(game, [R]);
    expect(a.state).toBe('Airborne');
    expect(a.vx).toBe(rules.jumpSpeed);
    while (a.y < 0 || a.state === 'Airborne') play(game, [R]);
    while (a.state === 'Landing') play(game, [R]);
    expect(a.state).toBe('Walk');
  });

  it('attacks normally out of the run and walks (not runs) afterwards', () => {
    const game = play(open(), [...doubleTap(R), R]), a = game.fighters[0];
    const walk = play(open(), [R, R]);
    play(walk, [{ ...R, buttons: buttonBit('LP') }]);
    play(game, [{ ...R, buttons: buttonBit('LP') }]);
    expect(a.state).toBe('Attack');
    expect(a.moveId).toBe(walk.fighters[0].moveId);
    // No running bonus: the attack advances like one started from a walk.
    const startRun = a.x, startWalk = walk.fighters[0].x;
    while (a.state === 'Attack') { play(game, [R]); play(walk, [R]); }
    expect(a.x - startRun).toBe(walk.fighters[0].x - startWalk);
    expect(a.state).toBe('Walk');
    play(game, [R, R]);
    expect(a.state).toBe('Walk');
  });

  it('ends on a back (block) input', () => {
    const game = play(open(), [...doubleTap(R), R, L]), a = game.fighters[0];
    expect(a.state).toBe('Walk');
    expect(a.vx).toBe(-rules.backwardSpeed);
    expect(a.input.run).toBe(false);
  });

  it('ends on a hit and needs a new double tap afterwards', () => {
    const game = createGame(), a = game.fighters[0];
    for (const raw of doubleTap(R)) step(game, [raw, N]);
    expect(a.state).toBe('Run');
    let hit = false;
    for (let i = 0; i < 120 && !hit; i++) {
      step(game, [R, { ...N, buttons: i % 2 ? 0 : buttonBit('LP') }]);
      if (a.state === 'Hitstun') hit = true;
    }
    expect(hit).toBe(true);
    expect(a.input.run).toBe(false);
    while (a.state === 'Hitstun') step(game, [R, N]);
    expect(a.state).not.toBe('Run');
  });

  it('stops on contact with the opponent and never runs through', () => {
    const game = createGame(), a = game.fighters[0], b = game.fighters[1];
    for (const raw of doubleTap(R)) step(game, [raw, N]);
    expect(a.state).toBe('Run');
    let stopped = -1;
    for (let i = 0; i < 120; i++) {
      step(game, [R, N]);
      expect(a.x).toBeLessThan(b.x);
      expect(pushbox(a).x + pushbox(a).width).toBeLessThanOrEqual(pushbox(b).x);
      if (stopped < 0 && a.state !== 'Run') stopped = i;
    }
    expect(stopped).toBeGreaterThan(0);
    expect(a.state).toBe('Walk');
    expect(a.input.run).toBe(false);
  });
});

describe('run: replays and data', () => {
  it('replays a run deterministically from the recorded raw input', () => {
    const game = open(), replay = createReplay(game);
    const frames = [...doubleTap(R), ...Array(25).fill(R), N, ...doubleTap(R, 8), ...Array(10).fill(R), input({ up: true, right: true }), ...Array(40).fill(R)];
    let sawRun = 0;
    for (const raw of frames) {
      const inputs: [RawInput, RawInput] = [raw, N];
      replay.frames.push(structuredClone({ inputs, events: [] }));
      step(game, inputs);
      if (game.fighters[0].state === 'Run') sawRun++;
    }
    expect(sawRun).toBeGreaterThan(30);
    const parsed = parseReplay(JSON.parse(JSON.stringify(replay)));
    const again = snapshot(parsed.initial);
    for (const frame of parsed.frames) step(again, frame.inputs, frame.events);
    expect(again).toEqual(game);
  });

  it('has a looping generated run cycle', () => {
    expect(animations.Run).toMatchObject({ loop: true, grounded: true });
    expect(animations.Run.durationFrames).toBeLessThan(animations.Walk.durationFrames);
  });

  it('plants the stance foot against the run speed (no foot sliding) and lifts the other higher than the walk', () => {
    const period = animations.Run.durationFrames - 1, speed = rules.runSpeed / rules.unit;
    for (const [joint, from, to] of [['leftFoot', 1, period / 2 - 1], ['rightFoot', period / 2 + 1, period - 1]] as const) {
      const first = samplePose('Run', from)[joint];
      for (let t = from; t < to; t += .25) {
        const pose = samplePose('Run', t);
        expect(pose[joint][0] * FIGURE_SCALE + t * speed).toBeCloseTo(first[0] * FIGURE_SCALE + from * speed, 1);
        expect(pose[joint][1]).toBeCloseTo(0, 1);
      }
    }
    const lift = (id: string, joint: 'leftFoot' | 'rightFoot', range: [number, number]) => {
      const p = animations[id].durationFrames - 1; let best = 0;
      for (let t = range[0] * p; t <= range[1] * p; t += .25) best = Math.min(best, samplePose(id, t)[joint][1]);
      return best;
    };
    expect(lift('Run', 'rightFoot', [0, .5])).toBeLessThan(lift('Walk', 'rightFoot', [0, .5]) - 5);
    // Leaning forward: the head sits ahead of the hip.
    const pose = samplePose('Run', 0);
    expect(pose.head[0] - pose.hip[0]).toBeGreaterThan(samplePose('Walk', 0).head[0] - samplePose('Walk', 0).hip[0]);
  });
});

describe('run: survival', () => {
  const quiet = () => { const s = createSurvival(1); s.spawnTimer = 1e9; return s; };

  it('runs forward along the fixed facing and still turns on a back double tap', () => {
    const s = quiet(), p = s.player;
    for (const raw of doubleTap(R)) stepSurvival(s, raw);
    expect(p.state).toBe('Run');
    const x = p.x; stepSurvival(s, R);
    expect(p.x - x).toBe(rules.runSpeed);
    // Back double tap out of the run: the first tap ends the run, the second turns.
    stepSurvival(s, L); expect(p.state).toBe('Walk');
    stepSurvival(s, N); stepSurvival(s, L);
    expect(s.turn).not.toBeNull();
    for (let i = 0; i < SURVIVAL.turn.frames; i++) stepSurvival(s, N);
    expect(p.facing).toBe(-1);
    // Forward is now to the left.
    for (const raw of doubleTap(L)) stepSurvival(s, raw);
    expect(p.state).toBe('Run');
    expect(s.turns).toBe(1);
  });

  it('a forward double tap never turns the player', () => {
    const s = quiet();
    for (const raw of [...doubleTap(R), N, ...doubleTap(R)]) stepSurvival(s, raw);
    expect(s.turn).toBeNull();
    expect(s.player.facing).toBe(1);
  });

  it('enemies never run, even on a forward double tap', () => {
    const s = quiet(), e = spawnEnemy(s, 1);
    e.entering = false; e.fighter.x = s.player.x + 300 * 256; e.fighter.facing = -1;
    for (const raw of [...doubleTap(L), L, L, L]) stepSurvival(s, N, [raw]);
    expect(e.fighter.state).not.toBe('Run');
  });
});
