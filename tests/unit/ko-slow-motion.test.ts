import { describe, expect, it } from 'vitest';
import { createGame, step } from '../../src/simulation/state';
import { neutralInput } from '../../src/input/types';
import rules from '../../src/data/rules.json';
import { FixedLoop } from '../../src/platform/loop';
import { HitFeedback } from '../../src/render/feedback';
import { KoSlowMotion, KO_SLOW_MOTION_SCALE } from '../../src/platform/slow-motion';
import type { GameState } from '../../src/simulation/types';
import type { RawInput } from '../../src/input/types';

function run(game: GameState, feedback: HitFeedback, slow: KoSlowMotion, inputs?: [RawInput,RawInput]): number {
  const previous = structuredClone(game);
  step(game, inputs);
  feedback.update(game, previous);
  return slow.update(game, feedback.koFrames);
}

function lethalSetup(doubleKo: boolean) {
  const game = createGame(), feedback = new HitFeedback(), slow = new KoSlowMotion();
  const [a,b] = game.fighters; a.x = 400*rules.unit; b.x = 448*rules.unit; b.hp = 30; if (doubleKo) a.hp = 30;
  const lp: RawInput = { ...neutralInput(), buttons: 1 };
  const scales = [run(game, feedback, slow, [lp, doubleKo ? lp : neutralInput()])];
  return { game, feedback, slow, scales };
}

describe('KO slow motion', () => {
  for (const doubleKo of [false, true]) it(`slows from the ${doubleKo ? 'double ' : ''}KO frame until every pose is final`, () => {
    const { game, feedback, slow, scales } = lethalSetup(doubleKo);
    while (game.round.phase === 'fighting') scales.push(run(game, feedback, slow));
    expect(game.round.reason).toBe(doubleKo ? 'DOUBLE KO' : 'KO');
    expect(scales.at(-1)).toBe(KO_SLOW_MOTION_SCALE);
    expect(scales.slice(0, -1).every(s => s === 1)).toBe(true);
    let frames = 0;
    while (slow.active && frames < 500) { run(game, feedback, slow); frames++; }
    expect(slow.active).toBe(false);
    expect(game.hitstop).toBe(0);
    for (const f of game.fighters) {
      if (f.state === 'KO') expect(feedback.koFrames[f.id]).toBe(45);
      else { expect(f.state).toBe('Idle'); expect(f.y).toBe(0); }
    }
    // Stays at normal speed for the rest of the transition and the next round.
    while ((game.round.phase as string) !== 'fighting') expect(run(game, feedback, slow)).toBe(1);
    expect(run(game, feedback, slow)).toBe(1);
  });

  it('does not slow a time over', () => {
    const game = createGame(), feedback = new HitFeedback(), slow = new KoSlowMotion();
    game.round.timer = 1; game.fighters[0].hp = 800;
    expect(run(game, feedback, slow)).toBe(1);
    expect(game.round.reason).toBe('TIME OVER');
  });

  it('scales only wall-clock pacing, never the simulation frame size', () => {
    const loop = new FixedLoop(); let count = 0;
    loop.advance(0, () => count++);
    loop.timeScale = 0.5;
    for (let i = 1; i <= 60; i++) loop.advance(i * 1000 / rules.hz, () => count++);
    expect(count).toBe(30);
    loop.timeScale = 1;
    for (let i = 61; i <= 120; i++) loop.advance(i * 1000 / rules.hz, () => count++);
    expect(count).toBe(90);
  });
});
