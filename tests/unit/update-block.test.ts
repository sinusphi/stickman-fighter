import { FIGURE_SCALE } from '../../src/data/figure-scale';
import { expect, it } from 'vitest';
import { createGame, step } from '../../src/simulation/state';
import { resolveCombat } from '../../src/simulation/combat';
import { MOVES } from '../../src/data/schema';
import { neutralInput } from '../../src/input/types';
import rules from '../../src/data/rules.json';

it.each([false,true])('holds the block pose without walking, then resumes back input (crouch %s)',crouch=>{
  const game=createGame(),[a,b]=game.fighters;
  a.x=400*rules.unit;b.x=440*rules.unit;
  const input={...neutralInput(),right:true,down:crouch};
  // Standing back walks away; crouching back only guards in place.
  const before=b.x;step(game,[neutralInput(),input]);
  if(crouch) {expect(b.x).toBe(before);expect(b.state).toBe('Crouch');} else expect(b.x).toBeGreaterThan(before);
  a.state='Attack';a.moveId=crouch?'standing_lk':'standing_lp';a.moveFrame=MOVES[a.moveId].startup;
  const contactX=b.x;resolveCombat(game);
  expect(game.lastContact?.blocked).toBe(true);
  expect(b.x-contactX).toBe(MOVES[a.moveId].pushbackBlock);
  const x=b.x;
  for(let n=0;n<100;n++) {
    step(game,[neutralInput(),input]);
    if(b.state!=='Blockstun')break;
    expect(b.x).toBe(x);expect(b.vx).toBe(0);expect(b.crouching).toBe(crouch);
  }
  expect(b.state).toBe(crouch?'Crouch':'Walk');
  expect(b.x-x).toBe(crouch?0:rules.backwardSpeed);
});
it.each([-1,1] as const)('transfers contact pushback at wall %s and permits another guarded contact',facing=>{
  const game=createGame(),[a,b]=game.fighters;
  a.facing=a.attackFacing=facing;b.facing=facing===1?-1:1;
  b.x=facing===1?rules.stageWidth-Math.ceil(16*rules.unit*FIGURE_SCALE):Math.ceil(16*rules.unit*FIGURE_SCALE);a.x=b.x-facing*48*rules.unit;
  b.input.current.direction=4;
  a.state='Attack';a.moveId='standing_lp';a.moveFrame=MOVES.standing_lp.startup;
  const x=a.x;resolveCombat(game);
  expect(b.state).toBe('Blockstun');expect(a.x).toBe(x-facing*MOVES.standing_lp.pushbackBlock);
  // A distinct attack may hit again; input locomotion remains zero.
  a.x=b.x-facing*48*rules.unit;a.attackId++;a.hitTargets=[];
  resolveCombat(game);expect(game.lastContact?.blocked).toBe(true);expect(b.vx).toBe(0);
});
