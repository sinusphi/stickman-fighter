import { expect, it } from 'vitest';
import { createGame, snapshot, step } from '../../src/simulation/state';
import { createReplay, parseReplay, playReplay, validateSnapshot } from '../../src/debug/replay';
import { MOVES, validateResources } from '../../src/data/schema';
import { neutralInput } from '../../src/input/types';
import { resetRound } from '../../src/simulation/rounds';
import { resolveCombat } from '../../src/simulation/combat';
import legacy from '../fixtures/update-01/legacy-replay.json';
import rules from '../../src/data/rules.json';

function resolveStandingHit(moveId: 'standing_lp' | 'standing_hp', blocked = false, current = 0) {
  const game=createGame(),[attacker,defender]=game.fighters;
  attacker.x=400*rules.unit;defender.x=448*rules.unit;
  attacker.state='Attack';attacker.moveId=moveId;attacker.moveFrame=MOVES[moveId].startup;
  attacker.resources.special.current=current;defender.resources.revenge.current=current;
  if(blocked)defender.input.current.direction=4;
  resolveCombat(game);
  return game;
}

it('rejects replays from before resource gain instead of changing their simulation',()=>{
  expect(()=>parseReplay(legacy)).toThrow(/andere Kampfregeln/);
  const previous=createReplay(createGame());previous.engineVersion='1.2.0';
  expect(()=>parseReplay(previous)).toThrow(/andere Kampfregeln/);
});
it('copies, validates and restores resource values without cross-player aliasing',()=>{
  const game=createGame();game.fighters[0].resources.revenge.current=25;game.fighters[1].resources.special.current=100;
  const copy=snapshot(game);copy.fighters[0].resources.revenge.current=50;
  expect(game.fighters[0].resources.revenge.current).toBe(25);
  expect(game.fighters[1].resources.revenge.current).toBe(0);
  expect(validateSnapshot(JSON.parse(JSON.stringify(game)))).toEqual(game);
  const replay=createReplay(game);replay.frames.push({inputs:[neutralInput(),neutralInput()],events:[]});
  expect(playReplay(replay).fighters.map(f=>f.resources)).toEqual(game.fighters.map(f=>f.resources));
  for(const value of [-1,101,NaN,Infinity,1.5]) {
    const invalid=snapshot(game);invalid.fighters[0].resources.revenge.current=value;
    expect(()=>validateSnapshot(invalid)).toThrow();
  }
  expect(()=>validateResources({...rules.resources,special:{current:0,max:0,gainPerHit:10}})).toThrow();
  expect(()=>validateResources({...rules.resources,special:{current:0,max:100,gainPerHit:-1}})).toThrow();
});
it('gains special for landed hits and revenge for received hits in proportion to base damage',()=>{
  const light=resolveStandingHit('standing_lp'),hard=resolveStandingHit('standing_hp');
  const expected=(damage:number)=>Math.round(damage*rules.resources.special.gainPerHit/100);
  expect(light.fighters[0].resources.special.current).toBe(expected(MOVES.standing_lp.damage));
  expect(light.fighters[1].resources.revenge.current).toBe(expected(MOVES.standing_lp.damage));
  expect(hard.fighters[0].resources.special.current).toBe(expected(MOVES.standing_hp.damage));
  expect(hard.fighters[1].resources.revenge.current).toBe(expected(MOVES.standing_hp.damage));
  expect(hard.fighters[0].resources.special.current).toBeGreaterThan(light.fighters[0].resources.special.current);
});
it('does not gain resources on block and caps both meters at their maximum',()=>{
  const blocked=resolveStandingHit('standing_lp',true);
  expect(blocked.fighters.map(f=>f.resources)).toEqual([rules.resources,rules.resources]);
  const capped=resolveStandingHit('standing_hp',false,99);
  expect(capped.fighters[0].resources.special.current).toBe(rules.resources.special.max);
  expect(capped.fighters[1].resources.revenge.current).toBe(rules.resources.revenge.max);
});
it('preserves both resources for both players between rounds',()=>{
  const game=createGame();
  game.fighters[0].resources.revenge.current=23;game.fighters[0].resources.special.current=41;
  game.fighters[1].resources.revenge.current=67;game.fighters[1].resources.special.current=89;
  const resources=game.fighters.map(f=>structuredClone(f.resources));
  resetRound(game,[neutralInput(),neutralInput()]);
  expect(game.fighters.map(f=>f.resources)).toEqual(resources);
  expect(game.fighters.map(f=>f.hp)).toEqual([rules.maxHealth,rules.maxHealth]);
});
it.each(['match','training'])('resets resource values for %s reset',kind=>{
  const game=createGame();game.fighters[0].resources.revenge.current=100;
  step(game,undefined,[kind==='match'?{type:'reset'}:{type:'training',enabled:true,dummy:'block'}]);
  expect(game.fighters.map(f=>f.resources)).toEqual([rules.resources,rules.resources]);
});
