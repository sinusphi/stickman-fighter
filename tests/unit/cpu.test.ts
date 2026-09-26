import { describe, expect, it } from 'vitest';
import { CpuPlayer } from '../../src/ai';
import { UtilityBrain, type Intent } from '../../src/ai/brain';
import { Controller, directionInput } from '../../src/ai/controller';
import { KNOWLEDGE, MOVE_INFO, buildKnowledge, nextHitLevel, scaledBox } from '../../src/ai/knowledge';
import { observe, Perception } from '../../src/ai/observation';
import { PROFILES, loadCpuSettings, saveCpuSettings, validateProfiles, type Difficulty } from '../../src/ai/profiles';
import { Rng } from '../../src/ai/rng';
import { MOVES } from '../../src/data/schema';
import rules from '../../src/data/rules.json';
import { buttonBit, neutralInput } from '../../src/input/types';
import { createGame, snapshot, step } from '../../src/simulation/state';
import { worldBox } from '../../src/simulation/collision';
import { createReplay, playReplay, validRaw } from '../../src/debug/replay';
import { tournament } from '../../scripts/cpu-tournament-lib';
const levels: Difficulty[]=['easy','medium','hard'];
const attack = (moveId:string): Intent => ({kind:'attack',moveId,score:1,reason:'test'});

it('validates the shipped profiles and rejects unfair/non-finite parameters',()=>{
  expect(validateProfiles(PROFILES)).toBe(PROFILES);
  for(const [key,value] of [['reactionFrames',7],['reactionFrames',Infinity],['blockChance',1],['executionError',0],['aggression',NaN],['decisionFrames',0],['attackPauseFrames',-1]]) {
    const profiles=structuredClone(PROFILES);Object.assign(profiles.hard,{[key]:value});
    expect(()=>validateProfiles(profiles)).toThrow('CPU-Profil');
  }
});
it('gives easy CPU a clear thinking break after every completed attack',()=>{
  const g=createGame(),cpu=new CpuPlayer('easy',1,()=>({decide:()=>attack('standing_lp')}));
  const starts:number[]=[];let previous=0;
  for(let i=0;i<500;i++) {
    step(g,[neutralInput(),cpu.next(g)]);
    if(g.fighters[1].attackId!==previous) { previous=g.fighters[1].attackId;starts.push(g.frame); }
  }
  expect(starts.length).toBeGreaterThanOrEqual(3);
  for(let i=1;i<starts.length;i++)
    expect(starts[i]-starts[i-1]).toBeGreaterThanOrEqual(MOVES.standing_lp.duration+PROFILES.easy.attackPauseFrames);
});
it('loads only valid preferences and tolerates blocked storage',()=>{
  const storage={getItem:()=>JSON.stringify({enabled:true,difficulty:'hard'}),setItem:()=>{throw Error('quota');}};
  expect(loadCpuSettings(storage)).toEqual({enabled:true,demo:false,difficulty:'hard',playerOneDifficulty:'medium'});
  expect(()=>saveCpuSettings(storage,{enabled:true,demo:true,difficulty:'hard',playerOneDifficulty:'easy'})).not.toThrow();
  expect(loadCpuSettings({getItem:()=>{throw Error('disabled');}})).toEqual({enabled:false,demo:false,difficulty:'medium',playerOneDifficulty:'medium'});
  expect(loadCpuSettings({getItem:()=>'{broken'}).enabled).toBe(false);
  expect(loadCpuSettings({getItem:()=>'{"enabled":true,"difficulty":"__proto__"}'}).enabled).toBe(false);
});
it('derives every move, group, scaled edge and advance without an ID allowlist',()=>{
  expect(KNOWLEDGE.map(m=>m.id)).toEqual(Object.keys(MOVES));
  const f=createGame().fighters[0];f.x=f.y=0;f.facing=1;
  for(const m of Object.values(MOVES))for(const [frame,boxes] of m.frames.entries())for(const b of boxes.hitboxes) {
    expect(scaledBox(b)).toEqual(worldBox({x:b.x,y:b.y,width:b.width,height:b.height},f));
    const known=MOVE_INFO[m.id].boxes.find(k=>k.frame===frame&&k.group===b.hitGroup)!;
    const t=m.advance?Math.min(1,frame/m.advance.frames):0;
    expect(known.x).toBe(scaledBox(b).x+Math.round((m.advance?.distance??0)*t*t*(3-2*t)));
    expect(known.level).toBe(m.hitGroups.find(g=>g.id===b.hitGroup)?.hitLevel??m.hitLevel);
  }
  const copy={...MOVES.standing_lp,id:'future_move'};
  expect(buildKnowledge({future_move:copy})[0].id).toBe('future_move');
  const combo=MOVE_INFO.tornado_spin_combo;
  expect(nextHitLevel(combo.id,0)).toBe('MID');
  expect(nextHitLevel(combo.id,combo.boxes.find(b=>b.level==='HIGH')!.frame)).toBe('HIGH');
});
it('perception copies only visible fields and waits a full delay even on initial attack',()=>{
  const g=createGame(),p=new Perception(10);g.fighters[0].state='Attack';g.fighters[0].moveId='standing_lk';
  Object.defineProperty(g.fighters[0],'input',{get:()=>{throw Error('hidden input read');}});
  for(let frame=0;frame<=10;frame++) {
    g.frame=frame;const view=p.next(observe(g),1);
    expect(view.opponent===null).toBe(frame<10);
    expect('input' in view.self).toBe(false);
  }
  const copied=observe(g);g.fighters[0].resources.special.current=12;
  expect(copied.fighters[0].resources.special.current).toBe(0);
});
it.each(levels)('%s responds to a visible attack only after reactionFrames using real step',level=>{
  const g=createGame(),seen:number[]=[];
  const cpu=new CpuPlayer(level,1,()=>({decide:v=>{
    if(v.opponent?.state==='Attack')seen.push(v.frame);
    return {kind:'wait',score:0,reason:'test'};
  }}));
  for(let i=0;i<40;i++)step(g,[neutralInput(),cpu.next(g)]);
  step(g,[{...neutralInput(),buttons:buttonBit('HK')},cpu.next(g)]);
  const visibleAt=g.frame;
  for(let i=0;i<35;i++)step(g,[neutralInput(),cpu.next(g)]);
  expect(seen[0]).toBe(visibleAt+PROFILES[level].reactionFrames);
});
it('opponent pending/current/history/motions/previous cannot influence output',()=>{
  const a=createGame(),b=snapshot(a),x=new CpuPlayer('hard'),y=new CpuPlayer('hard');x.reset(91);y.reset(91);
  for(let frame=0;frame<400;frame++) {
    a.frame=b.frame=frame;
    const input=b.fighters[0].input;
    input.pending={button:'HK',expires:9999,motions:['secret']};input.motions=['secret'];
    input.current={frame,direction:6,pressed:511,held:511,released:0};input.history.frames.fill(input.current);input.previous.buttons=511;
    expect(x.next(a)).toEqual(y.next(b));
  }
});

describe('generic move controller',()=>{
  it.each(Object.keys(MOVES))('%s executes both ways, after crossing sides, and after held buttons',id=>{
    for(const facing of [-1,1] as const)for(const crossing of [false,true]) {
      const g=createGame(),s=g.fighters[1],o=g.fighters[0],controller=new Controller();
      s.x=480*rules.unit;o.x=s.x+facing*300*rules.unit;s.facing=s.attackFacing=facing;
      s.input.previous.buttons=511;s.crouching=true;s.state='Crouch';
      controller.set(attack(id),observe(g).fighters[1]);
      step(g,[neutralInput(),controller.next(observe(g).fighters[1])]);
      if(crossing){o.x=s.x-facing*300*rules.unit;s.facing=(facing*-1) as -1|1;}
      let triggered=false;
      for(let i=0;i<20;i++) {
        const raw=controller.next(observe(g).fighters[1]);expect(validRaw(raw)).toBe(true);
        step(g,[neutralInput(),raw]);
        if(s.moveId===id){triggered=true;expect(s.attackFacing).toBe(crossing?-facing:facing);break;}
      }
      expect(triggered,id).toBe(true);
    }
  });
  it('releases attacks, does not use taps, and produces a fresh repeat edge',()=>{
    const g=createGame(),c=new Controller();
    for(let repeat=0;repeat<2;repeat++) {
      c.set(attack('standing_lp'),observe(g).fighters[1]);
      for(let i=0;i<30;i++) {
        const input=c.next(observe(g).fighters[1]);expect(input.taps).toBeUndefined();step(g,[neutralInput(),input]);
      }
    }
    expect(g.fighters[1].attackId).toBe(2);
  });
});

it.each(['standing_lk','standing_mk','forward_spin_hk'])('blocks %s at the correct height with a test-only perfect guard',id=>{
  for(const facing of [-1,1] as const) {
    const g=createGame(),a=g.fighters[0],b=g.fighters[1],controller=new Controller();
    b.x=(facing===1?rules.stageWidth-25*rules.unit:25*rules.unit);a.x=b.x-facing*55*rules.unit;a.facing=a.attackFacing=facing;b.facing=b.attackFacing=-facing as -1|1;
    const cpu=new CpuPlayer('hard',1,(p,rng)=>{
      const brain=new UtilityBrain({...p,blockChance:1,correctBlockChance:1,executionError:0},rng);
      return {decide:v=>v.opponent?.state==='Attack'?brain.decide(v):{kind:'wait',score:0,reason:'test guard'}};
    });
    for(let i=0;i<20;i++)step(g,[neutralInput(),cpu.next(g)]);
    controller.set(attack(id),observe(g).fighters[0]);
    let blocked=false;
    for(let i=0;i<MOVES[id].duration+20;i++) {
      step(g,[controller.next(observe(g).fighters[0]),cpu.next(g)]);
      if(b.state==='Blockstun')blocked=true;
    }
    expect(b.hp).toBe(rules.maxHealth);expect(blocked).toBe(true);
  }
});
it('identical seeds/inputs reproduce an entire match and replay without a brain',()=>{
  function run() {
    const g=createGame(),cpu=new CpuPlayer('hard');cpu.reset(12345);const replay=createReplay(g);
    while(g.round.phase!=='matchOver' && g.frame<18000) {
      const inputs:[ReturnType<typeof neutralInput>,ReturnType<typeof neutralInput>]=[neutralInput(),cpu.next(g)];
      if(!validRaw(inputs[1]))throw Error('invalid input');
      replay.frames.push({inputs,events:[]});step(g,inputs);
    }
    expect(g.round.phase).toBe('matchOver');return {g,replay};
  }
  const a=run(),b=run();expect(a.replay.frames).toEqual(b.replay.frames);expect(a.g).toEqual(b.g);
  expect(playReplay(a.replay)).toEqual(a.g);
});
it.each(levels)('%s KOs a passive player within the round and varies its attacks',level=>{
  const g=createGame(),cpu=new CpuPlayer(level);cpu.reset(231);
  const moves=new Set<string>();
  while(g.round.phase==='fighting'&&g.frame<9000) {
    step(g,[neutralInput(),cpu.next(g)]);if(g.fighters[1].moveId)moves.add(g.fighters[1].moveId);
  }
  expect(g.round.winner).toBe(1);expect(g.round.reason).toBe('KO');expect(g.round.timer).toBeGreaterThan(0);
  expect(moves.size).toBeGreaterThan(3);
  expect(moves).toContain('tornado_spin_combo');
});
it.each(levels)('%s executes a jumping uppercut against a nearby passive player',level=>{
  for(const facing of [-1,1] as const) {
    const g=createGame(),cpu=new CpuPlayer(level);cpu.reset(231);
    g.fighters[1].x=400*rules.unit;g.fighters[0].x=(400+facing*36)*rules.unit;
    let used=false;
    for(let i=0;i<1800 && g.round.phase==='fighting';i++) {
      step(g,[neutralInput(),cpu.next(g)]);
      if(g.fighters[1].moveId==='jumping_uppercut') {used=true;break;}
    }
    expect(used,`${level} facing ${facing}`).toBe(true);
  }
});
it.each(levels)('%s keeps moving/attacking against a blocker and does not camp in a corner',level=>{
  const g=createGame(),cpu=new CpuPlayer(level);cpu.reset(73);g.fighters[1].x=rules.stageWidth-40*rules.unit;
  let stalled=0,maxStall=0,corner=0,total=0;
  for(let i=0;i<1800&&g.round.phase==='fighting';i++) {
    const before=g.fighters[1].x,attackId=g.fighters[1].attackId;
    step(g,[directionInput(4,g.fighters[0].facing),cpu.next(g)]);
    const s=g.fighters[1];stalled=(s.x===before&&s.attackId===attackId)?stalled+1:0;maxStall=Math.max(maxStall,stalled);
    // Attacking an opponent pinned against the wall is pressure, not camping.
    const opponent=g.fighters[0];
    if(Math.min(s.x,rules.stageWidth-s.x)<110*rules.unit &&
      (opponent.x-s.x)*(rules.stageWidth/2-s.x)>0)corner++;total++;
  }
  expect(maxStall).toBeLessThan(3*rules.hz);
  // Easy is intentionally vulnerable to sustained corner pressure; it must still act instead of freezing.
  expect(corner/total).toBeLessThan(level==='easy'?.9:.25);
  expect(g.fighters[0].hp).toBeLessThan(rules.maxHealth);
});
it('clears queues in hitstop, stun, KO, training, round/match over and resets',()=>{
  for(const mode of ['hitstop','Hitstun','Blockstun','Knockdown','KO','roundOver','matchOver','training','reset']) {
    const g=createGame(),cpu=new CpuPlayer('hard',1,()=>({decide:()=>attack('tornado_spin_combo')}));
    for(let i=0;i<=10;i++) {cpu.next(g);g.frame++;}
    if(mode==='hitstop')g.hitstop=1;
    else if(mode==='roundOver'||mode==='matchOver')g.round.phase=mode;
    else if(mode==='training')g.training.enabled=true;
    else if(mode==='reset') {cpu.reset(3);step(g,undefined,[{type:'reset'}]);}
    else g.fighters[1].state=mode as 'Hitstun';
    expect(cpu.next(g),mode).toEqual(neutralInput());
    if(mode!=='reset') {g.frame++;g.hitstop=0;g.round.phase='fighting';g.training.enabled=false;g.fighters[1].state='Idle';}
    expect(cpu.next(g).buttons,mode).toBe(0);
  }
});
it('seeded PRNG reproduces its stream and different seeds differ',()=>{
  const a=new Rng(1),b=new Rng(1),c=new Rng(2);
  for(let i=0;i<100;i++){expect(a.next()).toBe(b.next());expect(c.next()).toBeGreaterThanOrEqual(0);}
  expect(new Rng(1).next()).not.toBe(new Rng(2).next());
});
it.each([['hard','medium'],['medium','easy']] as const)('%s beats %s in the small balanced regression tournament',(a,b)=>{
  const result=tournament(a,b,10);expect(result.winsA).toBeGreaterThanOrEqual(7);
});
it('selects the fastest reachable punish only when its startup fits perceived recovery',()=>{
  const g=createGame();g.fighters[0].x=400*rules.unit;g.fighters[1].x=450*rules.unit;
  const o=g.fighters[0];o.state='Attack';o.moveId='standing_hp';o.moveFrame=MOVES.standing_hp.duration-12;
  const view={frame:100,self:observe(g).fighters[1],opponent:observe(g).fighters[0],round:g.round,hitstop:0,lastContact:null};
  const brain=new UtilityBrain({...PROFILES.hard,punishChance:1,executionError:0},new Rng(12));
  const intent=brain.decide(view);
  expect(intent.kind).toBe('attack');expect(intent.reason).toBe('punish');
  if(intent.kind==='attack')expect(MOVE_INFO[intent.moveId].startup).toBe(5);
  o.moveFrame=MOVES.standing_hp.duration-3;view.opponent=observe(g).fighters[0];
  expect(brain.decide(view).reason).not.toBe('punish');
});
it('chooses anti-air only from geometrically reachable moves',()=>{
  const g=createGame();g.fighters[0].x=400*rules.unit;g.fighters[1].x=445*rules.unit;
  g.fighters[0].y=-20*rules.unit;g.fighters[0].state='Airborne';
  const view={frame:100,self:observe(g).fighters[1],opponent:observe(g).fighters[0],round:g.round,hitstop:0,lastContact:null};
  const brain=new UtilityBrain({...PROFILES.hard,antiAirChance:1,executionError:0},new Rng(4));
  const intent=brain.decide(view);expect(intent.kind).toBe('attack');expect(intent.reason).toBe('anti-air');
  view.opponent.y=-500*rules.unit;
  expect(brain.decide(view).kind).not.toBe('attack');
});
it('retains the committed intent for the frame overlay after attack hitstop',()=>{
  const g=createGame(),cpu=new CpuPlayer('hard',1,()=>({decide:()=>({...attack('standing_lp'),reason:'punish',score:.82})}));
  for(let i=0;i<15;i++)step(g,[neutralInput(),cpu.next(g)]);
  g.hitstop=1;expect(cpu.next(g)).toEqual(neutralInput());step(g);
  cpu.next(g);expect(cpu.debug).toMatchObject({kind:'attack',moveId:'standing_lp',score:.82,reason:'punish'});
});

// Count real move starts from ordinary spawn spacing, not just brain intents or
// a hand-picked close-range setup. Alternate sides and exercise moving attackers.
describe.each(['passive','active'] as const)('directional repertoire against %s opponents',mode=>{
  it.each(levels)('%s regularly executes every directional attack',level=>{
    const rounds=new Map<string,number>();
    for(let seed=1;seed<=12;seed++) {
      const game=createGame(),side=seed%2 as 0|1,other=(1-side) as 0|1;
      const cpu=new CpuPlayer(level,side),opponent=new CpuPlayer(level,other);
      cpu.reset(seed);opponent.reset(seed+500);
      const seen=new Set<string>();let previous=0;
      while(game.round.phase==='fighting' && game.frame<9000) {
        const inputs:[ReturnType<typeof neutralInput>,ReturnType<typeof neutralInput>]=[neutralInput(),neutralInput()];
        inputs[side]=cpu.next(game);
        if(mode==='active')inputs[other]=opponent.next(game);
        step(game,inputs);
        const self=game.fighters[side];
        if(self.attackId!==previous && self.moveId)seen.add(self.moveId);
        previous=self.attackId;
      }
      for(const id of seen)rounds.set(id,(rounds.get(id)??0)+1);
    }
    for(const move of KNOWLEDGE.filter(m=>m.command.type==='hold'))
      expect(rounds.get(move.id)??0,move.id).toBeGreaterThanOrEqual(6);
    expect(rounds.get('jumping_uppercut')).toBeGreaterThanOrEqual(10);
    expect([...rounds.keys()].some(id=>MOVE_INFO[id].command.type==='normal')).toBe(true);
  });
});
it('closes the range for uppercut instead of endlessly choosing longer kicks',()=>{
  const g=createGame();g.fighters[1].x=500*rules.unit;g.fighters[0].x=400*rules.unit;
  const view={frame:100,self:observe(g).fighters[1],opponent:observe(g).fighters[0],round:g.round,hitstop:0,lastContact:null};
  const brain=new UtilityBrain(PROFILES.hard,new Rng(4));
  expect(brain.decide(view)).toMatchObject({kind:'approach',reason:'range for jumping_uppercut'});
  g.fighters[1].x=460*rules.unit;view.self=observe(g).fighters[1];
  expect(brain.decide(view)).toMatchObject({kind:'attack',moveId:'jumping_uppercut'});
});
