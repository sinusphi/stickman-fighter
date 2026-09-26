import { FIGURE_SCALE } from '../../src/data/figure-scale';
import { expect, it } from 'vitest';
import { MOVES, validateMoves } from '../../src/data/schema';
import moveData from '../../src/data/moves.json';
import poseData from '../../src/data/poses.json';
import { samplePose, sampleTrail, sampleYaw, animations } from '../../src/render/skeleton';
import { spinFrameBoxes } from '../../src/data/spin-boxes';
import { createGame, step, snapshot } from '../../src/simulation/state';
import { collectContacts, resolveCombat } from '../../src/simulation/combat';
import { neutralInput, buttonBit, type Button } from '../../src/input/types';
import type { FighterState } from '../../src/simulation/types';
import { createReplay, playReplay, hash } from '../../src/debug/replay';
import { worldBox } from '../../src/simulation/collision';
import rules from '../../src/data/rules.json';

const variants=['MK','HK'] as const;
const back=(facing:number,button?:Button)=>({...neutralInput(),left:facing===1,right:facing===-1,buttons:button?buttonBit(button):0});
const forward=(facing:number,button?:Button)=>({...neutralInput(),right:facing===1,left:facing===-1,buttons:button?buttonBit(button):0});
const spinDirection=(facing:number,button:typeof variants[number])=>button==='HK'?forward(facing):back(facing);
const spinCommand=(facing:number,button?:typeof variants[number])=>button==='HK'?forward(facing,button):back(facing,button);
const id=(b:Button)=>`spin_${b.toLowerCase()}`;
function setup(facing=1) {
  const game=createGame();game.fighters[0].x=(facing===1?300:660)*256;game.fighters[1].x=(facing===1?660:300)*256;
  game.fighters[0].facing=game.fighters[0].attackFacing=facing as 1|-1;game.fighters[1].facing=-facing as 1|-1;return game;
}
it.each(variants)('%s triggers immediately with its held direction in both facings, including a simultaneous press',button=>{
  for(const facing of [-1,1])for(const heldFrames of [0,1,20]) {
    const game=setup(facing);for(let i=0;i<heldFrames;i++)step(game,[spinDirection(facing,button),neutralInput()]);
    step(game,[spinCommand(facing,button),neutralInput()]);
    expect(game.fighters[0].moveId).toBe(id(button));expect(game.fighters[0].moveFrame).toBe(0);
    expect(game.fighters[0].attackFacing).toBe(facing);
  }
});
it.each(variants)('%s stays normal without its direction, after releasing it, or after pressing kick before it',button=>{
  for(const facing of [-1,1])for(const scenario of ['neutral','released','kickFirst']) {
    const game=setup(facing);
    if(scenario==='released'){step(game,[spinDirection(facing,button),neutralInput()]);step(game);}
    step(game,[{...neutralInput(),buttons:buttonBit(button)},neutralInput()]);
    if(scenario==='kickFirst')step(game,[spinCommand(facing,button),neutralInput()]);
    expect(game.fighters[0].moveId).toBe(`standing_${button.toLowerCase()}`);
  }
});
it.each(['Blockstun','Hitstun','Crouch','CrouchWalk','Airborne','JumpSquat','Landing','Attack'] as FighterState[])('does not turn a press in %s into a spin, even on its final frame',state=>{
  for(const remaining of [1,3])for(const button of variants) {
    const game=setup(),f=game.fighters[0];f.state=state;f.remaining=remaining;
    if(state==='Crouch'||state==='CrouchWalk')f.crouching=true;
    if(state==='Airborne'){f.y=-100*256;f.vy=-100;}
    if(state==='JumpSquat')f.jumpX=0;
    if(state==='Attack'){f.moveId='standing_lp';f.moveFrame=MOVES.standing_lp.duration-remaining;}
    step(game,[spinCommand(1,button),neutralInput()]);
    expect(f.moveId?.startsWith('spin_')??false).toBe(false);
    for(let i=0;i<8;i++)step(game,[spinCommand(1,button),neutralInput()]);
    expect(f.moveId?.startsWith('spin_')??false).toBe(false);
  }
});
it('retains crouching/air normal kicks and does not treat diagonal back as 4',()=>{
  for(const button of variants)for(const posture of ['crouch','jump','air']) {
    const game=setup(),f=game.fighters[0];
    if(posture==='air'){f.state='Airborne';f.y=-100*256;f.vy=0;}
    step(game,[{...back(1,button),down:posture==='crouch',up:posture==='jump'},neutralInput()]);
    if(posture==='crouch')expect(f.moveId).toBe(`crouching_${button.toLowerCase()}`);
    if(posture==='air')expect(f.moveId).toBe(`airborne_${button.toLowerCase()}`);
    if(posture==='jump')expect(f.state).toBe('JumpSquat');
  }
});
it('never upgrades buffered or hitstop presses; holding kick does not repeat; a new press does',()=>{
  const game=setup(),f=game.fighters[0];f.state='Hitstun';f.remaining=3;
  step(game,[{...neutralInput(),buttons:buttonBit('MK')},neutralInput()]);
  step(game,[spinCommand(1,'MK'),neutralInput()]);step(game,[spinCommand(1,'MK'),neutralInput()]);
  expect(f.moveId).toBe('standing_mk');
  const stopped=setup();stopped.hitstop=2;
  step(stopped,[back(1,'LK'),neutralInput()]);step(stopped,[back(1,'LK'),neutralInput()]);step(stopped,[back(1,'LK'),neutralInput()]);
  expect(stopped.fighters[0].moveId).toBeNull();
  const repeated=setup();step(repeated,[spinCommand(1,'HK'),neutralInput()]);
  for(let n=0;n<70;n++)step(repeated,[spinCommand(1,'HK'),neutralInput()]);
  expect(repeated.fighters[0].moveId).toBe(null);expect(repeated.fighters[0].attackId).toBe(1);
  step(repeated,[forward(1),neutralInput()]);step(repeated,[spinCommand(1,'HK'),neutralInput()]);expect(repeated.fighters[0].moveId).toBe('spin_hk');
});
it('keeps punch/normal-button priorities and facing-locked attacks intact',()=>{
  for(const button of ['LP','MP','HP'] as const){const game=setup();step(game,[back(1,button),neutralInput()]);expect(game.fighters[0].moveId).toBe(`standing_${button.toLowerCase()}`);}
  const game=setup();step(game,[{...back(1),buttons:buttonBit('HP')|buttonBit('HK')},neutralInput()]);expect(game.fighters[0].moveId).toBe('standing_hp');
  const spin=setup();step(spin,[back(1,'MK'),neutralInput()]);spin.fighters[0].x=800*256;step(spin);
  expect(spin.fighters[0].facing).toBe(-1);expect(spin.fighters[0].attackFacing).toBe(1);
});
it.each(variants)('%s has synchronized framewise boxes, fixed lengths and a planted support foot during rotation',button=>{
  const move=MOVES[id(button)];let priorHit='',changed=0;const support=samplePose(move.id,Math.round(move.startup*.45)).leftFoot;
  for(let frame=0;frame<move.duration;frame++) {
    const pose=samplePose(move.id,frame),active=frame>=move.startup&&frame<move.startup+move.active;
    expect(move.frames[frame]).toMatchObject(spinFrameBoxes(pose,active));
    expect(move.frames[frame].hitboxes.length).toBe(active?1:0);
    if(active){const key=JSON.stringify(move.frames[frame].hitboxes);if(key!==priorHit)changed++;priorHit=key;}
    for(const facing of [-1,1])for(const fraction of [0,.25,.5,.75]) {
      const points=samplePose(move.id,frame+fraction,facing);
      for(const bone of poseData.skeleton.bones)expect(Math.hypot(points[bone.parent][0]-points[bone.joint][0],points[bone.parent][1]-points[bone.joint][1])).toBeCloseTo(bone.length,10);
      if(frame>=Math.round(move.startup*.45) && frame+fraction<=move.startup+move.active-1) {
        expect(points.leftFoot[0]).toBeCloseTo(support[0]*facing,8);expect(points.leftFoot[1]).toBeCloseTo(0,8);
      }
    }
  }
  expect(changed).toBeGreaterThan(0);
  expect(new Set(move.frames.map(f=>JSON.stringify(f.hurtboxes))).size).toBeGreaterThan(move.duration/2);
  expect(sampleYaw(move.id,move.startup)).toBe(-285);
  expect(sampleTrail(move.id,move.startup).length).toBeGreaterThan(5);
  const final=samplePose(move.id,move.duration-1),guard=samplePose('Idle',0);
  for(const joint of Object.keys(guard))for(const axis of [0,1])expect(final[joint][axis]).toBeCloseTo(guard[joint][axis],9);
});
it.each(variants)('%s reverses the 4+HK turn with the other leg and continuous recovery',button=>{
  const move=MOVES[id(button)];let previousYaw=0;
  for(let frame=0;frame<move.duration;frame+=.25) {
    const yaw=sampleYaw(move.id,frame)!;
    expect(yaw).toBeLessThanOrEqual(previousYaw);previousYaw=yaw;
    const pose=samplePose(move.id,frame),next=samplePose(move.id,frame+.25);
    expect(pose.hip[1]).toBeLessThan(-45);
    for(const joint of Object.keys(pose)) {
      expect(Math.hypot(next[joint][0]-pose[joint][0],next[joint][1]-pose[joint][1])).toBeLessThan(9);
      const mirrored=samplePose(move.id,frame,-1)[joint];
      expect(mirrored[0]).toBe(-pose[joint][0]);expect(mirrored[1]).toBe(pose[joint][1]);
    }
  }
  expect(previousYaw).toBe(-360);
  for(let offset=0;offset<move.active;offset++) {
    const frame=move.startup+offset,reference=samplePose('forward_spin_hk',24+offset);
    const pose=samplePose(move.id,frame);
    expect(sampleYaw(move.id,frame)).toBe(-sampleYaw('forward_spin_hk',24+offset)!);
    expect(pose.leftFoot).toEqual(reference.rightFoot);
    expect(Math.hypot(pose.rightFoot[0]-pose.hip[0],pose.rightFoot[1]-pose.hip[1])).toBeCloseTo(50,9);
    if(button==='HK') {
      expect(pose.rightFoot).toEqual(reference.leftFoot);
      expect(pose.rightKnee).toEqual(reference.leftKnee);
    } else {
      expect(pose.rightFoot[1]).toBeGreaterThan(-65);
      expect(pose.rightFoot[1]).toBeLessThan(-50);
    }
  }
});
it('retains the reference arm counterbalance through the high-spin contact',()=>{
  for(let offset=0;offset<6;offset++) {
    const pose=samplePose('spin_hk',MOVES.spin_hk.startup+offset);
    const reference=samplePose('forward_spin_hk',24+offset);
    for(const side of ['left','right'])for(const joint of ['Shoulder','Elbow','Hand'])
      expect(pose[side+joint]).toEqual(reference[side+joint]);
  }
});
it('removes the low spin and reserves back + LK without a delayed normal kick',()=>{
  expect(MOVES.spin_lk).toBeUndefined();expect(animations.spin_lk).toBeUndefined();
  for(const facing of [-1,1])for(const held of [0,10]) {
    const game=setup(facing);
    for(let i=0;i<held;i++)step(game,[back(facing),neutralInput()]);
    step(game,[back(facing,'LK'),neutralInput()]);
    expect(game.fighters[0].moveId).toBeNull();
    for(let i=0;i<12;i++)step(game,[{...neutralInput(),buttons:buttonBit('LK')},neutralInput()]);
    expect(game.fighters[0].attackId).toBe(0);
    step(game);step(game,[{...neutralInput(),buttons:buttonBit('LK')},neutralInput()]);
    expect(game.fighters[0].moveId).toBe('standing_lk');
  }
});
it.each(variants)('%s makes one contact, respects startup/recovery, and applies its own damage/hitstop',button=>{
  const game=setup(),[a,b]=game.fighters,move=MOVES[id(button)];a.x=400*256;b.x=442*256;
  step(game,[spinCommand(1,button),neutralInput()]);
  for(let f=1;f<move.startup;f++){step(game);expect(game.lastContact).toBe(null);}
  step(game);expect(game.lastContact?.blocked).toBe(false);expect(b.hp).toBe(1000-move.damage);expect(game.hitstop).toBe(move.hitstop);expect(b.remaining).toBe(move.hitstun);
  const pose=samplePose(move.id,a.moveFrame),x=a.x,frame=a.moveFrame;
  for(let t=0;t<move.hitstop;t++){step(game);expect(a.moveFrame).toBe(frame);expect(a.x).toBe(x);expect(samplePose(move.id,a.moveFrame)).toEqual(pose);}
  for(let t=0;t<move.duration+50;t++)step(game);
  expect(b.hp).toBe(1000-move.damage);
  for(const f of [move.startup-1,move.startup+move.active,move.duration-1]){a.state='Attack';a.moveId=move.id;a.moveFrame=f;a.hitTargets=[];expect(collectContacts(game)).toEqual([]);}
});
it.each(variants)('%s follows the block matrix and transfers exact corner pushback in both facings',button=>{
  const move=MOVES[id(button)];
  for(const facing of [-1,1])for(const crouch of [false,true]) {
    const game=setup(facing),[a,b]=game.fighters;
    b.x=facing===1?rules.stageWidth-Math.ceil(16*256*FIGURE_SCALE):Math.ceil(16*256*FIGURE_SCALE);a.x=b.x-facing*42*256;
    a.state='Attack';a.moveId=move.id;a.moveFrame=move.startup;a.attackFacing=facing as 1|-1;
    b.input.current.direction=crouch?1:4; // Body remains standing: isolate the block rule from geometric ducking.
    const start=a.x;resolveCombat(game);
    expect(game.lastContact).not.toBe(null);
    const blocked=true;expect(game.lastContact!.blocked).toBe(blocked);
    expect(a.x).toBe(start-facing*(blocked?move.pushbackBlock:move.pushbackHit));
    expect(b.hp).toBe(blocked?1000:1000-move.damage);
    expect(b.remaining).toBe(blocked?move.blockstun:move.hitstun);
  }
});
it('uses narrow moving limb boxes that miss distant targets and mirror exactly',()=>{
  const game=setup(),[a,b]=game.fighters;a.state='Attack';a.moveId='spin_mk';
  for(let frame=MOVES.spin_mk.startup;frame<MOVES.spin_mk.startup+MOVES.spin_mk.active;frame++) {
    a.moveFrame=frame;expect(collectContacts(game)).toEqual([]);
    const box=MOVES.spin_mk.frames[frame].hitboxes[0],p=samplePose('spin_mk',frame,-1).rightFoot;
    const mirrored=worldBox(box,{...a,x:0,y:0},-1);
    expect(p[0]*256*FIGURE_SCALE).toBeGreaterThanOrEqual(mirrored.x);expect(p[0]*256*FIGURE_SCALE).toBeLessThanOrEqual(mirrored.x+mirrored.width);
    expect(p[1]*256*FIGURE_SCALE).toBeGreaterThanOrEqual(mirrored.y);expect(p[1]*256*FIGURE_SCALE).toBeLessThanOrEqual(mirrored.y+mirrored.height);
  }
  expect(b.hp).toBe(1000);
});
it('replays spins deterministically and resumes an active hitstop snapshot identically',()=>{
  const game=setup();game.fighters[0].x=400*256;game.fighters[1].x=442*256;
  const replay=createReplay(game),hashes:string[]=[];let saved:ReturnType<typeof snapshot>|undefined,cut=0;
  for(let frame=0;frame<100;frame++) {
    const inputs:[ReturnType<typeof neutralInput>,ReturnType<typeof neutralInput>]=[frame===0?back(1,'MK'):neutralInput(),neutralInput()];
    replay.frames.push({inputs,events:[]});step(game,inputs);hashes.push(hash(game));
    if(game.hitstop>0&&!saved){saved=snapshot(game);cut=frame+1;}
  }
  expect(saved).toBeDefined();const replayHashes:string[]=[];expect(playReplay(replay,s=>replayHashes.push(hash(s)))).toEqual(game);expect(replayHashes).toEqual(hashes);
  for(const frame of replay.frames.slice(cut))step(saved!,frame.inputs,frame.events);expect(saved).toEqual(game);
});
it('validates the restricted hold command grammar',()=>{
  for(const change of [{directions:[1]},{buttons:['HP']},{trigger:'released'}]) {
    const copy=structuredClone(moveData);Object.assign(copy.find(m=>m.id==='spin_mk')!.command,change);expect(()=>validateMoves(copy)).toThrow(/Hold-Command/);
  }
});

import unaffectedHash from '../fixtures/kicks/unaffected-moves-sha256.json';
it('matches the approved retimed light and heavy punch data',async()=>{
  const moves=moveData.filter(m=>m.command.type==='normal' && ['LP','HP'].includes(m.button));
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(moves)));
  expect(Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('')).toBe(unaffectedHash);
});
it('keeps the spin high kick above a crouching body throughout active frames',()=>{
  for(const facing of [-1,1]) {
    const game=setup(facing),[a,b]=game.fighters;a.x=480*256;b.x=a.x+facing*42*256;b.crouching=true;b.state='Crouch';
    a.state='Attack';a.moveId='spin_hk';
    for(let frame=MOVES.spin_hk.startup;frame<MOVES.spin_hk.startup+MOVES.spin_hk.active;frame++){a.moveFrame=frame;expect(collectContacts(game)).toEqual([]);}
  }
});
it('allows a spin to trade, to be interrupted during startup, and to knock down an aerial victim',()=>{
  const trade=setup(),[a,b]=trade.fighters;a.x=400*256;b.x=444*256;
  for(const f of [a,b]){f.state='Attack';f.moveId='spin_mk';f.moveFrame=MOVES.spin_mk.startup;}
  expect(collectContacts(trade)).toHaveLength(2);resolveCombat(trade);expect(trade.fighters.map(f=>f.hp)).toEqual([920,920]);
  const interrupted=setup(),[c,d]=interrupted.fighters;c.x=400*256;d.x=435*256;
  c.state='Attack';c.moveId='spin_mk';c.moveFrame=0;d.state='Attack';d.moveId='standing_lp';d.moveFrame=MOVES.standing_lp.startup;
  resolveCombat(interrupted);expect(c.state).toBe('Hitstun');expect(c.moveId).toBe(null);expect(c.hp).toBe(970);
  const air=setup(),[e,f]=air.fighters;e.x=400*256;f.x=442*256;e.state='Attack';e.moveId='spin_hk';e.moveFrame=MOVES.spin_hk.startup;
  f.state='Airborne';f.y=-10*256;resolveCombat(air);expect(f.state).toBe('Knockdown');
});
