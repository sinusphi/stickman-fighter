import { expect, it } from 'vitest';
import rules from '../../src/data/rules.json';
import { MOVES } from '../../src/data/schema';
import { advanceOffset, samplePose, sampleYaw } from '../../src/render/skeleton';
import { FIGURE_SCALE } from '../../src/data/figure-scale';
import { createReplay, parseReplay, playReplay } from '../../src/debug/replay';
import { createGame, step } from '../../src/simulation/state';
import { neutralInput, buttonBit } from '../../src/input/types';
const ID='double_high_kick', mask=buttonBit('LK')|buttonBit('LMK');
const input=(facing:number,buttons=0)=>({...neutralInput(),left:facing===1,right:facing===-1,buttons});
const bend=(p:ReturnType<typeof samplePose>,side:string)=>{
 const hip=p.hip,knee=p[`${side}Knee`],foot=p[`${side}Foot`];
 const a=Math.atan2(knee[1]-hip[1],knee[0]-hip[0]),b=Math.atan2(foot[1]-knee[1],foot[0]-knee[0]);
 return Math.abs(((b-a)*180/Math.PI+540)%360-180);
};
/** >0: knee on the forward/upper side of the hip→foot line (facing the opponent). */
const kneeSide=(p:ReturnType<typeof samplePose>,side:string,facing:number)=>{
 const hip=p.hip,knee=p[`${side}Knee`],foot=p[`${side}Foot`];
 const dx=(foot[0]-hip[0])*facing,dy=foot[1]-hip[1],kx=(knee[0]-hip[0])*facing,ky=knee[1]-hip[1];
 return (dy*kx-dx*ky)/Math.hypot(dx,dy);
};
function setup(facing:1|-1,distance=60) {
 const g=createGame(),[a,b]=g.fighters;
 a.x=450*256;b.x=a.x+facing*distance*256;
 a.facing=a.attackFacing=facing;b.facing=b.attackFacing=-facing as 1|-1;
 return g;
}
it('starts the left LK+LMK chord in both facings and accepts either key order within three frames',()=>{
 for(const facing of [1,-1] as const) for(const first of [0,buttonBit('LK'),buttonBit('LMK')]) for(const gap of [1,3]) {
  const g=setup(facing,250);step(g,[input(facing),neutralInput()]);
  if(first)for(let i=0;i<gap;i++)step(g,[input(facing,first),neutralInput()]);
  step(g,[input(facing,mask),neutralInput()]);expect(g.fighters[0].moveId).toBe(ID);
 }
});
it('preserves singles, rejects wrong direction, right MK, late chords and crouch/air',()=>{
 for(const facing of [1,-1] as const){
  for(const [buttons,id] of [[buttonBit('LK'),'left_turn_kick'],[buttonBit('LMK'),'standing_lmk']] as const){
   const g=setup(facing);step(g,[input(facing,buttons),neutralInput()]);expect(g.fighters[0].moveId).toBe(id);
  }
  for(const raw of [{...neutralInput(),buttons:mask},input(-facing,mask),input(facing,buttonBit('LK')|buttonBit('MK')),{...input(facing,mask),down:true},{...input(facing,mask),up:true}]){
   const g=setup(facing);step(g,[raw,neutralInput()]);expect(g.fighters[0].moveId).not.toBe(ID);
  }
  const g=setup(facing);for(let i=0;i<5;i++)step(g,[input(facing,buttonBit('LK')),neutralInput()]);
  step(g,[input(facing,mask),neutralInput()]);expect(g.fighters[0].moveId).not.toBe(ID);
 }
});
it('has exactly two high strike windows and planted support feet in both facings',()=>{
 const m=MOVES[ID];expect(m.command.buttons).toEqual(['LK','LMK']);
 for(let f=0;f<m.duration;f++)expect(m.frames[f].hitboxes.length>0).toBe((f>=18&&f<=21)||(f>=44&&f<=47));
 for(const facing of [1,-1] as const)for(const [frame,foot,support] of [[18,'rightFoot','leftFoot'],[44,'leftFoot','rightFoot']] as const){
  const p=samplePose(ID,frame,facing);expect(p[foot][1]).toBeLessThan(-78);
  expect((p[foot][0]-p.hip[0])*facing).toBeGreaterThan(30);expect(Math.abs(p[support][1])).toBeLessThan(.1);
 }
});
it('hits twice nearby, never at phantom range, and standing back blocks both',()=>{
 for(const facing of [1,-1] as const)for(const distance of [60,160])for(const block of [false,true]){
  const g=setup(facing,distance);
  if(block){const [a,b]=g.fighters;b.x=facing===1?rules.stageWidth-Math.ceil(16*rules.unit*FIGURE_SCALE):Math.ceil(16*rules.unit*FIGURE_SCALE);a.x=b.x-facing*distance*rules.unit;}
  step(g,[input(facing,mask),block?input(-facing):neutralInput()]);
  for(let i=0;i<110;i++)step(g,[neutralInput(),block?input(-facing):neutralInput()]);
  expect(1000-g.fighters[1].hp).toBe(distance===160?0:block?11:140);
 }
});
it('turns shoulders, arms and knees through the rear profile before the opposite kick',()=>{
 for(const facing of [1,-1] as const){
  const first=samplePose(ID,18,facing),rear=samplePose(ID,31,facing),chamber=samplePose(ID,39,facing),second=samplePose(ID,44,facing);
  const shoulderOrder=(p:ReturnType<typeof samplePose>)=>(p.leftShoulder[0]-p.rightShoulder[0])*facing;
  expect(shoulderOrder(samplePose(ID,6,facing))).toBeGreaterThan(5);
  expect(shoulderOrder(rear)).toBeLessThan(-5);
  expect(shoulderOrder(second)).toBeGreaterThan(5);
  // The whole stance turns away; eyes/layer swaps alone cannot satisfy this:
  // both knees bend towards the back, both hands trail behind the neck.
  for(const side of ['left','right']){
   expect(kneeSide(rear,side,facing)).toBeLessThan(-1);
   expect((rear[`${side}Hand`][0]-rear.neck[0])*facing).toBeLessThan(-5);
  }
  // The left knee comes forward and up into the chamber, the foot tucked below it.
  expect((chamber.leftKnee[0]-chamber.hip[0])*facing).toBeGreaterThan(8);
  expect(chamber.hip[1]-chamber.leftKnee[1]).toBeGreaterThan(15);
  expect(chamber.leftFoot[1]).toBeGreaterThan(chamber.leftKnee[1]+15);
  expect((second.leftFoot[0]-second.hip[0])*facing).toBeGreaterThan(30);
  expect((first.rightHand[0]-first.neck[0])*facing).toBeLessThan(-10);
  expect((second.rightHand[0]-second.neck[0])*facing).toBeGreaterThan(15);
 }
 for(let frame=1;frame<78;frame++)expect(sampleYaw(ID,frame)).toBeGreaterThanOrEqual(sampleYaw(ID,frame-1)!);
});
it('keeps the turn continuous between baked frames and returns to the exact guard',()=>{
 for(const facing of [1,-1] as const){
  expect(samplePose(ID,77,facing)).toEqual(samplePose(ID,0,facing));
  for(let f=.25;f<=77;f+=.25){
   const a=samplePose(ID,f-.25,facing),b=samplePose(ID,f,facing);
   for(const joint of ['neck','leftShoulder','rightShoulder','leftHand','rightHand','leftFoot','rightFoot']){
    expect(Math.hypot(b[joint][0]-a[joint][0],b[joint][1]-a[joint][1]),`${joint} at ${f}`).toBeLessThan(joint.endsWith('Foot')?11:7);
   }
  }
 }
});
it('travels through both kicks, keeps its new position and replays in both facings and key orders',()=>{
 const move=MOVES[ID];
 expect(move.advance!.frames).toBeGreaterThan(move.startup);
 expect(move.advance!.frames).toBeLessThanOrEqual(44);
 expect(move.advance!.distance/256).toBeGreaterThan(50);
 expect(move.advance!.distance/256).toBeLessThan(55);
 for(const facing of [1,-1] as const)for(const first of [0,buttonBit('LK'),buttonBit('LMK')])for(const gap of [1,3]){
  const g=setup(facing,250),replay=createReplay(g);let start=g.fighters[0].x;
  const advance=(buttons:number)=>{
   const inputs:[ReturnType<typeof neutralInput>,ReturnType<typeof neutralInput>]=[buttons?input(facing,buttons):neutralInput(),neutralInput()];
   replay.frames.push({inputs,events:[]});step(g,inputs);
   if(replay.frames.length===1)start=g.fighters[0].x;
  };
  if(first)for(let i=0;i<gap;i++)advance(first);
  advance(mask);
  const a=g.fighters[0];
  while(a.moveFrame<18)advance(0);
  const firstContact=a.x;
  expect((firstContact-start)*facing/256).toBeGreaterThan(10);
  while(a.moveFrame<44)advance(0);
  expect((a.x-firstContact)*facing/256).toBeGreaterThan(18);
  expect((a.x-start)*facing).toBe(move.advance!.distance);
  for(let frame=0;frame<50;frame++)advance(0);
  expect((a.x-start)*facing).toBe(move.advance!.distance);
  expect(playReplay(parseReplay(replay))).toEqual(g);
 }
});
it('plants each support foot in world space and freezes travel during hitstop',()=>{
 for(const facing of [1,-1] as const){
  for(const [from,to,foot] of [[0,21,'leftFoot'],[39,53,'rightFoot']] as const){
   const world=(frame:number)=>(samplePose(ID,frame,facing)[foot][0]+advanceOffset(ID,frame)*facing)*FIGURE_SCALE;
   for(let frame=from;frame<=to;frame++){
    expect(world(frame)).toBeCloseTo(world(from),1);
    expect(Math.abs(samplePose(ID,frame,facing)[foot][1])).toBeLessThan(.1);
   }
  }
  const g=setup(facing,250);step(g,[input(facing,mask),neutralInput()]);
  for(let frame=0;frame<24;frame++)step(g);
  const x=g.fighters[0].x,frame=g.fighters[0].moveFrame;g.hitstop=7;
  for(let i=0;i<7;i++)step(g);
  expect(g.fighters[0].x).toBe(x);expect(g.fighters[0].moveFrame).toBe(frame);
 }
});

it('extends early, keeps the support leg nearly straight and retracts late',()=>{
 for(const facing of [1,-1] as const) for(const [from,to,kick,support] of [[15,22,'right','left'],[42,49,'left','right']] as const) for(let frame=from;frame<=to;frame++){
  const p=samplePose(ID,frame,facing);
  expect(bend(p,kick)).toBeLessThan(4);
  expect(bend(p,support)).toBeLessThan(8);
  const lean=Math.abs(Math.atan2(p.neck[0]-p.hip[0],p.hip[1]-p.neck[1])*180/Math.PI);
  expect(lean).toBeLessThan(14);
 }
 // The knee stays up after contact and folds slowly instead of snapping back.
 for(const facing of [1,-1] as const) for(const [from,to,kick] of [[22,28,'right'],[49,56,'left']] as const) for(let frame=from;frame<=to;frame++){
  const p=samplePose(ID,frame,facing);
  expect(p[`${kick}Knee`][1],`${kick} knee at ${frame}`).toBeLessThan(p.hip[1]-6);
 }
});
it('chambers each knee to the chest with an upright torso on a nearly straight support leg',()=>{
 for(const facing of [1,-1] as const) for(const [frame,kick,support] of [[11,'right','left'],[12,'right','left'],[39,'left','right'],[40,'left','right']] as const){
  const p=samplePose(ID,frame,facing);
  const lean=Math.atan2(p.neck[0]-p.hip[0],p.hip[1]-p.neck[1])*180/Math.PI*facing;
  expect(Math.abs(lean)).toBeLessThan(7);
  expect(bend(p,support)).toBeLessThan(8);
  expect(bend(p,kick)).toBeGreaterThan(105);
  expect(p.hip[1]-p[`${kick}Knee`][1]).toBeGreaterThan(15);
 }
 // The knee leads on the way up: no hyperextended or inverted kicking knee.
 for(const facing of [1,-1] as const) for(const [from,to,kick] of [[4,28,'right'],[35,58,'left']] as const) for(let frame=from;frame<=to;frame++){
  expect(kneeSide(samplePose(ID,frame,facing),kick,facing),`${kick} knee at ${frame}`).toBeGreaterThan(-.5);
 }
 // The support leg rises before the knee reaches the chest.
 for(const facing of [1,-1] as const) expect(samplePose(ID,8,facing).hip[1]).toBeLessThan(samplePose(ID,0,facing).hip[1]-1);
});
it('tips forward out of the backward lean while the second kicking leg comes down',()=>{
 for(const facing of [1,-1] as const){
  const lean=(frame:number)=>(samplePose(ID,frame,facing).neck[0]-samplePose(ID,frame,facing).hip[0])*facing;
  expect(lean(47)).toBeLessThan(-4);
  for(let frame=49;frame<=62;frame++)expect(lean(frame),`lean at ${frame}`).toBeGreaterThan(lean(frame-1));
  expect(lean(61)).toBeGreaterThan(lean(0)*.85);
 }
});
