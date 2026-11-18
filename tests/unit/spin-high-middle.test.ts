import {expect,it} from 'vitest';
import {MOVES} from '../../src/data/schema';
import {createGame,step} from '../../src/simulation/state';
import {buttonBit,neutralInput} from '../../src/input/types';
import {samplePose,sampleYaw} from '../../src/render/skeleton';
const id='spin_high_middle_combo',v=buttonBit('RLK'),b=buttonBit('MK');
const input=(facing:number,buttons=0)=>({...neutralInput(),right:facing===1,left:facing===-1,buttons});
function setup(facing:1|-1,distance=180){const g=createGame();const [a,b]=g.fighters;a.x=480*256;b.x=a.x+facing*distance*256;a.facing=a.attackFacing=facing;b.facing=b.attackFacing=facing===1?-1:1;return g;}
it('accepts forward V+B in both facings, either key order and up to three frames apart',()=>{
 for(const facing of [1,-1] as const)for(const first of [v,b])for(const gap of [0,1,2,3]){
  const g=setup(facing);step(g,[input(facing),neutralInput()]);const x=g.fighters[0].x;
  for(let n=0;n<gap;n++)step(g,[input(facing,first),neutralInput()]);
  step(g,[input(facing,v|b),neutralInput()]);expect(g.fighters[0].moveId).toBe(id);
  expect(Math.abs(g.fighters[0].x-x-facing*768)).toBeLessThanOrEqual(1);
  for(let n=0;n<150;n++)step(g,[input(facing,v|b),neutralInput()]);
  expect(g.fighters[0].attackId).toBe(1);
 }
});
it('keeps singles, neutral, backward and diagonal inputs unchanged',()=>{
 for(const [raw,want] of [[input(1,v),'standing_rlk'],[input(1,b),'tornado_mk'],[{...neutralInput(),buttons:v|b},'standing_mk'],[input(-1,v|b),'spin_mk'],[{...input(1,v|b),down:true},null]] as const){const g=setup(1);step(g,[raw,neutralInput()]);expect(g.fighters[0].moveId).toBe(want);}
 for(const first of [v,b]) {const g=setup(1);for(let n=0;n<4;n++)step(g,[input(1,first),neutralInput()]);step(g,[input(1,v|b),neutralInput()]);expect(g.fighters[0].moveId).not.toBe(id);}
});
it('reuses both authored spins with a continuous turn and guard transition',()=>{
 const offset=MOVES.spin_hk.duration-1;
 for(const facing of [-1,1])for(let f=0;f<MOVES[id].duration;f+=.5){
  const source=f<offset?'spin_hk':'spin_mk',time=f<offset?f:f-offset;
  expect(samplePose(id,f,facing)).toEqual(samplePose(source,time,facing));
 }
 expect(sampleYaw(id,offset)).toBe(-360);expect(sampleYaw(id,MOVES[id].duration-1)).toBe(-720);
});
it('lands both distinct hits at close range in both facings',()=>{
 for(const facing of [1,-1] as const){const g=setup(facing,40);step(g,[input(facing,v|b),neutralInput()]);
 for(let n=0;n<120;n++)step(g,[neutralInput(),neutralInput()]);
 expect(g.fighters[1].hp).toBe(810);expect(g.fighters[0].hitTargets).toEqual(['high:1','middle:1']);}
});
