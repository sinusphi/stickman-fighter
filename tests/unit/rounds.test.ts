import { describe, expect, it } from 'vitest';
import { createGame, step } from '../../src/simulation/state';
import { neutralInput } from '../../src/input/types';
import { MOVES } from '../../src/data/schema';
import rules from '../../src/data/rules.json';

describe('round and match rules',()=>{
  it('counts exactly 5940 active frames and repeats a tied timeout',()=>{
    const game=createGame();for(let i=0;i<5939;i++)step(game);
    expect(game.round.timer).toBe(1);expect(game.round.phase).toBe('fighting');step(game);
    expect(game.round.phase).toBe('roundOver');expect(game.round.reason).toBe('DRAW');expect(game.round.wins).toEqual([0,0]);
    for(let i=0;i<120;i++)step(game);
    expect(game.round.phase).toBe('fighting');expect(game.round.timer).toBe(5940);expect(game.round.number).toBe(1);
  });
  it('stops the round timer during hitstop',()=>{
    const game=createGame();game.hitstop=10;for(let i=0;i<10;i++)step(game);
    expect(game.round.timer).toBe(5940);step(game);expect(game.round.timer).toBe(5939);
  });
  it('awards time over to the remaining health leader',()=>{
    const game=createGame();game.round.timer=1;game.fighters[0].hp=800;step(game);
    expect(game.round.winner).toBe(1);expect(game.round.reason).toBe('TIME OVER');expect(game.round.wins).toEqual([0,1]);
  });
  it('resolves lethal contact before a same-frame timeout',()=>{
    const game=createGame();const [a,b]=game.fighters;a.x=400*rules.unit;b.x=448*rules.unit;b.hp=30;
    step(game,[{...neutralInput(),buttons:1},neutralInput()]);for(let i=0;i<MOVES.standing_lp.startup-1;i++)step(game);
    game.round.timer=1;step(game);expect(game.round.reason).toBe('KO');expect(b.state).toBe('KO');expect(game.round.winner).toBe(0);
  });
  it('handles double KO without awarding a win',()=>{
    const game=createGame();const [a,b]=game.fighters;a.x=400*rules.unit;b.x=448*rules.unit;a.hp=30;b.hp=30;
    step(game,[{...neutralInput(),buttons:1},{...neutralInput(),buttons:1}]);for(let i=0;i<MOVES.standing_lp.startup;i++)step(game);
    expect(game.round.reason).toBe('DOUBLE KO');expect(game.round.wins).toEqual([0,0]);
  });
  it('resets transient state and requires two wins to end the match',()=>{
    const game=createGame();game.fighters[1].hp=0;step(game);
    expect(game.round.wins).toEqual([1,0]);
    game.fighters[0].input.pending={button:'LP',expires:9999,motions:[]};
    for(let i=0;i<120;i++)step(game,[{...neutralInput(),buttons:1},neutralInput()]);
    expect(game.round.number).toBe(2);expect(game.fighters[0].input.pending).toBe(null);expect(game.fighters[1].hp).toBe(1000);
    step(game,[{...neutralInput(),buttons:1},neutralInput()]);expect(game.fighters[0].state).toBe('Idle');
    game.fighters[1].hp=0;step(game);expect(game.round.phase).toBe('matchOver');expect(game.round.wins).toEqual([2,0]);
    for(let i=0;i<200;i++)step(game);expect(game.round.phase).toBe('matchOver');
  });
});
