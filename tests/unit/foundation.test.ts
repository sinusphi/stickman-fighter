import { describe, expect, it } from 'vitest';
import { createGame, snapshot, step, updateFacing } from '../../src/simulation/state';
import { FixedLoop } from '../../src/platform/loop';

describe('fixed simulation', () => {
  it.each([30, 60, 144])('runs sixty steps per second at %i render Hz', hz => {
    const game = createGame();
    const loop = new FixedLoop();
    loop.advance(0, () => step(game));
    for (let i = 1; i <= hz * 3; i++) loop.advance(i * 1000 / hz, () => step(game));
    expect(game.frame).toBe(180);
  });
  it('pauses instead of catching up a suspended tab', () => {
    const loop = new FixedLoop(); let steps = 0;
    loop.advance(0, () => steps++); loop.advance(4000, () => steps++);
    expect(steps).toBe(0); expect(loop.paused).toBe(true);
  });
  it('mirrors facing on a side switch and preserves ties', () => {
    const game = createGame(); game.fighters[0].x = game.fighters[1].x + 1;
    updateFacing(game); expect(game.fighters.map(f => f.facing)).toEqual([-1, 1]);
    game.fighters[0].x = game.fighters[1].x; updateFacing(game);
    expect(game.fighters.map(f => f.facing)).toEqual([-1, 1]);
  });
  it('serializes a fully independent snapshot', () => {
    const game = createGame(); step(game);
    const copy = snapshot(game);
    expect(JSON.parse(JSON.stringify(copy))).toEqual(game);
    copy.fighters[0].x++;
    expect(copy.fighters[0].x).not.toBe(game.fighters[0].x);
  });
});
