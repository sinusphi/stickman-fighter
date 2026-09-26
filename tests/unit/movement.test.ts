import { FIGURE_SCALE } from '../../src/data/figure-scale';
import { describe, expect, it } from 'vitest';
import { createGame, step } from '../../src/simulation/state';
import { neutralInput } from '../../src/input/types';
import { overlaps, pushbox, resolvePushboxes, worldBox } from '../../src/simulation/collision';
import rules from '../../src/data/rules.json';

describe('movement and AABB collision', () => {
  it('moves forwards faster than backwards, walks forward in the crouch and holds still on down-back', () => {
    const game = createGame(); const start = game.fighters[0].x;
    step(game, [{ ...neutralInput(), right: true }, neutralInput()]);
    expect(game.fighters[0].x - start).toBe(rules.forwardSpeed);
    step(game, [{ ...neutralInput(), left: true }, neutralInput()]);
    expect(game.fighters[0].state).toBe('Walk');
    expect(game.fighters[0].x - start).toBe(rules.forwardSpeed - rules.backwardSpeed);
    const crouchX = game.fighters[0].x;
    for (let i = 0; i < 10; i++) step(game, [{ ...neutralInput(), down: true, left: true }, neutralInput()]);
    expect(game.fighters[0].state).toBe('Crouch');
    expect(game.fighters[0].input.current.direction).toBe(1);
    expect(game.fighters[0].x).toBe(crouchX);
    expect(game.fighters[0].vx).toBe(0);
    step(game, [{ ...neutralInput(), down: true, right: true }, neutralInput()]);
    expect(game.fighters[0].state).toBe('CrouchWalk');
    expect(game.fighters[0].x - crouchX).toBe(rules.crouchForwardSpeed);
  });
  it('uses authored squat and landing durations with fixed jump velocity', () => {
    const game = createGame();
    step(game, [{ ...neutralInput(), up: true, right: true }, neutralInput()]);
    expect(game.fighters[0].state).toBe('JumpSquat');
    for(let i=0;i<rules.jumpSquat-1;i++) { step(game); expect(game.fighters[0].y).toBe(0); }
    step(game);
    expect(game.fighters[0].y).toBe(rules.jumpVelocity);
    const x = game.fighters[0].x;
    step(game, [{ ...neutralInput(), left: true }, neutralInput()]);
    expect(game.fighters[0].x - x).toBe(rules.jumpSpeed);
    while(game.fighters[0].y < 0) step(game);
    expect(game.fighters[0].state).toBe('Landing');
    for(let i=0;i<rules.landingFrames-1;i++) {step(game);expect(game.fighters[0].state).toBe('Landing');}
    step(game); expect(game.fighters[0].state).toBe('Idle');
  });
  it('does not count edge contact and mirrors boxes about their origin', () => {
    expect(overlaps({x:0,y:0,width:10,height:10},{x:10,y:0,width:10,height:10})).toBe(false);
    const f = createGame().fighters[0]; f.x = 0;
    expect(worldBox({x:10,y:-20,width:30,height:40},f,-1).x).toBe(-Math.ceil(40*FIGURE_SCALE));
  });
  it('separates grounded pushboxes against either wall', () => {
    for (const side of [0,rules.stageWidth]) {
      const game = createGame(); game.fighters.forEach(f => f.x = side);
      resolvePushboxes(game.fighters);
      expect(overlaps(...game.fighters.map(pushbox) as [ReturnType<typeof pushbox>,ReturnType<typeof pushbox>])).toBe(false);
      for (const f of game.fighters) { const b = pushbox(f); expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x+b.width).toBeLessThanOrEqual(rules.stageWidth); }
    }
  });
  it('allows an airborne fighter above the other pushbox', () => {
    const game = createGame(); game.fighters[0].x = game.fighters[1].x;
    game.fighters[0].y = -120 * rules.unit;
    resolvePushboxes(game.fighters);
    expect(game.fighters[0].x).toBe(game.fighters[1].x);
  });
});
