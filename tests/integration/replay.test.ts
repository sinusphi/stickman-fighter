import { FIGURE_SCALE } from '../../src/data/figure-scale';
import { describe, expect, it } from 'vitest';
import { createGame, snapshot, step } from '../../src/simulation/state';
import { createReplay, hash, parseReplay, playReplay, validateSnapshot, type Replay } from '../../src/debug/replay';
import { neutralInput, type RawInput } from '../../src/input/types';
import type { ControlEvent } from '../../src/simulation/events';
import sequence from '../fixtures/replays/sequence.json';
import { FixedLoop } from '../../src/platform/loop';
import rules from '../../src/data/rules.json';

function scenario(): { replay:Replay; observed:Set<string> } {
  const game=createGame(),replay=createReplay(game),observed=new Set<string>();
  function record(inputs:[RawInput,RawInput],events:ControlEvent[]=[]):void {
    replay.frames.push(structuredClone({inputs,events}));step(game,inputs,events);
    if(game.fighters[0].facing===-1)observed.add('crossup');
    if(game.lastContact?.blocked && game.fighters[0].moveId==='standing_lk')observed.add('blockedLow');
    if(game.fighters.some(f=>f.state==='Knockdown'))observed.add('airHit');
    if(game.lastContact?.blocked && game.fighters[1].x===Math.ceil(16*rules.unit*FIGURE_SCALE) && game.fighters[0].x>48*rules.unit)observed.add('corner');
    if(game.round.phase==='roundOver')observed.add('ko');
    if(game.round.number===2 && game.round.phase==='fighting')observed.add('roundReset');
  }
  for(const segment of sequence)for(let i=0;i<segment.frames;i++)record([{...neutralInput(),...segment.p1},{...neutralInput(),...segment.p2}]);
  for(let attack=0;attack<20 && game.round.phase==='fighting';attack++) {
    for(let i=0;i<20;i++)record([{...neutralInput(),left:true},neutralInput()]);
    record([{...neutralInput(),buttons:4},neutralInput()]);
    for(let i=0;i<60;i++)record([neutralInput(),neutralInput()]);
  }
  for(let i=0;i<150;i++)record([neutralInput(),neutralInput()]);
  record([neutralInput(),neutralInput()],[{type:'training',enabled:true,dummy:'block'}]);
  for(let i=0;i<50;i++)record([{...neutralInput(),left:true},neutralInput()]);
  record([neutralInput(),neutralInput()],[{type:'reset'}]);
  return {replay,observed};
}

describe('replays and snapshots',()=>{
  it('covers a side switch, low guard, airborne hit, corner transfer and round reset',()=>{
    const {observed}=scenario();
    expect([...observed].sort()).toEqual(['airHit','blockedLow','corner','crossup','ko','roundReset']);
  });
  it('replays the same input log twice with identical hashes in every frame',()=>{
    const {replay}=scenario();const first:string[]=[],second:string[]=[];
    const a=playReplay(replay,state=>first.push(hash(state)));
    const b=playReplay(JSON.parse(JSON.stringify(replay)),state=>second.push(hash(state)));
    expect(first).toEqual(second);expect(a).toEqual(b);
    expect(first.length).toBeGreaterThan(1000);
  });
  it('restores snapshots during charge, hitstop, attacks and knockdown',()=>{
    const {replay}=scenario();
    const game=snapshot(replay.initial);const checkpoints:{index:number;state:typeof game}[]=[];const found=new Set<string>();
    for(const [index,entry] of replay.frames.entries()) {
      step(game,entry.inputs,entry.events);
      const labels=[game.hitstop?'hitstop':'',...game.fighters.map(f=>f.state),game.fighters.some(f=>f.input.history.length>=45 && f.input.current.direction===4)?'charge':''];
      for(const label of ['hitstop','Attack','Knockdown','charge'])if(labels.includes(label)&&!found.has(label)){found.add(label);checkpoints.push({index,state:snapshot(game)});}
    }
    expect([...found].sort()).toEqual(['Attack','Knockdown','charge','hitstop']);
    for(const point of checkpoints) {
      const restored=validateSnapshot(JSON.parse(JSON.stringify(point.state)));
      for(const entry of replay.frames.slice(point.index+1))step(restored,entry.inputs,entry.events);
      expect(restored).toEqual(game);
    }
  });
  it('produces the same simulation at 30, 60 and 144 render Hz',()=>{
    const {replay}=scenario();const expected=playReplay(replay);
    for(const rate of [30,60,144]){
      const game=snapshot(replay.initial);const loop=new FixedLoop();let index=0;
      for(let time=0;index<replay.frames.length;time++)loop.advance(time*1000/rate,()=>{
        const frame=replay.frames[index++];if(frame)step(game,frame.inputs,frame.events);
      });
      expect(game).toEqual(expected);
    }
  });
  it('rejects incompatible versions and invalid snapshots or input logs',()=>{
    const replay=createReplay(createGame());
    expect(()=>parseReplay({...replay,dataHash:'bad'})).toThrow();
    expect(()=>parseReplay({...replay,engineVersion:'99'})).toThrow();
    expect(()=>parseReplay({...replay,frames:[{inputs:[{...neutralInput(),buttons:512},neutralInput()],events:[]}]})).toThrow();
    const invalid=snapshot(replay.initial);invalid.fighters[0].state='Attack';
    expect(()=>validateSnapshot(invalid)).toThrow();
    const gap=snapshot(replay.initial);gap.fighters[0].input.history.length=1;
    expect(()=>validateSnapshot(gap)).toThrow();
  });
  it('hashes equivalent property ordering identically',()=>{
    expect(hash({a:1,b:2})).toBe(hash({b:2,a:1}));
  });
});
