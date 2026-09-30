import { FIGURE_SCALE } from '../../src/data/figure-scale';
import { describe, expect, it } from 'vitest';
import { createGame, step } from '../../src/simulation/state';
import { buttonBit, neutralInput } from '../../src/input/types';
import { MOVES, validateMoves, type HitLevel } from '../../src/data/schema';
import moveData from '../../src/data/moves.json';
import { canBlock, collectContacts, resolveCombat } from '../../src/simulation/combat';
import { isActionable } from '../../src/simulation/movement';
import rules from '../../src/data/rules.json';

function closeGame(distance = 48) {
  const game = createGame(); game.fighters[0].x = 400*rules.unit; game.fighters[1].x = (400+distance)*rules.unit; return game;
}
function playAttack(button = 'LP', defender = neutralInput()) {
  const game = closeGame();
  step(game, [{ ...neutralInput(), buttons: buttonBit(button as 'LP') },defender]);
  while (!game.lastContact && game.combatFrame < 40) step(game, [neutralInput(),defender]);
  return game;
}

describe('move data', () => {
  it('provides 27 normals and six hold attacks with contiguous frame data', () => {
    expect(Object.values(MOVES).filter(m=>m.command.type==='normal')).toHaveLength(27);
    expect(Object.values(MOVES).filter(m=>m.command.type==='hold')).toHaveLength(6);
    for (const move of Object.values(MOVES)) {
      // startup/active describe the main strike; an early knee group has its own window.
      const early=new Set(move.hitGroups.filter(g=>g.activeFrames).map(g=>g.id));
      const frames=move.frames.map(f=>({...f,hitboxes:f.hitboxes.filter(b=>!early.has(b.hitGroup))}));
      expect(move.frames).toHaveLength(move.startup+move.active+move.recovery);
      if(!move.multiHit || early.size===move.hitGroups.length-1)expect(frames.filter(f=>f.hitboxes.length)).toHaveLength(move.active);
      expect(frames.findIndex(f=>f.hitboxes.length)).toBe(move.startup);
      expect(frames.length-1-[...frames].reverse().findIndex(f=>f.hitboxes.length)).toBe(move.startup+move.active-1);
      expect(move.cancelWindows).toEqual([]);
    }
  });
  it('rejects missing variants, invalid boxes and broken animation references', () => {
    expect(()=>validateMoves(moveData.slice(1))).toThrow();
    const copy = structuredClone(moveData); copy[0].frameRanges[0].pushbox.width = -1;
    expect(()=>validateMoves(copy)).toThrow(); copy[0].frameRanges[0].pushbox.width=8192; copy[0].animation='missing';
    expect(()=>validateMoves(copy)).toThrow();
  });
});

describe('frame combat', () => {
  it('hits on the first active frame, freezes both, and only hits once per execution', () => {
    const game = closeGame();
    step(game,[{...neutralInput(),buttons:1},neutralInput()]);
    for(let i=1;i<MOVES.standing_lp.startup;i++){step(game);expect(game.fighters[1].hp).toBe(1000);}
    step(game);expect(game.fighters[1].hp).toBe(970);expect(game.hitstop).toBe(MOVES.standing_lp.hitstop);
    expect(game.fighters[0].moveFrame).toBe(MOVES.standing_lp.startup);expect(game.fighters[1].remaining).toBe(MOVES.standing_lp.hitstun);
    const frame=game.combatFrame;
    for(let i=0;i<MOVES.standing_lp.hitstop;i++){step(game);expect(game.combatFrame).toBe(frame);expect(game.fighters[1].remaining).toBe(MOVES.standing_lp.hitstun);}
    for(let i=0;i<30;i++)step(game);
    expect(game.fighters[1].hp).toBe(970);expect(game.fighters[0].state).toBe('Idle');
  });
  it.each([[MOVES.standing_lp.startup-1,0],[MOVES.standing_lp.startup,1],[MOVES.standing_lp.startup+MOVES.standing_lp.active-1,1],[MOVES.standing_lp.startup+MOVES.standing_lp.active,0],[MOVES.standing_lp.duration-1,0]])('uses frame %i for %i possible contacts', (frame,count)=>{
    const game=closeGame();const f=game.fighters[0];f.state='Attack';f.moveId='standing_lp';f.moveFrame=frame;
    expect(collectContacts(game)).toHaveLength(count);
  });
  it('replaces a landing air attack with its remaining recovery',()=>{
    const game=createGame(),f=game.fighters[0];f.y=-1;f.vy=512;f.state='Attack';f.moveId='airborne_hk';f.moveFrame=11;f.airAttackUsed=true;
    step(game);expect(f.state).toBe('Landing');expect(f.moveId).toBe(null);expect(f.remaining).toBe(MOVES.airborne_hk.recovery);
  });
  it('locks attack box facing while relative inputs follow a side switch',()=>{
    const game=createGame(),f=game.fighters[0];step(game,[{...neutralInput(),buttons:1},neutralInput()]);
    f.x=game.fighters[1].x+100*rules.unit;step(game,[{...neutralInput(),left:true},neutralInput()]);
    expect(f.facing).toBe(-1);expect(f.attackFacing).toBe(1);expect(f.input.current.direction).toBe(6);
  });
  it.each<[{ direction: number; level: HitLevel; expected: boolean }]>([
    [{direction:1,level:'LOW',expected:true}], [{direction:4,level:'LOW',expected:false}],
    [{direction:1,level:'MID',expected:true}], [{direction:4,level:'MID',expected:true}],
    [{direction:1,level:'HIGH',expected:false}], [{direction:4,level:'HIGH',expected:true}],
    [{direction:2,level:'LOW',expected:false}],
  ])('uses the block matrix %o', ({direction,level,expected})=>{
    const f=createGame().fighters[0];f.input.current.direction=direction as 1;expect(canBlock(f,level)).toBe(expected);
  });
  it.each(['Attack','Landing','JumpSquat','Hitstun','Knockdown','KO'] as const)('cannot block in %s',state=>{
    const f=createGame().fighters[0];f.state=state;f.input.current.direction=4;
    expect(canBlock(f,'MID')).toBe(false);
  });
  it('allows continued guard in blockstun but no aerial guard',()=>{
    const f=createGame().fighters[0];f.state='Blockstun';f.input.current.direction=4;
    expect(canBlock(f,'MID')).toBe(true);f.y=-1;expect(canBlock(f,'MID')).toBe(false);
  });
  it('blocks lows only with down-back, without chip damage',()=>{
    const standing=playAttack('LK',{...neutralInput(),right:true});
    expect(standing.fighters[1].hp).toBe(965);
    const crouching=playAttack('LK',{...neutralInput(),down:true,right:true});
    expect(crouching.fighters[1].hp).toBe(1000);expect(crouching.fighters[1].state).toBe('Blockstun');
  });
  it('lets a high kick whiff a crouching body by geometry',()=>{
    // Up close the rising knee reaches the ducking head; the kick itself still passes over.
    for(const distance of [48,80]) {
      const game=closeGame(distance),crouch={...neutralInput(),down:true};
      for(let i=0;i<MOVES.standing_hk.duration+2;i++)step(game,[{...neutralInput(),buttons:i===0?buttonBit('HK'):0},crouch]);
      expect(game.fighters[1].hp,`${distance}`).toBe(distance===48?1000-MOVES.standing_hk.hitGroups.find(g=>g.id==='knee')!.damage!:1000);
      if(distance===80)expect(game.lastContact).toBe(null);
    }
  });
  it('resolves simultaneous attacks as a trade',()=>{
    const game=closeGame();step(game,[{...neutralInput(),buttons:1},{...neutralInput(),buttons:1}]);
    for(let i=0;i<MOVES.standing_lp.startup;i++)step(game);
    expect(game.fighters.map(f=>f.hp)).toEqual([970,970]);expect(game.fighters.map(f=>f.state)).toEqual(['Hitstun','Hitstun']);
  });
  it('transfers blocked corner pushback to the attacker',()=>{
    const game=closeGame();const [a,b]=game.fighters;b.x=rules.stageWidth-Math.ceil(16*rules.unit*FIGURE_SCALE);a.x=b.x-48*rules.unit;
    const start=a.x;
    step(game,[{...neutralInput(),buttons:1},{...neutralInput(),right:true}]);
    for(let i=0;i<MOVES.standing_lp.startup;i++)step(game,[neutralInput(),{...neutralInput(),right:true}]);
    expect(b.x).toBe(rules.stageWidth-Math.ceil(16*rules.unit*FIGURE_SCALE));expect(a.x).toBe(start-12*rules.unit);
  });
  it('ends an airborne victim jump in knockdown and restores them after landing',()=>{
    const game=closeGame();const [a,b]=game.fighters;a.state='Attack';a.moveId='standing_hp';a.moveFrame=MOVES.standing_hp.startup;
    b.state='Airborne';b.y=-20*rules.unit;b.vy=-10*rules.unit;
    expect(collectContacts(game)).toHaveLength(1);resolveCombat(game);
    expect(b.state).toBe('Knockdown');expect(b.vy).toBe(rules.airHitVelocity);
    for(let i=0;i<100;i++)step(game);
    expect(b.y).toBe(0);expect(b.state).toBe('Idle');
  });
  it('buffers an attack to the first recovery-free frame but rejects an expired press',()=>{
    for(const early of [false,true]){
      const game=createGame();step(game,[{...neutralInput(),buttons:1},neutralInput()]);
      while(game.combatFrame<(MOVES.standing_lp.duration-rules.bufferFrames+(early?0:1)))step(game);
      step(game,[{...neutralInput(),buttons:2},neutralInput()]);
      while(game.combatFrame<=MOVES.standing_lp.duration)step(game);
      expect(game.fighters[0].moveId).toBe(early?null:'standing_mp');
      if(!early)expect(game.fighters[0].moveFrame).toBe(0);
    }
  });
  it('keeps a buffered press alive throughout hitstop',()=>{
    const game=createGame();step(game,[{...neutralInput(),buttons:1},neutralInput()]);
    while(game.combatFrame<MOVES.standing_lp.duration-4)step(game);
    game.hitstop=12;step(game,[{...neutralInput(),buttons:2},neutralInput()]);
    for(let i=0;i<11;i++)step(game);
    while(game.combatFrame<=MOVES.standing_lp.duration)step(game);
    expect(game.fighters[0].moveId).toBe('standing_mp');
  });
  it('uses all stances and permits only one attack per jump',()=>{
    const ground=closeGame();step(ground,[{...neutralInput(),down:true,buttons:2},neutralInput()]);
    expect(ground.fighters[0].moveId).toBe('crouching_mp');
    const game=createGame();const f=game.fighters[0];f.y=-100*rules.unit;f.state='Airborne';f.vy=-100;
    step(game,[{...neutralInput(),buttons:1},neutralInput()]);expect(f.moveId).toBe('airborne_lp');
    while(f.moveId)step(game);expect(f.airAttackUsed).toBe(true);expect(isActionable(f)).toBe(false);
  });
  it('measures actual jab advantage including hitstop',()=>{
    const game=playAttack();for(let i=0;i<35;i++)step(game);expect(game.fighters[0].advantage).toBe(2);expect(game.fighters[1].advantage).toBe(-2);
  });
  it('measures recovery availability even when the player immediately jumps',()=>{
    const game=playAttack();for(let i=0;i<35;i++)step(game,[{...neutralInput(),up:true},neutralInput()]);
    expect(game.fighters[0].advantage).toBe(2);
  });
  it('does not suppress a normal when a recognized special has no move',()=>{
    const game=createGame();step(game,[{...neutralInput(),down:true},neutralInput()]);
    step(game,[{...neutralInput(),down:true,right:true},neutralInput()]);
    step(game,[{...neutralInput(),right:true,buttons:1},neutralInput()]);
    expect(game.fighters[0].input.motions).toContain('236+P');expect(game.fighters[0].moveId).toBe('standing_lp');
  });
  it('can attach a motion move through data and retain its priority through recovery',()=>{
    MOVES.test_special={...MOVES.standing_lp,id:'test_special',command:{type:'motion',directions:[2,3,6],buttons:['LP'],trigger:'pressed',priority:100,motionId:'236+P'}};
    try {
      const game=createGame();step(game,[{...neutralInput(),buttons:1},neutralInput()]);
      while(game.combatFrame<MOVES.standing_lp.duration-4)step(game);
      step(game,[{...neutralInput(),down:true},neutralInput()]);
      step(game,[{...neutralInput(),down:true,right:true},neutralInput()]);
      step(game,[{...neutralInput(),right:true,buttons:1},neutralInput()]);
      step(game);step(game);
      expect(game.fighters[0].moveId).toBe('test_special');expect(game.fighters[0].moveFrame).toBe(0);
    } finally { delete MOVES.test_special; }
  });
});
