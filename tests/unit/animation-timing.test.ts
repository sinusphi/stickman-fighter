import { expect, it } from 'vitest';
import original from '../fixtures/animation-timing.json';
import { animations } from '../../src/render/skeleton';
import { MOVES } from '../../src/data/schema';
import { FixedLoop } from '../../src/platform/loop';
import { createGame, step } from '../../src/simulation/state';
import { buttonBit, neutralInput } from '../../src/input/types';

const fastBasicKick=(id:string)=>/^(standing|crouching|airborne)_(lk|rlk|lmk|mk)$/.test(id);
const basicKickDuration=(frames:number)=>Math.round(Math.round(frames*.8)*.95);
const retime=(id:string,n:number)=>fastBasicKick(id)?basicKickDuration(n):/^(standing|crouching|airborne)_hk$/.test(id)?Math.round(n*.95):n;
const preparation=(id:string)=>(original.preparationExtension as Record<string,number>)[id]??0;

it('preserves global timing while accelerating low and middle kicks on both sides',()=>{
  for(const [id,old] of Object.entries(original.animations)) {
    const animation=animations[id];
    expect(animation.durationFrames,id).toBe(retime(id,Math.round(old.duration*1.25)+preparation(id)));
    expect(animation.keyframes.at(-1)?.frame,id).toBe(animation.durationFrames-1);
  }
});
it('retimes startup, contact, recovery and reactions together without scaling twice',()=>{
  for(const [id,old] of Object.entries(original.moves)) {
    const move=MOVES[id];
    expect(move.startup,id).toBe(retime(id,Math.round(old.startup*1.25)+preparation(id)));
    expect(move.startup+move.active,id).toBe(retime(id,Math.round((old.startup+old.active)*1.25)+preparation(id)));
    expect(move.duration,id).toBe(retime(id,Math.round((old.startup+old.active+old.recovery)*1.25)+preparation(id)));
    expect(move.duration).toBe(animations[id].durationFrames);
    for(const key of ['hitstun','blockstun','hitstop'] as const)expect(move[key]).toBe(Math.round(old[key]*1.25));
    move.frames.forEach((boxes,frame)=>expect(boxes.hitboxes.length>0,`${id}/${frame}`).toBe(frame>=move.startup&&frame<move.startup+move.active));
  }
  expect(['standing_lk','standing_rlk','standing_lmk','standing_mk','standing_hk'].map(id=>MOVES[id].duration)).toEqual([30,30,37,37,51]);
});
it.each([30,60,144])('plays the faster low kick at %s display Hz while keeping the simulation at 60 Hz',hz=>{
  const loop=new FixedLoop(),game=createGame();let start=-1,end=-1;
  const update=()=>{
    step(game,[{...neutralInput(),buttons:game.frame===0?buttonBit('LK'):0},neutralInput()]);
    if(game.fighters[0].state==='Attack'&&start<0)start=game.frame;
    if(start>=0&&end<0&&game.fighters[0].state!=='Attack')end=game.frame;
  };
  loop.advance(0,update);
  for(let frame=1;frame<=hz;frame++)loop.advance(frame*1000/hz,update);
  expect(game.frame).toBe(60);expect((end-start)/60).toBe(30/60);
});

it('preserves preparation and retimes every left-kick phase consistently',()=>{
  for(const [id,extra] of Object.entries(original.preparationExtension)) {
    const old=original.animations[id as keyof typeof original.animations],move=original.moves[id as keyof typeof original.moves];
    const before=old.keys.map(frame=>frame===old.duration-1?Math.round(old.duration*1.25)-1:
      frame===move.startup+move.active-1?Math.round((frame+1)*1.25)-1:Math.round(frame*1.25));
    const keys=animations[id].keyframes;
    expect(keys[0].frame).toBe(0);
    expect(keys[1].frame).toBeGreaterThanOrEqual(10);
    for(let i=1;i<keys.length;i++)expect(keys[i].frame,`${id}/${i}`).toBe(i===keys.length-1?animations[id].durationFrames-1:retime(id,before[i]+extra));
    if(!fastBasicKick(id)&&!/^(standing|crouching|airborne)_hk$/.test(id))for(let i=2;i<keys.length;i++)expect(keys[i].frame-keys[i-1].frame).toBe(before[i]-before[i-1]);
  }
});
