import { expect, it } from 'vitest';
import { MOVES } from '../../src/data/schema';
import { animations, samplePose, sampleTurn, sampleYaw } from '../../src/render/skeleton';
import { eyeViews } from '../../src/render/figure';
import { createGame, step } from '../../src/simulation/state';
import { buttonBit, neutralInput } from '../../src/input/types';

it('selects the right uppercut with held forward and HP in both directions, then returns to idle',()=>{
 for(const facing of [1,-1] as const) {
  const game=createGame(),f=game.fighters[0];f.x=(facing===1?200:760)*256;game.fighters[1].x=(facing===1?760:200)*256;f.facing=facing;
  const forward={...neutralInput(),right:facing===1,left:facing===-1};
  for(let i=0;i<4;i++)step(game,[forward,neutralInput()]);
  step(game,[{...forward,buttons:buttonBit('HP')},neutralInput()]);
  expect(f.moveId).toBe('jumping_uppercut');expect(f.attackFacing).toBe(facing);
  for(let i=0;i<56;i++)step(game);
  expect(f.state).toBe('Idle');expect(f.y).toBe(0);
 }
});
it('keeps the left hook on neutral HP and does not repeat a held uppercut',()=>{
 const normal=createGame();step(normal,[{...neutralInput(),buttons:buttonBit('HP')},neutralInput()]);expect(normal.fighters[0].moveId).toBe('standing_hp');
 const game=createGame(),input={...neutralInput(),right:true,buttons:buttonBit('HP')};
 for(let i=0;i<65;i++)step(game,[input,neutralInput()]);
 expect(game.fighters[0].attackId).toBe(1);
 expect(animations.standing_hp.trail?.joint).toBe('leftHand');
});
it('follows the reference with the right fist above the head, a 1.5x jump height and a bent knee, then lands smoothly',()=>{
 const id='jumping_uppercut',p=samplePose(id,22);
 expect(p.rightHand[1]).toBeLessThan(p.head[1]-9);
 expect(p.leftHand[1]).toBeGreaterThan(p.head[1]);
 expect(Math.max(p.leftFoot[1],p.rightFoot[1])).toBeLessThan(-30);
 expect(p.leftKnee[0]-p.hip[0]).toBeLessThan(-10);
 expect(samplePose(id,55)).toEqual(samplePose('Idle',0));
 for(let t=0;t<55;t+=.25) {
  const a=samplePose(id,t),b=samplePose(id,t+.25);
  expect(Math.max(a.leftFoot[1],a.rightFoot[1])).toBeLessThanOrEqual(.00001);
  for(const joint of Object.keys(a))expect(Math.hypot(a[joint][0]-b[joint][0],a[joint][1]-b[joint][1]),`${joint}/${t}`).toBeLessThan(5);
 }
});
it('turns only to the full back view, holds it, then unwinds to the starting view',()=>{
 const id='jumping_uppercut',strike=samplePose(id,22),back=samplePose(id,26);
 expect(strike.rightHand[0]).toBeGreaterThan(strike.head[0]);
 expect(sampleYaw(id,15)).toBe(0);
 expect(sampleYaw(id,26)).toBe(90);
 expect(sampleTurn(id,26)).toBeCloseTo(.5);
 expect(eyeViews(sampleTurn(id,26),sampleYaw(id,26))).toEqual([]);
 // Punching arm is fully extended at the apex instead of folding over the head.
 const bend=(p:typeof back)=>{const u=Math.atan2(p.rightElbow[1]-p.rightShoulder[1],p.rightElbow[0]-p.rightShoulder[0]),f=Math.atan2(p.rightHand[1]-p.rightElbow[1],p.rightHand[0]-p.rightElbow[0]);return Math.abs(Math.atan2(Math.sin(f-u),Math.cos(f-u)))*180/Math.PI;};
 expect(bend(back)).toBeLessThan(10);
 expect(bend(strike)).toBeLessThan(15);
 expect(back.rightHand[1]).toBeLessThan(back.head[1]);
 expect(back.leftHand[0]).toBeLessThan(back.head[0]);
 expect(back.leftHand[1]).toBeGreaterThan(back.head[1]);
 expect(sampleYaw(id,29)).toBe(90);
 expect(sampleYaw(id,43)).toBe(0);
 expect(sampleTurn(id,43)).toBe(0);
 expect(animations[id].fixedLegDepth).toBe(true);
 let previous=sampleYaw(id,0)!;
 for(let time=.25;time<=55;time+=.25) {
  const yaw=sampleYaw(id,time)!;
  expect(yaw).toBeGreaterThanOrEqual(0);
  expect(yaw).toBeLessThanOrEqual(90);
  if(time<=26)expect(yaw).toBeGreaterThanOrEqual(previous);
  else expect(yaw).toBeLessThanOrEqual(previous);
  expect(Math.abs(yaw-previous)).toBeLessThan(10);
  previous=yaw;
 }
});
it('matches the rear reference silhouette on both sides and keeps the free arm compact at chest height',()=>{
 const id='jumping_uppercut';
 for(const facing of [1,-1]) {
  const back=samplePose(id,26,facing);
  expect(back.rightHand[1]).toBeLessThan(back.head[1]-18);
  expect((back.rightElbow[0]-back.head[0])*facing).toBeGreaterThan(5);
  expect(back.rightHand[1]).toBeLessThan(back.rightElbow[1]-10);
  expect(Math.abs(back.rightHand[0]-back.rightElbow[0])).toBeLessThan(4);
  expect((back.leftKnee[0]-back.hip[0])*facing).toBeLessThan(-10);
  expect(Math.abs(back.rightFoot[0]-back.rightKnee[0])).toBeLessThan(1);
  for(let time=0;time<=55;time+=.25) {
   const pose=samplePose(id,time,facing);
   // The upper chest starts just below the neck; the guard itself is at +3.
   expect(pose.leftHand[1]-pose.neck[1],`free hand/${time}`).toBeGreaterThanOrEqual(1.5);
   expect(Math.hypot(pose.leftHand[0]-pose.leftShoulder[0],pose.leftHand[1]-pose.leftShoulder[1])).toBeLessThan(34);
  }
 }
 // One restrained sweep out and back, without an extra arm circle or reversal.
 const forearm=(time:number)=>{const p=samplePose(id,time);return Math.atan2(p.leftHand[1]-p.leftElbow[1],p.leftHand[0]-p.leftElbow[0]);};
 for(let time=11.25;time<=26;time+=.25)expect(forearm(time)).toBeLessThanOrEqual(forearm(time-.25)+1e-8);
 for(let time=29.25;time<=43;time+=.25)expect(forearm(time)).toBeGreaterThanOrEqual(forearm(time-.25)-1e-8);
});
it('keeps hitboxes on the right striking arm only during the punch and the uppercut',()=>{
 const move=MOVES.jumping_uppercut;
 expect(move.multiHit).toBe(true);
 expect(move.hitGroups.map(g=>g.id)).toEqual(['punch','main']);
 move.frames.forEach((boxes,frame)=>{
  const group=frame>=6&&frame<=8?'punch':frame>=14&&frame<=21?'main':undefined;
  expect(boxes.hitboxes.map(b=>b.hitGroup)).toEqual(group?[group]:[]);
  if(boxes.hitboxes.length)for(const joint of ['rightHand','rightElbow']) {
   const p=samplePose(move.id,frame)[joint].map(n=>n*256),box=boxes.hitboxes[0];
   expect(p[0]).toBeGreaterThanOrEqual(box.x);expect(p[0]).toBeLessThanOrEqual(box.x+box.width);
   expect(p[1]).toBeGreaterThanOrEqual(box.y);expect(p[1]).toBeLessThanOrEqual(box.y+box.height);
  }
 });
});
it('lands both hits at close range and whiffs against crouching guard or at distance',()=>{
 for(const blocked of [false,true])for(const distance of [36,240]) {
  const game=createGame();game.fighters[0].x=300*256;game.fighters[1].x=(300+distance)*256;
  if(blocked){game.fighters[1].state='Blockstun';game.fighters[1].remaining=90;}
  const defender=blocked?{...neutralInput(),right:true,down:true}:neutralInput();
  step(game,[{...neutralInput(),right:true,buttons:buttonBit('HP')},defender]);
  for(let i=0;i<80;i++)step(game,[neutralInput(),defender]);
  const total=MOVES.jumping_uppercut.hitGroups.reduce((sum,g)=>sum+(g.damage??MOVES.jumping_uppercut.damage),0);
  expect(total).toBe(100);
  expect(game.fighters[1].hp).toBe(!blocked&&distance===36?1000-total:1000);
  if(distance===36&&!blocked)expect(game.lastContact?.blocked).toBe(false);
  else expect(game.lastContact).toBe(null);
 }
});
it('throws a straight punch at chin height, draws the fist back, then drives it upwards on takeoff',()=>{
 const id='jumping_uppercut',punch=samplePose(id,7),load=samplePose(id,11),takeoff=samplePose(id,15);
 // Punch: right arm straight and nearly horizontal at head height, feet on the ground.
 expect(punch.rightHand[0]-punch.rightShoulder[0]).toBeGreaterThan(27);
 expect(Math.abs(punch.rightHand[1]-punch.rightShoulder[1])).toBeLessThan(8);
 expect(Math.max(punch.leftFoot[1],punch.rightFoot[1])).toBeGreaterThan(-.5);
 // Load: fist back at the chest, hips lower than in the punch.
 expect(load.rightHand[0]-load.rightShoulder[0]).toBeLessThan(15);
 expect(load.rightHand[1]).toBeGreaterThan(load.rightShoulder[1]);
 expect(load.hip[1]).toBeGreaterThan(punch.hip[1]);
 // Takeoff: the arm extends upwards and forwards while the body leaves the floor.
 expect(takeoff.rightHand[1]).toBeLessThan(takeoff.rightShoulder[1]-12);
 expect(takeoff.rightHand[0]).toBeGreaterThan(takeoff.rightShoulder[0]+20);
});
it('chains the punch into the uppercut on hit and on a standing block, with the punch first',()=>{
 for(const blocked of [false,true]) {
  const game=createGame();game.fighters[0].x=300*256;game.fighters[1].x=336*256;
  if(blocked){game.fighters[1].state='Blockstun';game.fighters[1].remaining=90;}
  const defender=blocked?{...neutralInput(),right:true}:neutralInput(),groups:string[]=[];
  step(game,[{...neutralInput(),right:true,buttons:buttonBit('HP')},defender]);
  for(let i=0;i<80;i++) {
   step(game,[neutralInput(),defender]);
   const f=game.fighters[0];
   if(f.hitTargets.length>groups.length)groups.push(f.hitTargets.at(-1)!.split(':')[0]);
   if(groups.length===1)expect(game.fighters[1].state).toBe(blocked?'Blockstun':'Hitstun');
  }
  expect(groups).toEqual(['punch','main']);
  expect(game.lastContact?.blocked).toBe(blocked);
 }
});
