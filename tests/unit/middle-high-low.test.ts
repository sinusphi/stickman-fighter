import {expect,it} from 'vitest';
import {MOVES} from '../../src/data/schema';
import {createGame,step} from '../../src/simulation/state';
import {buttonBit,neutralInput} from '../../src/input/types';
import {samplePose} from '../../src/render/skeleton';
import {FIGURE_SCALE} from '../../src/data/figure-scale';
const id='middle_high_low_combo',g=buttonBit('LMK'),b=buttonBit('MK');
const input=(facing:number,buttons=0)=>({...neutralInput(),right:facing===1,left:facing===-1,buttons});
function setup(facing:1|-1,distance=180){const game=createGame();const [a,b]=game.fighters;a.x=480*256;b.x=a.x+facing*distance*256;a.facing=a.attackFacing=facing;b.facing=b.attackFacing=facing===1?-1:1;return game;}
it('accepts forward G+B in both facings and either order within three frames without repeating',()=>{
 for(const facing of [1,-1] as const)for(const first of [g,b])for(const gap of [0,1,2,3]){
  const game=setup(facing);step(game,[input(facing),neutralInput()]);const x=game.fighters[0].x;
  for(let n=0;n<gap;n++)step(game,[input(facing,first),neutralInput()]);
  step(game,[input(facing,g|b),neutralInput()]);expect(game.fighters[0].moveId).toBe(id);
  expect(Math.abs(game.fighters[0].x-x-facing*768)).toBeLessThanOrEqual(1);
  for(let n=0;n<140;n++)step(game,[input(facing,g|b),neutralInput()]);
  expect(game.fighters[0].attackId).toBe(1);
 }
});
it('preserves single keys, neutral, back and crouching inputs and rejects late chords',()=>{
 for(const [raw,want] of [[input(1,g),'standing_lmk'],[input(1,b),'tornado_mk'],[{...neutralInput(),buttons:g|b},'standing_mk'],[input(-1,g|b),'spin_mk'],[{...input(1,g|b),down:true},null]] as const){const game=setup(1);step(game,[raw,neutralInput()]);expect(game.fighters[0].moveId).toBe(want);}
 for(const first of [g,b]){const game=setup(1);for(let n=0;n<4;n++)step(game,[input(1,first),neutralInput()]);step(game,[input(1,g|b),neutralInput()]);expect(game.fighters[0].moveId).not.toBe(id);}
});
it('retracts only into a raised right knee chamber and extends higher without planting',()=>{
 for(const facing of [1,-1]){
  for(let f=17;f<=31;f+=.25){const p=samplePose(id,f,facing);expect(p.rightFoot[1]).toBeLessThan(-20);expect(p.rightKnee[1]).toBeLessThan(p.hip[1]);expect(Math.abs(p.leftFoot[1])).toBeLessThan(.01);}
  const middle=samplePose(id,19,facing),chamber=samplePose(id,24,facing),high=samplePose(id,29,facing);
  expect(chamber.rightFoot[0]*facing).toBeLessThan(middle.rightFoot[0]*facing-15);
  expect(Math.hypot(chamber.rightFoot[0]-chamber.hip[0],chamber.rightFoot[1]-chamber.hip[1])).toBeLessThan(25);
  expect(high.rightFoot[1]).toBeLessThan(middle.rightFoot[1]-15);
  expect(samplePose(id,51,facing).leftFoot[1]).toBeGreaterThan(-25);
 }
});
it('drives the high kick forward over a nearly straight support leg',()=>{
 for(const facing of [1,-1] as const){
  const game=setup(facing,180),fighter=game.fighters[0];
  step(game,[input(facing,g|b),neutralInput()]);
  const at=(frame:number)=>{while(fighter.moveFrame<frame)step(game,[neutralInput(),neutralInput()]);
   const pose=samplePose(id,frame,facing);
   return {x:fighter.x/256,pose,foot:facing*fighter.x/256+facing*pose.rightFoot[0]*FIGURE_SCALE};};
  const middle=at(19),high=at(29),late=at(31);
  expect((late.x-middle.x)*facing).toBeGreaterThan(15);
  expect(late.foot).toBeGreaterThan(middle.foot);
  for(const {pose} of [high,late]){
   const reach=Math.hypot(pose.leftFoot[0]-pose.hip[0],pose.leftFoot[1]-pose.hip[1]);
   const bend=2*Math.acos(Math.min(1,reach/50))*180/Math.PI;
   expect(bend).toBeLessThan(16);
   expect(Math.abs(pose.leftFoot[1])).toBeLessThan(.01);
   expect((pose.neck[0]-pose.hip[0])*facing).toBeGreaterThan(1);
  }
 }
});
it('lands exactly middle, high and low in order in both facings',()=>{
 for(const facing of [1,-1] as const){const game=setup(facing,40);step(game,[input(facing,g|b),neutralInput()]);
 for(let n=0;n<160;n++)step(game,[neutralInput(),neutralInput()]);
 expect(game.fighters[0].hitTargets).toEqual(['middle:1','high:1','low:1']);expect(game.fighters[1].hp).toBe(805);}
 expect(MOVES[id].hitGroups.map(g=>g.id)).toEqual(['middle','high','low']);
});
