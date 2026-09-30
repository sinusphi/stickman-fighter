import {expect,it} from 'vitest';
import {MOVES} from '../../src/data/schema';
import moves from '../../src/data/moves.json';
import poses from '../../src/data/poses.json';
import baseline from '../fixtures/contact-retiming.json';
import {createGame,step,snapshot} from '../../src/simulation/state';
import {collectContacts,resolveCombat} from '../../src/simulation/combat';
import {capsulesOverlap} from '../../src/simulation/pose-contact';
import {buttonBit,neutralInput} from '../../src/input/types';
import {createReplay,parseReplay,playReplay,validateSnapshot} from '../../src/debug/replay';

const hash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),n=>n.toString(16).padStart(2,'0')).join('');
it('preserves every damage, stun and pushback value, the fast punches and the full uppercut',async()=>{
 for(const m of moves)expect(m).toMatchObject(baseline.damage[m.id as keyof typeof baseline.damage]);
 for(const [id,digest] of Object.entries(baseline.preserved))expect(await hash(moves.find(m=>m.id===id)),id).toBe(digest);
 expect(await hash({animation:poses.animations.jumping_uppercut,poses:Object.fromEntries(Object.entries(poses.poses).filter(([id])=>id.startsWith('jumping_uppercut_')))})).toBe(baseline.uppercut);
});
it('matches each heavy normal phase to its middle reference, with all middle/high normals on the light-kick clock',()=>{
 for(const stance of ['standing','crouching','airborne'])for(const [suffix,ref] of [['hp','mp'],['hk','mk'],['rhk','mk']]) {
  const a=MOVES[`${stance}_${suffix}`],b=MOVES[`${stance}_${ref}`];
  for(const key of ['startup','active','recovery','hitstop','duration'] as const)expect(a[key]).toBe(b[key]);
 }
 for(const stance of ['standing','crouching','airborne'])for(const suffix of ['lmk','mk','hk','rhk']) {
  const move=MOVES[`${stance}_${suffix}`],light=MOVES[`${stance}_${suffix==='lmk'||suffix==='hk'?'lk':'rlk'}`];
  for(const key of ['startup','active','recovery','duration'] as const)expect(move[key]).toBe(light[key]);
 }
 for(const id of ['spin_hk','forward_spin_hk'])for(const key of ['startup','active','recovery','duration'] as const)expect(MOVES[id][key]).toBe(MOVES.standing_mk[key]);
 const combo=MOVES.tornado_spin_combo,high=combo.frames.flatMap((f,i)=>f.hitboxes.some(b=>b.hitGroup==='spin')?[i]:[]);
 expect(high).toEqual(Array.from({length:MOVES.forward_spin_hk.active},(_,i)=>32+MOVES.forward_spin_hk.startup+i));
 expect(combo.duration-32).toBe(MOVES.forward_spin_hk.duration);
});
it('rejects the empty corners of diagonal limb rectangles, including parallel and zero-length segments',()=>{
 expect(capsulesOverlap([0,0,20,20,1],[0,20,0,20,1])).toBe(false);
 expect(capsulesOverlap([0,0,20,20,1],[10,10,10,10,1])).toBe(true);
 expect(capsulesOverlap([0,0,20,0,1],[0,3,20,3,1])).toBe(false);
 expect(capsulesOverlap([0,0,20,20,1],[0,20,20,0,1])).toBe(true);
 expect(capsulesOverlap([0,0,0,0,1],[3,0,3,0,1])).toBe(false);
});
it.each([-1,1])('hits close targets, whiffs out of visible reach and stays inactive during preparation/recovery, facing %s',facing=>{
 for(const id of ['standing_hp','standing_mk','standing_lmk','standing_hk','standing_rhk','spin_hk','forward_spin_hk'])for(const distance of [50,100]) {
  const game=createGame(),[a,b]=game.fighters,move=MOVES[id];a.x=480*256;b.x=a.x+facing*distance*256;
  a.facing=a.attackFacing=facing as -1|1;b.facing=-facing as -1|1;a.state='Attack';a.moveId=id;
  let hits=0;
  for(let frame=0;frame<move.duration;frame++) {
   a.moveFrame=frame;const contacts=collectContacts(game).filter(c=>c.hitGroup.id!=='knee');
   if(frame<move.startup||frame>=move.startup+move.active)expect(contacts).toHaveLength(0);
   hits+=contacts.length;
  }
  expect(hits>0,`${id}/${distance}`).toBe(distance===50);
 }
});
it.each([-1,1])('retains the pre-pushback contact through hitstop and snapshot replay, facing %s',facing=>{
 const game=createGame(),[a,b]=game.fighters;a.x=480*256;b.x=a.x+facing*50*256;
 a.facing=a.attackFacing=facing as -1|1;b.facing=-facing as -1|1;
 const replay=createReplay(game);let frozen:ReturnType<typeof snapshot>|undefined,cut=0;
 for(let i=0;i<80;i++) {
  const input:[ReturnType<typeof neutralInput>,ReturnType<typeof neutralInput>]=[{...neutralInput(),buttons:i===0?buttonBit('HP'):0},neutralInput()];
  replay.frames.push({inputs:input,events:[]});step(game,input);
  if(game.hitstop&&!frozen) {
   frozen=validateSnapshot(JSON.parse(JSON.stringify(game)));cut=i+1;
   expect(game.lastContact!.poses![1].state).toBe('Idle');
   expect((b.x-game.lastContact!.poses![1].x)*facing).toBe(MOVES.standing_hp.pushbackHit);
   expect(game.lastContact!.poses![0].moveFrame).toBe(MOVES.standing_hp.startup);
  }
 }
 expect(frozen).toBeDefined();expect(b.hp).toBe(915);
 expect(playReplay(parseReplay(replay))).toEqual(game);
 for(const entry of replay.frames.slice(cut))step(frozen!,entry.inputs);
 expect(frozen).toEqual(game);
});
it.each([['standing_hp',80],['standing_lmk',84],['standing_mk',84],['standing_hk',90]] as const)('%s rejects a previously accepted phantom hit at distance %s',(id,distance)=>{
 for(const facing of [-1,1]) {
  const game=createGame(),[a,b]=game.fighters,move=MOVES[id];a.x=480*256;b.x=a.x+facing*distance*256;
  a.facing=a.attackFacing=facing as -1|1;b.facing=-facing as -1|1;a.state='Attack';a.moveId=id;
  for(a.moveFrame=move.startup;a.moveFrame<move.startup+move.active;a.moveFrame++)expect(collectContacts(game)).toHaveLength(0);
 }
});
it.each([['LMK','standing_lmk'],['MK','standing_mk']] as const)('%s has no hidden lunge and cannot hit from the old 100-pixel starting distance',(button,id)=>{
 for(const facing of [-1,1]) {
  const game=createGame(),[a,b]=game.fighters;a.x=480*256;b.x=a.x+facing*100*256;
  a.facing=a.attackFacing=facing as -1|1;b.facing=-facing as -1|1;
  for(let frame=0;frame<MOVES[id].duration+2;frame++)step(game,[{...neutralInput(),buttons:frame===0?buttonBit(button):0},neutralInput()]);
  expect(a.x).toBe(480*256);expect(game.lastContact).toBeNull();expect(b.hp).toBe(1000);
 }
});
it('rejects malformed contact snapshots and keeps the uppercut presentation unchanged',()=>{
 const g=createGame(),[a,b]=g.fighters;a.x=400*256;b.x=450*256;a.state='Attack';a.moveId='standing_hp';a.moveFrame=MOVES.standing_hp.startup;resolveCombat(g);
 expect(g.lastContact?.poses).toBeDefined();g.lastContact!.poses![0].x=Infinity;
 expect(()=>validateSnapshot(g)).toThrow(/Kontaktposition/);
 const upper=createGame();upper.fighters[0].x=400*256;upper.fighters[1].x=440*256;
 for(let i=0;i<40&&!upper.lastContact;i++)step(upper,[{...neutralInput(),right:i===0,buttons:i===0?buttonBit('HP'):0},neutralInput()]);
 expect(upper.lastContact).not.toBeNull();expect(upper.lastContact?.poses).toBeUndefined();
});
