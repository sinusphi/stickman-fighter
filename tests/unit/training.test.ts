import { describe, expect, it } from 'vitest';
import { createGame, step } from '../../src/simulation/state';
import { neutralInput } from '../../src/input/types';
import { FixedLoop } from '../../src/platform/loop';
import { MOVES } from '../../src/data/schema';
import rules from '../../src/data/rules.json';

describe('training and frame control',()=>{
  it('holds the timer and ignores player two device input',()=>{
    const game=createGame();step(game,[neutralInput(),neutralInput()],[{type:'training',enabled:true,dummy:'crouch'}]);
    const x=game.fighters[1].x;
    for(let i=0;i<100;i++)step(game,[neutralInput(),{...neutralInput(),right:true,buttons:7}]);
    expect(game.round.timer).toBe(5940);expect(game.fighters[1].state).toBe('Crouch');expect(game.fighters[1].x).toBe(x);
  });
  it('lets the CPU training dummy use the supplied second-player input and move',()=>{
    const game=createGame();game.training={enabled:true,dummy:'cpu'};
    const x=game.fighters[1].x;
    step(game,[neutralInput(),{...neutralInput(),left:true}]);
    expect(game.round.timer).toBe(5940);expect(game.fighters[1].state).toBe('Walk');expect(game.fighters[1].x).not.toBe(x);
  });
  it('keeps both fighters at their current health and prevents KOs on training hits',()=>{
    const game=createGame();game.training={enabled:true,dummy:'cpu'};
    game.fighters[0].x=400*rules.unit;game.fighters[1].x=448*rules.unit;
    game.fighters[0].hp=1;game.fighters[1].hp=1;
    for(const fighter of game.fighters) {
      fighter.state='Attack';fighter.moveId='standing_lp';fighter.moveFrame=MOVES.standing_lp.startup;
    }
    step(game);
    expect(game.fighters.map(f=>f.hp)).toEqual([1,1]);
    expect(game.fighters.map(f=>f.state)).toEqual(['Hitstun','Hitstun']);
    expect(game.round.phase).toBe('fighting');expect(game.round.reason).toBe(null);
  });
  it('blocks a low without drifting and remains vulnerable during recovery',()=>{
    const game=createGame();game.training={enabled:true,dummy:'block'};
    game.fighters[0].x=400*rules.unit;game.fighters[1].x=448*rules.unit;
    for(let i=0;i<20;i++)step(game);expect(game.fighters[1].x).toBe(448*rules.unit);
    step(game,[{...neutralInput(),buttons:8},neutralInput()]);for(let i=0;i<MOVES.standing_lk.startup;i++)step(game);
    expect(game.fighters[1].hp).toBe(1000);expect(game.fighters[1].state).toBe('Blockstun');
    const exposed=createGame();exposed.training={enabled:true,dummy:'block'};
    exposed.fighters[0].x=400*rules.unit;exposed.fighters[1].x=448*rules.unit;
    exposed.fighters[1].state='Attack';exposed.fighters[1].moveId='standing_hk';exposed.fighters[1].moveFrame=MOVES.standing_hk.startup+MOVES.standing_hk.active+1;
    step(exposed,[{...neutralInput(),buttons:1},neutralInput()]);for(let i=0;i<MOVES.standing_lp.startup;i++)step(exposed);
    expect(exposed.fighters[1].hp).toBe(1000);expect(exposed.fighters[1].state).toBe('Hitstun');
  });
  it('records reset and config changes as explicit simulation events',()=>{
    const game=createGame();game.fighters[0].hp=200;game.hitstop=5;
    step(game,[neutralInput(),neutralInput()],[{type:'inputConfig',config:{socd:{horizontal:'lastInputWins',vertical:'neutral'},bufferFrames:7}},{type:'reset'}]);
    expect(game.fighters[0].hp).toBe(1000);expect(game.hitstop).toBe(0);expect(game.inputConfig.bufferFrames).toBe(7);
  });
  it('allows exactly one manual simulation step while the loop is paused',()=>{
    const game=createGame(),loop=new FixedLoop();loop.paused=true;
    loop.advance(0,()=>step(game));loop.advance(100,()=>step(game));expect(game.frame).toBe(0);
    step(game);expect(game.frame).toBe(1);
    loop.advance(120,()=>step(game));expect(game.frame).toBe(1);
  });
});
