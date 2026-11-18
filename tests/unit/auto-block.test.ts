import { describe, expect, it } from 'vitest';
import { createGame, step } from '../../src/simulation/state';
import { MOVES } from '../../src/data/schema';
import { canBlock, resolveCombat } from '../../src/simulation/combat';
import { buttonBit, neutralInput, BUTTONS } from '../../src/input/types';
import { createReplay, parseReplay, hash } from '../../src/debug/replay';
import { DEFAULT_CONTROLS, validateControls } from '../../src/platform/devices';
import type { FighterState } from '../../src/simulation/types';

describe('automatic guard and crouching controls', () => {
  it('uses the same posture rules for neutral, down and down-back on either side', () => {
    for (const facing of [-1,1] as const) for (let mask=0;mask<16;mask++) {
      const game=createGame(), f=game.fighters[0];
      f.x=facing===1?100000:200000;game.fighters[1].x=facing===1?200000:100000;
      const raw={...neutralInput(),left:!!(mask&1),right:!!(mask&2),up:!!(mask&4),down:!!(mask&8)};
      step(game,[raw,neutralInput()]);
      const forward=facing===1?raw.right:raw.left;
      const allowed=!raw.up&&!forward;
      for(const level of ['LOW','MID','HIGH'] as const) {
        expect(canBlock(f,level,true),`${facing}/${mask}/${level}`).toBe(allowed && raw.down === (level!=='HIGH'));
      }
    }
  });
  it('rejects every held attack and quick tap even when a forbidden crouch kick does not start', () => {
    for(const button of BUTTONS) for(const tap of [false,true]) {
      const game=createGame();const raw={...neutralInput(),down:true,buttons:tap?0:buttonBit(button),taps:tap?buttonBit(button):0};
      step(game,[raw,neutralInput()]);
      expect(canBlock(game.fighters[0],'MID',true)).toBe(false);
    }
  });
  it.each(['Attack','JumpSquat','Airborne','Landing','Hitstun','Knockdown','KO'] as FighterState[])('does not auto-guard in %s',state=>{
    const f=createGame().fighters[0];f.state=state;expect(canBlock(f,'MID',true)).toBe(false);
  });
  it('continues automatic guard during blockstun and keeps down-only crouching',()=>{
    const game=createGame();game.inputConfig.autoBlock=[false,true];
    game.fighters[0].x=100000;game.fighters[1].x=112288;
    step(game,[{...neutralInput(),buttons:buttonBit('MP')},{...neutralInput(),down:true}]);
    for(let i=0;i<12&&!game.lastContact;i++)step(game,[neutralInput(),{...neutralInput(),down:true}]);
    expect(game.lastContact?.blocked).toBe(true);expect(game.fighters[1].hp).toBe(1000-Math.round(MOVES.standing_mp.damage*.08));
    expect(game.fighters[1].crouching).toBe(true);expect(game.fighters[1].state).toBe('Blockstun');
    step(game,[neutralInput(),{...neutralInput(),down:true}]);
    expect(game.fighters[1].crouching).toBe(true);expect(canBlock(game.fighters[1],'MID',true)).toBe(true);expect(canBlock(game.fighters[1],'HIGH',true)).toBe(false);
  });
  it('can disable the setting and preserves it through reset and replay',()=>{
    const game=createGame();step(game,undefined,[{type:'inputConfig',config:{...game.inputConfig,autoBlock:[true,false]}},{type:'reset'}]);
    expect(game.inputConfig.autoBlock).toEqual([true,false]);
    const replay=parseReplay(JSON.parse(JSON.stringify(createReplay(game))));
    expect(hash(replay.initial)).toBe(hash(game));
    step(game,undefined,[{type:'inputConfig',config:{...game.inputConfig,autoBlock:[false,false]}}]);
    expect(canBlock(game.fighters[0],'MID',game.inputConfig.autoBlock?.[0])).toBe(false);
    replay.initial.inputConfig.autoBlock=['yes',false] as unknown as [boolean,boolean];
    expect(()=>parseReplay(JSON.parse(JSON.stringify(replay)))).toThrow();
  });
  it('accepts old controls and persists independent validated player switches',()=>{
    const controls=structuredClone(DEFAULT_CONTROLS);expect(validateControls(controls).players[0].autoBlock).toBeUndefined();
    controls.players[0].autoBlock=true;controls.players[1].autoBlock=false;
    expect(validateControls(JSON.parse(JSON.stringify(controls))).players.map(p=>p.autoBlock)).toEqual([true,false]);
    controls.players[0].autoBlock=1 as unknown as boolean;expect(()=>validateControls(controls)).toThrow();
  });
  it('only allows LK/RLK crouch kicks and discards forbidden buffers before standing',()=>{
    for(const button of ['LK','RLK','LMK','MK','HK','RHK'] as const) {
      const game=createGame();step(game,[{...neutralInput(),down:true,buttons:buttonBit(button)},neutralInput()]);
      const allowed=button==='LK'||button==='RLK';expect(game.fighters[0].moveId).toBe(allowed?`crouching_${button.toLowerCase()}`:null);
      if(!allowed){step(game);expect(game.fighters[0].moveId).toBe(null);expect(game.fighters[0].input.pending).toBe(null);}
    }
  });
  it('holds position in all crouch directions for both facings',()=>{
    for(const facing of [-1,1])for(const horizontal of ['left','right',null] as const){
      const game=createGame(),f=game.fighters[0];f.x=facing===1?100000:200000;game.fighters[1].x=facing===1?200000:100000;const x=f.x;
      for(let i=0;i<20;i++)step(game,[{...neutralInput(),down:true,...(horizontal?{[horizontal]:true}:{})},neutralInput()]);
      expect(f.x).toBe(x);expect(f.vx).toBe(0);expect(f.state).toBe('Crouch');
    }
  });
});

// Real move data must reach the same guard path as synthetic HIGH test cases.
it.each([
  ['standing_lp','main'],['standing_hp','main'],['standing_hk','main'],['standing_rhk','main'],
  ['spin_hk','main'],['dwit_chagi','main'],['jumping_uppercut','main'],
  ['spin_high_middle_combo','high'],['middle_high_low_combo','high'],
])('automatically blocks the actual high strike %s/%s while standing neutral', (id,groupId)=>{
  for(const facing of [-1,1] as const) for(const autoBlock of [false,true]) {
    const move=MOVES[id], group=move.hitGroups.find(g=>g.id===groupId)!;
    expect(group.hitLevel??move.hitLevel).toBe('HIGH');
    const frame=move.frames.findIndex(f=>f.hitboxes.some(b=>b.hitGroup===groupId));
    const game=createGame(),[a,b]=game.fighters;
    a.x=480*256;b.x=a.x+facing*42*256;
    a.facing=a.attackFacing=facing;b.facing=b.attackFacing=facing===1?-1:1;
    a.state='Attack';a.moveId=id;a.moveFrame=frame;
    game.inputConfig.autoBlock=[false,autoBlock];
    resolveCombat(game);
    expect(game.lastContact,`${id}/${facing}`).not.toBe(null);
    expect(game.lastContact?.blocked).toBe(autoBlock);
    expect(b.crouching).toBe(false);
    expect(b.state).toBe(autoBlock?'Blockstun':'Hitstun');
    const damage=group.damage??move.damage;
    expect(b.hp).toBe(1000-(autoBlock?Math.round(damage*.08):damage));
  }
});

it.each(['HK','RHK'] as const)('blocks the knee then %s when switching from down to neutral',button=>{
  for(const facing of [-1,1]) {
    const game=createGame(),[a,b]=game.fighters;
    a.x=480*256;b.x=a.x+facing*42*256;game.inputConfig.autoBlock=[false,true];
    const contacts: {level:string|undefined;blocked:boolean}[]=[];
    let lastFrame=-1;
    for(let i=0;i<90;i++) {
      step(game,[{...neutralInput(),buttons:i===0?buttonBit(button):0},{...neutralInput(),down:contacts.length===0}]);
      if(game.lastContact&&game.lastContact.frame!==lastFrame) {
        lastFrame=game.lastContact.frame;
        contacts.push({level:game.lastContact.hitLevel,blocked:game.lastContact.blocked});
      }
    }
    expect(contacts).toEqual([{level:'MID',blocked:true},{level:'HIGH',blocked:true}]);
    expect(b.hp).toBe(1000-Math.round(30*.08)-Math.round(95*.08));
  }
});
