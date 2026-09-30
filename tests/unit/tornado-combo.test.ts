import { expect, it } from 'vitest';
import { MOVES } from '../../src/data/schema';
import rig from '../../src/data/poses.json';
import { animationTrails, samplePose, sampleRotationTrail, sampleTrails, sampleYaw } from '../../src/render/skeleton';
import { spinFrameBoxes } from '../../src/data/spin-boxes';
import { createGame, step, snapshot } from '../../src/simulation/state';
import { collectContacts, resolveCombat } from '../../src/simulation/combat';
import { neutralInput, buttonBit } from '../../src/input/types';
import { createReplay, parseReplay, playReplay } from '../../src/debug/replay';
import { HitFeedback } from '../../src/render/feedback';

const highStart=32+MOVES.forward_spin_hk.startup;
const spinTime=(f:number)=>f<=24?Math.round(f/24*MOVES.forward_spin_hk.startup):MOVES.forward_spin_hk.startup+(f-24)/5*(MOVES.forward_spin_hk.active-1);
const mk=buttonBit('MK'),hk=buttonBit('HK');
const cases=[['tornado_mk',mk,80],['forward_spin_hk',hk,100],['tornado_spin_combo',mk|hk,180]] as const;
const forward=(facing:number,buttons=0)=>({...neutralInput(),right:facing===1,left:facing===-1,buttons});
const back=(facing:number,buttons=0)=>({...neutralInput(),left:facing===1,right:facing===-1,buttons});
it('assigns readable colored-path geometry to each tornado and both combo kicks',()=>{
 expect(animationTrails('tornado_mk').map(t=>t.joint)).toEqual(['rightFoot']);
 expect(animationTrails('forward_spin_hk').map(t=>t.joint)).toEqual(['leftFoot']);
 expect(animationTrails('tornado_spin_combo').map(t=>t.joint)).toEqual(['rightFoot','leftFoot']);
 expect(sampleTrails('tornado_spin_combo',28)[0].length).toBeGreaterThan(5);
 expect(sampleTrails('tornado_spin_combo',28)[1]).toEqual([]);
 expect(sampleTrails('tornado_spin_combo',highStart)[0]).toEqual([]);
 expect(sampleTrails('tornado_spin_combo',highStart)[1].length).toBeGreaterThan(5);
});
it.each([['tornado_mk',18],['forward_spin_hk',18],['tornado_spin_combo',48]] as const)('%s exposes a mirrored waist arc during its turn',(id,frame)=>{
 const right=sampleRotationTrail(id,frame,1),left=sampleRotationTrail(id,frame,-1);
 expect(right.length).toBeGreaterThan(4);expect(left).toHaveLength(right.length);
 right.forEach(([x,y],i)=>{expect(left[i][0]).toBeCloseTo(-x,8);expect(left[i][1]).toBeCloseTo(y,8);});
});
it.each([['forward_spin_hk',0],['tornado_spin_combo',32]] as const)('%s turns on a straight support leg and carries an extended HK leg around the back', (id,offset)=>{
 const extension=(pose:ReturnType<typeof samplePose>,side:'left'|'right')=>{
  const thigh=[pose[`${side}Knee`][0]-pose.hip[0],pose[`${side}Knee`][1]-pose.hip[1]];
  const shin=[pose[`${side}Foot`][0]-pose[`${side}Knee`][0],pose[`${side}Foot`][1]-pose[`${side}Knee`][1]];
  return (thigh[0]*shin[0]+thigh[1]*shin[1])/625;
 };
 for(const facing of [-1,1])for(let frame=spinTime(6);frame<=spinTime(29);frame+=.25) {
  const pose=samplePose(id,frame+offset,facing);
  expect(extension(pose,'left'),`${id}/${frame}/kick`).toBeGreaterThan(Math.cos(Math.PI/18));
  expect(extension(pose,'right'),`${id}/${frame}/support`).toBeGreaterThan(Math.cos(Math.PI/18));
  expect(pose.rightFoot[1]).toBeCloseTo(0,8);
 }
 const rear=samplePose(id,spinTime(18)+offset);
 expect(sampleYaw(id,spinTime(18)+offset)!%360).toBeGreaterThan(90);
 expect(sampleYaw(id,spinTime(18)+offset)!%360).toBeLessThan(120);
 expect(rear.leftFoot[0]).toBeLessThan(rear.hip[0]-30);
 expect(rear.leftFoot[1]).toBeLessThan(rear.hip[1]-20);
 for(const frame of [24,29]) {
  const pose=samplePose(id,spinTime(frame)+offset);
  expect(extension(pose,'left')).toBeCloseTo(1,8);
  expect(extension(pose,'right')).toBeCloseTo(1,8);
  expect(pose.leftFoot[0]-pose.hip[0]).toBeGreaterThan(34);
  expect(Math.abs(pose.leftFoot[1]-samplePose('Idle',0).head[1])).toBeLessThan(1);
 }
});
function setup(facing=1,distance=180) {
 const game=createGame(),[a,b]=game.fighters;a.x=480*256;b.x=a.x+facing*distance*256;
 a.facing=a.attackFacing=facing as 1|-1;b.facing=b.attackFacing=-facing as 1|-1;return game;
}
it.each(cases)('%s triggers on its configured direction chord in either facing', (id,buttons)=>{
 for(const facing of [-1,1])for(const held of [0,1,12]) {
  const direction=id==='forward_spin_hk'?back:forward;
  const game=setup(facing);for(let n=0;n<held;n++)step(game,[direction(facing),neutralInput()]);
  step(game,[direction(facing,buttons),neutralInput()]);
  expect(game.fighters[0].moveId).toBe(id);expect(game.fighters[0].attackFacing).toBe(facing);
  for(let n=0;n<130;n++)step(game,[direction(facing,buttons),neutralInput()]);
  expect(game.fighters[0].attackId).toBe(1);
 }
});
it('keeps normal priorities and rejects diagonals',()=>{
 for(const input of [neutralInput(),{...forward(1),down:true}]) {
  const game=setup();step(game,[{...input,buttons:mk|hk},neutralInput()]);
  expect(game.fighters[0].moveId).toBe(input.down?'crouching_hk':'standing_hk');
 }
 const priority=setup();step(priority,[forward(1,mk|hk|buttonBit('HP')),neutralInput()]);expect(priority.fighters[0].moveId).toBe('jumping_uppercut');
 const released=setup();step(released,[forward(1),neutralInput()]);step(released,[{...neutralInput(),buttons:mk|hk},neutralInput()]);expect(released.fighters[0].moveId).toBe('standing_hk');
});
it('never upgrades buffered, hitstop or recovery presses into the combo',()=>{
 for(const state of ['Hitstun','Blockstun','Landing','Attack','Airborne','Crouch'] as const) {
  const game=setup(),a=game.fighters[0];a.state=state;a.remaining=1;
  if(state==='Attack'){a.moveId='standing_lp';a.moveFrame=MOVES.standing_lp.duration-1;}
  if(state==='Airborne'){a.y=-50*256;a.vy=0;}
  if(state==='Crouch')a.crouching=true;
  step(game,[forward(1,mk|hk),neutralInput()]);expect(a.moveId).not.toBe('tornado_spin_combo');
 }
 const game=setup();game.hitstop=2;
 for(let n=0;n<3;n++)step(game,[forward(1,mk|hk),neutralInput()]);
 expect(game.fighters[0].moveId).toBe('standing_hk');
});
it.each(cases)('%s has exact limb boxes, fixed bones, no floor penetration and a guard finish',id=>{
 const move=MOVES[id];
 for(let frame=0;frame<move.duration;frame++) {
  const hit=move.frames[frame].hitboxes[0],side=hit?.hitGroup==='spin'?'left':'right';
  expect(move.frames[frame]).toMatchObject(spinFrameBoxes(samplePose(id,frame),Boolean(hit),side,hit?.hitGroup??'main'));
  for(const fraction of [0,.5])for(const facing of [-1,1]) {
   const pose=samplePose(id,frame+fraction,facing);
   expect(Math.max(pose.leftFoot[1],pose.rightFoot[1])).toBeLessThan(1e-8);
   for(const bone of rig.skeleton.bones)expect(Math.hypot(pose[bone.parent][0]-pose[bone.joint][0],pose[bone.parent][1]-pose[bone.joint][1])).toBeCloseTo(bone.length,8);
  }
 }
 expect(samplePose(id,move.duration-1)).toEqual(samplePose('Idle',0));
 expect(sampleYaw(id,0)).toBe(0);
 expect(sampleYaw(id,move.duration-1)).toBe(id==='tornado_spin_combo'?720:360);
});
it('jumps for the right tornado and flows through a grounded pivot to the left high spin',()=>{
 const hop=samplePose('tornado_spin_combo',24);
 expect(hop.leftFoot[1]).toBeLessThan(-12);expect(hop.rightFoot[1]).toBeLessThan(-12);
 const middle=samplePose('tornado_spin_combo',28),high=samplePose('tornado_spin_combo',highStart);
 expect(middle.rightFoot[0]).toBeGreaterThan(40);expect(middle.rightFoot[1]).toBeGreaterThan(-70);
 expect(high.leftFoot[1]).toBeLessThan(-85);expect(high.rightFoot[1]).toBeCloseTo(0,8);
 expect(high.neck[0]).toBeLessThan(high.hip[0]-25);
 const move=MOVES.tornado_spin_combo;
 expect(move.frames.flatMap((f,i)=>f.hitboxes.length?[i]:[])).toEqual([28,29,30,31,32,...Array.from({length:MOVES.forward_spin_hk.active},(_,i)=>highStart+i)]);
 expect(move.frames[38].hitboxes).toEqual([]);
});
it.each(['tornado_mk','tornado_spin_combo'])('%s keeps the hip airborne while lowering the non-kicking leg',id=>{
 for(const facing of [-1,1])for(let frame=12;frame<=32;frame+=.25) {
  const pose=samplePose(id,frame,facing);
  // Folding either leg must never pull the hip down towards the floor.
  expect(pose.hip[1]).toBeLessThan(-48);
  if(frame>=18&&frame<=28) {
   expect(pose.leftFoot[1]).toBeLessThan(-7);
   expect(pose.rightFoot[1]).toBeLessThan(-7);
  }
  if(frame>=24) {
   const thigh=[pose.leftKnee[0]-pose.hip[0],pose.leftKnee[1]-pose.hip[1]];
   const shin=[pose.leftFoot[0]-pose.leftKnee[0],pose.leftFoot[1]-pose.leftKnee[1]];
   expect((thigh[0]*shin[0]+thigh[1]*shin[1])/625).toBeGreaterThanOrEqual(Math.cos(Math.PI/6)-1e-8);
   expect(pose.leftKnee[1]).toBeLessThan(pose.leftFoot[1]-20);
  }
  const next=samplePose(id,frame+.25,facing);
  expect(Math.abs(next.hip[1]-pose.hip[1])).toBeLessThan(1);
 }
});
it.each(cases)('%s lands the expected damage in both facings and replays through hitstop', (id,buttons,damage)=>{
 for(const facing of [-1,1]) {
  const game=setup(facing,60),replay=createReplay(game);let saved:ReturnType<typeof snapshot>|undefined,cut=0;
  for(let frame=0;frame<140;frame++) {
   const direction=id==='forward_spin_hk'?back:forward;
   const inputs:[ReturnType<typeof neutralInput>,ReturnType<typeof neutralInput>]=[frame===0?direction(facing,buttons):neutralInput(),neutralInput()];
   replay.frames.push({inputs,events:[]});step(game,inputs);
   if(game.hitstop>0&&!saved){saved=snapshot(game);cut=frame+1;}
  }
  expect(game.fighters[1].hp,id).toBe(1000-damage);
  expect(game.fighters[0].hitTargets).toHaveLength(id==='tornado_spin_combo'?2:1);
  expect(saved).toBeDefined();expect(playReplay(parseReplay(replay))).toEqual(game);
  for(const frame of replay.frames.slice(cut))step(saved!,frame.inputs);expect(saved).toEqual(game);
 }
});
it('uses MID then HIGH blocking and hit feedback; each group contacts only once',()=>{
 for(const [frame,level] of [[28,'MID'],[highStart,'HIGH']] as const)for(const direction of [1,4] as const) {
  const game=setup(1,42),[a,b]=game.fighters;a.state='Attack';a.moveId='tornado_spin_combo';a.moveFrame=frame;b.input.current.direction=direction;
  expect(collectContacts(game)).toHaveLength(1);
  const before=snapshot(game);resolveCombat(game);
  expect(game.lastContact?.blocked).toBe(direction===4||level==='MID');
  if(direction===1&&level==='HIGH') {
   const feedback=new HitFeedback();feedback.update(game,before);expect(feedback.levels[1]).toBe('HIGH');feedback.reset(game);expect(feedback.levels[1]).toBe('HIGH');
  }
  expect(collectContacts(game)).toHaveLength(0);
 }
});
it('whiffs at range and can be interrupted before the second kick',()=>{
 const far=setup(1,250);step(far,[forward(1,mk|hk),neutralInput()]);for(let i=0;i<130;i++)step(far);expect(far.fighters[1].hp).toBe(1000);
 const game=setup(1,40),[a,b]=game.fighters;a.state='Attack';a.moveId='tornado_spin_combo';a.moveFrame=38;
 b.state='Attack';b.moveId='standing_lp';b.moveFrame=MOVES.standing_lp.startup;resolveCombat(game);
 expect(a.moveId).toBe(null);expect(a.state).toBe('Hitstun');
});

it('accepts a fresh chord up to three frames apart in either order and facing, including replay snapshots',()=>{
 for(const facing of [-1,1])for(const first of [mk,hk])for(const gap of [1,2,3]) {
  const game=setup(facing,60);
  for(let i=0;i<8;i++)step(game,[forward(facing),neutralInput()]);
  step(game,[forward(facing,first),neutralInput()]);
  const replay=createReplay(game);
  for(let frame=1;frame<150;frame++) {
   const inputs:[ReturnType<typeof neutralInput>,ReturnType<typeof neutralInput>]=[forward(facing,frame<gap?first:mk|hk),neutralInput()];
   replay.frames.push({inputs,events:[]});step(game,inputs);
   if(frame===gap) {
    expect(game.fighters[0].moveId).toBe('tornado_spin_combo');
    expect(game.fighters[0].moveFrame).toBe(gap);
    expect(game.fighters[0].attackId).toBe(1);
   }
  }
  expect(game.fighters[1].hp).toBe(820);
  expect(game.fighters[0].attackId).toBe(1);
  expect(playReplay(parseReplay(replay))).toEqual(game);
 }
});
it('rejects late, released, direction-interrupted, higher-priority and hitstop chords',()=>{
 for(const first of [mk,hk])for(const reason of ['late','release','direction','priority','hitstop']) {
  const game=setup();step(game,[forward(1,first),neutralInput()]);
  if(reason==='hitstop')game.hitstop=4;
  for(let i=0;i<(reason==='late'?3:reason==='hitstop'?4:1);i++)
   step(game,[reason==='direction'?{...neutralInput(),buttons:first}:forward(1,reason==='release'?0:first),neutralInput()]);
  step(game,[forward(1,mk|hk|(reason==='priority'?buttonBit('HP'):0)),neutralInput()]);
  expect(game.fighters[0].moveId).toBe(first===mk?'tornado_mk':'spin_hk');
 }
});
it.each(cases)('%s turns continuously through a visible front and sweeps both arms across the torso',id=>{
 let previous=0,front=0;const hands={left:[],right:[]} as Record<string,number[]>;
 for(let t=0;t<MOVES[id].duration;t+=.5) {
  const yaw=sampleYaw(id,t)!;expect(yaw).toBeGreaterThanOrEqual(previous);previous=yaw;
  if(yaw%360>=235&&yaw%360<=305)front++;
  const p=samplePose(id,t);
  for(const side of ['left','right'])hands[side].push(p[side+'Hand'][0]-p.neck[0]);
 }
 expect(front).toBeGreaterThanOrEqual(4);
 for(const xs of Object.values(hands)){expect(Math.min(...xs)).toBeLessThan(-6);expect(Math.max(...xs)).toBeGreaterThan(6);}
});

it.each([['forward_spin_hk',MOVES.forward_spin_hk.startup],['tornado_spin_combo',highStart]] as const)('%s keeps distinct, visibly bent arms at the high kick', (id,frame)=>{
 for(const facing of [-1,1]) {
  const p=samplePose(id,frame,facing);
  const upper=(side:string)=>[p[side+'Elbow'][0]-p[side+'Shoulder'][0],p[side+'Elbow'][1]-p[side+'Shoulder'][1]];
  const left=upper('left'),right=upper('right');
  // Mirrored upper arms have equal vertical offsets; these have distinct roles.
  expect(Math.abs(left[1]-right[1])).toBeGreaterThan(4);
  for(const side of ['left','right']) {
   const u=upper(side),v=[p[side+'Hand'][0]-p[side+'Elbow'][0],p[side+'Hand'][1]-p[side+'Elbow'][1]];
   const cosine=(u[0]*v[0]+u[1]*v[1])/(Math.hypot(...u)*Math.hypot(...v));
   // Neither a straight arm nor a fully doubled-back, invisible forearm.
   expect(cosine).toBeGreaterThan(-.9);expect(cosine).toBeLessThan(.5);
  }
 }
});
