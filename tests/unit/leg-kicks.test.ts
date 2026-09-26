import timing from '../fixtures/animation-timing.json';
import { expect, it } from 'vitest';
import { MOVES } from '../../src/data/schema';
import { animations, samplePose, buildPose } from '../../src/render/skeleton';
import poses from '../../src/data/poses.json';
import { sampleDepths } from '../../src/render/depth';
import originalMiddle from '../fixtures/kicks/original-middle.json';
import { DEFAULT_CONTROLS, validateControls } from '../../src/platform/devices';
import { BUTTON_MASK, buttonBit, neutralInput, type Button } from '../../src/input/types';
import { createGame, step, snapshot } from '../../src/simulation/state';
import { createReplay, parseReplay, playReplay, validRaw } from '../../src/debug/replay';
import { byLegRole, mirroredCrouchKick, swapSide } from './helpers/crouch-mirror';

const kicks: [Button,string][]=[['LK','left'],['LMK','left'],['HK','left'],['RLK','right'],['MK','right'],['RHK','right']];
it('raises both middle kicks while running their retimed animation at 76% speed length',()=>{
  for(const [id,animation] of Object.entries(originalMiddle.animations)) {
    expect(animations[id].durationFrames).toBe(Math.round(Math.round((Math.round(animation.durationFrames*1.25)+((timing.preparationExtension as Record<string,number>)[id]??0))*.8)*.95));
    const oldPose=originalMiddle.poses[id as keyof typeof originalMiddle.poses];
    const oldFoot=buildPose(oldPose,animation.grounded).rightFoot;
    for(const name of ['mk','lmk']) {
      const next=id.replace(/mk$/,name),leg=name==='mk'?'right':'left';
      expect(samplePose(next,MOVES[next].startup)[leg+'Foot'][1]).toBeLessThan(oldFoot[1]-(id.startsWith('crouching')?4:10));
    }
  }
});
it.each(['standing','crouching','airborne'])('%s kicks extend the assigned leg in either facing and return to the original stance',stance=>{
  for(const [button,leg] of kicks)for(const facing of [1,-1]) {
    const id=`${stance}_${button.toLowerCase()}`,move=MOVES[id],animation=animations[id];
    const start=samplePose(id,0,facing),active=samplePose(id,move.startup,facing),end=samplePose(id,animation.durationFrames-1,facing);
    const other=leg==='left'?'right':'left';
    const high=button==='HK'||button==='RHK';
    expect(active[leg+'Foot'][0]*facing,`${id} attacking foot`).toBeGreaterThan(active[other+'Foot'][0]*facing+(high?3:button==='MK'||button==='LMK'?10:15));
    if(high)expect(active[leg+'Foot'][1]).toBeLessThan(active[other+'Foot'][1]-20);
    expect(animation.trail?.joint).toBe(leg+'Foot');
    expect(end).toEqual(start);
    for(let frame=0;frame<animation.durationFrames;frame++) {
      const pose=samplePose(id,frame,facing);
      for(const bone of poses.skeleton.bones)expect(Math.hypot(pose[bone.joint][0]-pose[bone.parent][0],pose[bone.joint][1]-pose[bone.parent][1])).toBeCloseTo(bone.length,8);
    }
  }
});
it('keeps every crouching kick on a continuous chamber, strike, and recovery path',()=>{
  const crouching: [string,string][]=[
    ['crouching_lk','leftFoot'],['crouching_rlk','rightFoot'],
    ['crouching_lmk','leftFoot'],['crouching_mk','rightFoot'],
    ['crouching_hk','leftFoot'],['crouching_rhk','rightFoot'],
  ];
  const distance=(a:number[],b:number[])=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  for(const [id,foot] of crouching) {
    const move=MOVES[id],animation=animations[id];
    // The chamber must already carry the foot into the strike arc, rather
    // than teleporting a tucked shin into the hit pose on the next frame.
    const chamber=samplePose(id,move.startup-1)[foot],impact=samplePose(id,move.startup)[foot];
    expect(distance(chamber,impact),`${id}: chamber to impact`).toBeLessThan(id.endsWith('lk')?17:31);
    const recovery=animation.keyframes.find(key=>key.pose===`${id}_return`);
    if(recovery) {
      const terminal=samplePose(id,animation.durationFrames-1);
      for(const hand of ['leftHand','rightHand'])expect(distance(samplePose(id,recovery.frame)[hand],terminal[hand]),`${id}: guard recovery`).toBeLessThan(10);
    }
    if(recovery&&/(lmk|mk)$/.test(id)) {
      // A return key must already be near the crouch pose; the last two
      // display frames are reserved for settling, not for re-folding a leg.
      // Right kicks return their leg to the front place of the squat.
      const end=animation.durationFrames-1,front=mirroredCrouchKick(id)?swapSide(foot):foot;
      expect(distance(byLegRole(id,recovery.frame,samplePose(id,recovery.frame))[front],byLegRole(id,end,samplePose(id,end))[front]),`${id}: recovery settle`).toBeLessThan(8);
    }
  }
});
it('maps both nine-button keyboards and migrates stored six-button settings without discarding custom bindings',()=>{
  for(const [i,codes] of [['KeyF','KeyG','KeyH','KeyV','KeyB','KeyN'],['Numpad4','Numpad5','Numpad6','Numpad1','Numpad2','Numpad3']].entries())
    kicks.forEach(([button],j)=>expect(DEFAULT_CONTROLS.players[i].keys[button]).toBe(codes[j]));
  const old=structuredClone(DEFAULT_CONTROLS);old.schemaVersion=1;
  old.players[0].keys.MK='KeyG';old.players[1].keys.MK='Numpad5';old.players[0].keys.LP='KeyQ';
  for(const player of old.players)for(const button of ['RLK','LMK','RHK'] as const) {
    delete (player.keys as Partial<typeof player.keys>)[button];delete (player.padButtons as Partial<typeof player.padButtons>)[button];
  }
  const migrated=validateControls(old);
  expect(migrated.schemaVersion).toBe(2);expect(old.schemaVersion).toBe(1);
  expect(migrated.players[0].keys.LP).toBe('KeyQ');
  expect(migrated.players[0].keys.MK).toBe('KeyB');expect(migrated.players[0].keys.LMK).toBe('KeyG');
  expect(migrated.players[1].keys.MK).toBe('Numpad2');expect(migrated.players[1].keys.LMK).toBe('Numpad5');
  for(const player of migrated.players)expect(new Set(Object.values(player.keys)).size).toBe(13);
});
it.each(['RLK','LMK','RHK'] as const)('%s selects all stances, deals damage and replays higher input bits deterministically',button=>{
  for(const stance of ['standing','crouching','airborne'])for(const facing of [1,-1]) {
    const game=createGame(),[a,b]=game.fighters;
    a.x=480*256;b.x=a.x+facing*40*256;
    if(stance==='airborne') {a.y=-200*256;a.state='Airborne';b.y=a.y;b.state='Airborne';}
    const replay=createReplay(game);
    for(let i=0;i<50;i++) {
      const inputs:[ReturnType<typeof neutralInput>,ReturnType<typeof neutralInput>]=[
        {...neutralInput(),down:stance==='crouching',buttons:i===0?buttonBit(button):0},neutralInput()];
      replay.frames.push({inputs,events:[]});step(game,inputs);
      if(i===0)expect(a.moveId).toBe(`${stance}_${button.toLowerCase()}`);
    }
    expect(b.hp).toBeLessThan(1000);
    expect(playReplay(parseReplay(replay))).toEqual(snapshot(game));
  }
  expect(validRaw({...neutralInput(),buttons:BUTTON_MASK,taps:buttonBit(button)})).toBe(true);
  expect(validRaw({...neutralInput(),buttons:BUTTON_MASK+1})).toBe(false);
});

it.each(['standing','crouching','airborne'])('%s right kicks preserve the left path with swapped limbs at corresponding phases',stance=>{
  const swap=(joint:string)=>joint.startsWith('left')?'right'+joint.slice(4):joint.startsWith('right')?'left'+joint.slice(5):joint;
  for(const [left,right] of [['lk','rlk'],['lmk','mk'],['hk','rhk']]) {
    const source=`${stance}_${left}`,target=`${stance}_${right}`;
    const a=animations[source],b=animations[target];
    if(left==='lk'||left==='lmk') {
      expect(a.durationFrames).toBe(b.durationFrames);
      expect(a.keyframes.map(key=>key.frame)).toEqual(b.keyframes.map(key=>key.frame));
    }else expect(a.durationFrames).toBe(Math.round(b.durationFrames*.95));
    // Legs retain the same phase path. Arms retain matching authored keys;
    // their continuous velocities depend on each clip's rounded frame spacing.
    for(let frame=a.keyframes[1].frame;frame<=a.keyframes[4].frame;frame+=.5)for(const facing of [-1,1]) {
      const index=a.keyframes.findIndex(k=>k.frame>frame),n=index<0?a.keyframes.length-2:index-1;
      const phase=(frame-a.keyframes[n].frame)/(a.keyframes[n+1].frame-a.keyframes[n].frame);
      const rightTime=b.keyframes[n].frame+phase*(b.keyframes[n+1].frame-b.keyframes[n].frame);
      const l=samplePose(source,frame,facing),r=samplePose(target,rightTime,facing);
      const ld=sampleDepths(source,frame),rd=sampleDepths(target,rightTime);
      for(const joint of Object.keys(ld))expect(rd[swap(joint)]).toBe(ld[joint]);
      for(const joint of Object.keys(l)) {
        if(/Shoulder|Elbow|Hand/.test(joint) && phase!==0 && phase!==1)continue;
        for(let axis=0;axis<2;axis++)expect(r[swap(joint)][axis],`${target}/${frame}/${joint}`).toBeCloseTo(l[joint][axis],9);
      }
    }
    expect(samplePose(target,0)).toEqual(samplePose(source,0));
    expect(samplePose(target,b.durationFrames-1)).toEqual(samplePose(source,a.durationFrames-1));
  }
});

it('keeps crouching knees on their anatomical branch, plants the support foot and settles without snapping',()=>{
  // By squat role: the front leg kicks with a forward knee, the rear leg stays
  // planted on the splayed branch. Right kicks put the right leg in front.
  for(const [button] of kicks)for(const facing of [-1,1]) {
    const id=`crouching_${button.toLowerCase()}`,animation=animations[id];
    const other='right',start=samplePose(id,0,facing);
    let previous=start;
    for(let frame=.25;frame<animation.durationFrames;frame+=.25) {
      const pose=byLegRole(id,frame,samplePose(id,frame,facing));
      expect(pose.hip[1],`${id}/${frame}: hip`).toBeLessThan(-25);
      expect(pose.hip[1]).toBeGreaterThan(-32);
      expect(pose[other+'Foot'][0]).toBeCloseTo(start[other+'Foot'][0],8);
      for(const side of ['left','right']) {
        const knee=pose[side+'Knee'],foot=pose[side+'Foot'];
        const cross=((knee[0]-pose.hip[0])*(foot[1]-knee[1])-(knee[1]-pose.hip[1])*(foot[0]-knee[0]))*facing;
        expect(cross*(side==='left'?1:-1),`${id}/${frame}: knee bend`).toBeGreaterThanOrEqual(-1e-8);
        expect(Math.hypot(foot[0]-previous[side+'Foot'][0],foot[1]-previous[side+'Foot'][1])/.25,`${id}/${frame}: foot speed`).toBeLessThan(27);
      }
      previous=pose;
    }
    expect(samplePose(id,animation.durationFrames-1,facing)).toEqual(start);
  }
});
