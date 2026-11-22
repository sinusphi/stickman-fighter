import { describe, expect, it } from 'vitest';
import { MOVES } from '../../src/data/schema';
import { canBlock, collectContacts, resolveCombat } from '../../src/simulation/combat';
import { createGame } from '../../src/simulation/state';
import { neutralInput } from '../../src/input/types';
import rules from '../../src/data/rules.json';

function contactGame(id = 'standing_lp', crouching = false) {
  const game=createGame(), [a,b]=game.fighters;
  a.x=400*rules.unit;b.x=442*rules.unit;
  a.state='Attack';a.moveId=id;a.moveFrame=MOVES[id].startup;
  b.input.current.direction=crouching?1:4;b.crouching=crouching;
  return game;
}

describe('posture and blocked damage',()=>{
  it('applies attack origin before hit level for manual and automatic guard in both facings',()=>{
    for(const facing of [-1,1] as const) for(const automatic of [false,true])
      for(const origin of ['standing','crouching','airborne'] as const)
        for(const level of ['LOW','MID','HIGH'] as const) for(const crouching of [false,true]) {
          const f=createGame().fighters[0];f.facing=facing;f.crouching=crouching;
          f.input.current.direction=automatic?(crouching?2:5):(crouching?1:4);
          f.input.previous={...neutralInput(),down:crouching};
          const required=origin==='airborne'?false:origin==='crouching'||level!=='HIGH';
          expect(canBlock(f,level,automatic,origin)).toBe(crouching===required);
          f.state='Blockstun';expect(canBlock(f,level,automatic,origin)).toBe(crouching===required);
        }
  });
  it.each(['crouching_lp','airborne_lp'])('passes the origin of %s through actual contact collection',id=>{
    for(const crouching of [false,true]) for(const automatic of [false,true]) {
      const game=contactGame(id,crouching),[a,b]=game.fighters;
      if(id==='airborne_lp')a.y=-rules.unit;
      if(automatic) {
        game.inputConfig.autoBlock=[false,true];
        b.input.current.direction=crouching?2:5;b.input.previous={...neutralInput(),down:crouching};
      }
      expect(collectContacts(game)).toHaveLength(1);
      resolveCombat(game);
      expect(game.lastContact?.blocked).toBe(crouching===(id==='crouching_lp'));
    }
  });
  it('requires standing guard when a normally grounded attack is airborne',()=>{
    const game=contactGame('standing_mp',false);game.fighters[0].y=-rules.unit;
    resolveCombat(game);expect(game.lastContact?.blocked).toBe(true);
  });
  it.each([0,500,1000,1500])('uses scaled full-hit damage for eight percent chip at scale %s',scale=>{
    const game=contactGame(),[a,b]=game.fighters;a.damageScalePermille=scale;
    resolveCombat(game);
    expect(game.lastContact?.blocked).toBe(true);
    expect(b.hp).toBe(rules.maxHealth-Math.round(Math.trunc(MOVES.standing_lp.damage*scale/rules.damageScaleUnit)*.08));
    expect(b.state).toBe('Blockstun');expect(a.comboCount).toBe(0);
    expect(a.resources.special.current).toBe(Math.max(1,Math.round(MOVES.standing_lp.damage*rules.resources.special.gainPerBlock/100)));expect(b.resources.revenge.current).toBe(0);
  });
  it('uses the damage of the contacting knee group rather than the main kick',()=>{
    const game=contactGame('standing_mk',true),[a,b]=game.fighters;
    const knee=MOVES.standing_mk.hitGroups.find(g=>g.id==='knee')!;
    a.moveFrame=knee.activeFrames![0];
    expect(collectContacts(game)).toHaveLength(1);resolveCombat(game);
    expect(game.lastContact?.blocked).toBe(true);
    expect(b.hp).toBe(rules.maxHealth-Math.round(knee.damage!*.08));
  });
  it.each([false,true])('handles lethal chip while preserving training health (training %s)',training=>{
    const game=contactGame(),b=game.fighters[1];b.hp=1;game.training.enabled=training;
    resolveCombat(game);expect(game.lastContact?.blocked).toBe(true);
    expect(b.hp).toBe(training?1:0);expect(b.state).toBe(training?'Blockstun':'KO');
  });
});
