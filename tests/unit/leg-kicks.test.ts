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
it('raises both middle kicks while matching their corresponding light-kick clock',()=>{
  for(const [id,animation] of Object.entries(originalMiddle.animations)) {
    const light=id.replace(/_lmk$/,'_lk').replace(/_mk$/,'_rlk');
    expect(animations[id].durationFrames).toBe(animations[light].durationFrames);
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
  // Standing rear-leg kicks add a passing key on the way in and out, where the
  // bent rear leg swings past the front leg. From the knee chamber through the
  // rechamber they are the exact counterpart of the left kick.
  const authored=(key:{pose:string})=>!/_(pass|repass)$/.test(key.pose);
  for(const [left,right] of [['lk','rlk'],['lmk','mk'],['hk','rhk']]) {
    const source=`${stance}_${left}`,target=`${stance}_${right}`;
    const a=animations[source],b=animations[target],bk=b.keyframes.filter(authored);
    expect(a.durationFrames).toBe(b.durationFrames);
    expect(a.keyframes.map(key=>key.frame)).toEqual(bk.map(key=>key.frame));
    const shared=b.keyframes.length!==bk.length;
    const from=shared?a.keyframes.find(k=>k.pose.endsWith('_anticipate'))!.frame:a.keyframes[1].frame;
    const to=shared?a.keyframes.find(k=>k.pose.endsWith('_return'))!.frame:a.keyframes[4].frame;
    for(let frame=from;frame<=to;frame+=.5)for(const facing of [-1,1]) {
      const index=a.keyframes.findIndex(k=>k.frame>frame),n=index<0?a.keyframes.length-2:index-1;
      const phase=(frame-a.keyframes[n].frame)/(a.keyframes[n+1].frame-a.keyframes[n].frame);
      const rightTime=bk[n].frame+phase*(bk[n+1].frame-bk[n].frame);
      const l=samplePose(source,frame,facing),r=samplePose(target,rightTime,facing);
      const ld=sampleDepths(source,frame),rd=sampleDepths(target,rightTime);
      // Rear-leg kicks keep the near leg in front: leg layers are deliberately not mirrored.
      const standing=stance==='standing',planted=['plantedSupport','plantedStraight','plantedPivot'].includes(b.legInterpolation??''),support=/^right(Knee|Foot)$/;
      for(const joint of Object.keys(ld))if(!(standing && /Knee|Foot/.test(joint)))expect(rd[swap(joint)]).toBe(ld[joint]);
      // Right kicks keep their front foot planted (solved support leg); the
      // rest of the body follows the left kick relative to the hip. The
      // straightened support of middle/high kicks lifts the hip slightly.
      if(planted)expect(Math.abs(r.hip[1]-l.hip[1]),`${target}/${frame}: hip height`).toBeLessThan(b.legInterpolation==='plantedSupport'?1.5:3.5);
      for(const joint of Object.keys(l)) {
        // Arm tangents depend on the neighbouring keys; the keys themselves match.
        if(/Shoulder|Elbow|Hand/.test(joint) && phase!==0 && phase!==1)continue;
        if(planted && support.test(joint))continue;
        for(let axis=0;axis<2;axis++)expect(planted?r[swap(joint)][axis]-r.hip[axis]:r[swap(joint)][axis],`${target}/${frame}/${joint}`).toBeCloseTo(planted?l[joint][axis]-l.hip[axis]:l[joint][axis],9);
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

it('standing right middle/high kicks stand on the straight front leg and swing the bent rear leg past it',()=>{
  const bend=(pose:Record<string,number[]>,side:string)=>{
    const hip=pose.hip,knee=pose[side+'Knee'],foot=pose[side+'Foot'];
    const a=Math.atan2(knee[1]-hip[1],knee[0]-hip[0]),b=Math.atan2(foot[1]-knee[1],foot[0]-knee[0]);
    return Math.abs(((b-a)*180/Math.PI+540)%360-180);
  };
  for(const id of ['standing_mk','standing_rhk'])for(const facing of [1,-1]) {
    const animation=animations[id],key=(suffix:string)=>animation.keyframes.find(k=>k.pose===id+suffix)!.frame;
    // Left counterpart whose rear support the pivoting support leg mirrors.
    const mirror=id==='standing_mk'?'standing_lmk':'standing_hk';
    const start=samplePose(id,0,facing);
    for(let frame=0;frame<animation.durationFrames;frame+=.25) {
      const pose=samplePose(id,frame,facing);
      // The guard's front (left) foot stays where it stands: the rear leg kicks.
      // The high kick pivots it in under the body instead (see below).
      if(animation.legInterpolation!=='plantedPivot')expect(pose.leftFoot[0],`${id}/${frame}: support foot`).toBeCloseTo(start.leftFoot[0],6);
      else {
        const next=samplePose(id,frame+.25,facing).leftFoot;
        // Never faster than the left kick's own rear support (slides with the hip at the follow-through).
        const l=samplePose(mirror,frame,facing).rightFoot,ln=samplePose(mirror,frame+.25,facing).rightFoot;
        expect(Math.abs(next[0]-pose.leftFoot[0])/.25,`${id}/${frame}: pivot speed`).toBeLessThan(Math.max(8,Math.abs(ln[0]-l[0])/.25+.5));
      }
      expect(Math.abs(pose.leftFoot[1]),`${id}/${frame}: support on floor`).toBeLessThan(1.5);
      // The rear leg is the near leg when facing right: it never swaps behind the support leg.
      const depths=sampleDepths(id,frame);
      expect(depths.rightKnee,`${id}/${frame}: leg layer`).toBe(poses.segmentDepths.rightKnee);
      expect(depths.leftKnee).toBe(poses.segmentDepths.leftKnee);
    }
    // Middle and high kick: from the chamber through the follow-through the
    // support leg stands angled back exactly like the rear support of the left kick.
    expect(animation.legInterpolation,`${id}: pivots over the support leg`).toBe('plantedPivot');
    for(let frame=key('_anticipate');frame<=key('_follow');frame+=.25) {
      const r=samplePose(id,frame,facing),l=samplePose(mirror,frame,facing);
      for(let axis=0;axis<2;axis++)expect(r.leftFoot[axis]-r.hip[axis],`${id}/${frame}: support angled back`).toBeCloseTo(l.rightFoot[axis]-l.hip[axis],6);
      expect((r.leftFoot[0]-r.hip[0])*facing,`${id}/${frame}: support behind hip`).toBeLessThan(0);
    }
    // From the knee chamber through the follow-through the support leg is (nearly) straight.
    for(let frame=key('_anticipate');frame<=key('_follow');frame+=.25)
      expect(bend(samplePose(id,frame,facing),'left'),`${id}/${frame}: straight support`).toBeLessThan(25);
    // Passing the front leg the kicking leg is clearly bent and lifted.
    const pass=samplePose(id,key('_pass'),facing);
    expect(bend(pass,'right')).toBeGreaterThan(40);expect(-pass.rightFoot[1]).toBeGreaterThan(8);
    // No snap back: the frames after the rechamber move the feet gradually.
    for(let frame=key('_return');frame<animation.durationFrames-1;frame+=.25)for(const foot of ['leftFoot','rightFoot']) {
      const a=samplePose(id,frame,facing)[foot],b=samplePose(id,frame+.25,facing)[foot];
      expect(Math.hypot(b[0]-a[0],b[1]-a[1])/.25,`${id}/${frame}: ${foot} speed`).toBeLessThan(22);
    }
  }
});
