import { describe, expect, it } from 'vitest';
import { createGame, snapshot, step } from '../../src/simulation/state';
import { HitFeedback } from '../../src/render/feedback';
import { fighterPose, sampleAngles, victoryPose, victoryYaw, VICTORY_FRAMES } from '../../src/render/skeleton';
import { eyeViews } from '../../src/render/figure';
import type { GameState } from '../../src/simulation/types';

const neutral={up:false,down:false,left:false,right:false,buttons:0};
function runToMatchOver(game: GameState, extra: number): HitFeedback {
  const feedback=new HitFeedback();
  for(let i=0;i<600 && game.round.phase!=='matchOver';i++){const old=snapshot(game);step(game,[neutral,neutral]);feedback.update(game,old);}
  for(let i=0;i<extra;i++){const old=snapshot(game);step(game,[neutral,neutral]);feedback.update(game,old);}
  return feedback;
}

describe('match winner celebration', () => {
  it('counts only for the winner of the match, not after a round', () => {
    const match=createGame();match.round.wins=[0,1];match.round.timer=1;match.fighters[0].hp=50;
    const feedback=runToMatchOver(match,20);
    expect(match.round.phase).toBe('matchOver');
    expect(feedback.victoryFrames).toEqual([0,21]); // counting starts with the deciding frame
    const round=createGame();round.round.timer=1;round.fighters[0].hp=50;
    const roundFeedback=new HitFeedback();
    for(let i=0;i<10;i++){const old=snapshot(round);step(round,[neutral,neutral]);roundFeedback.update(round,old);}
    expect(round.round.phase).toBe('roundOver');
    expect(roundFeedback.victoryFrames).toEqual([0,0]);
    feedback.reset(match);
    expect(feedback.victoryFrames).toEqual([0,0]);
  });
  it('turns to the front view and raises the fist above the head', () => {
    const f=createGame().fighters[0];
    expect(victoryYaw(0)).toBeCloseTo(0);
    expect(victoryYaw(VICTORY_FRAMES)).toBe(-90);
    expect(eyeViews(0,victoryYaw(VICTORY_FRAMES))).toHaveLength(2);
    // Poses use the right-facing reference view; the renderer mirrors them.
    const pose=fighterPose(f,f,0,true,undefined,undefined,0,VICTORY_FRAMES+20);
    expect(pose.rightHand[1]).toBeLessThan(pose.head[1]-15);
    // The fist rises on the side away from the opponent; the other hand rests on the hip.
    expect(pose.rightHand[0]).toBeLessThan(pose.hip[0]);
    expect(Math.abs(pose.leftHand[1]-pose.hip[1])).toBeLessThan(10);
  });
  it('turns first and only then punches the fist up, accelerating with height', () => {
    const guard=sampleAngles('Idle',0);
    // Absolute screen angle of the punching forearm (the torso turn alone does not move it).
    const forearm=(t: number)=>{const a=victoryPose(guard,t).angles;return a.neck+a.rightShoulder+a.rightElbow;};
    const rest=forearm(.01);
    // Until the body has almost turned to the viewer the punching arm stays put.
    let start=0;
    for(let t=.25;t<VICTORY_FRAMES;t+=.25)if(Math.abs(forearm(t)-rest)>.5){start=t;break;}
    expect(start).toBeGreaterThan(0);
    expect(victoryYaw(start)).toBeLessThan(-80);
    // Speed of the fist grows over the punch (ease-in), it is not linear.
    const speed=(t: number)=>Math.abs(forearm(t+1)-forearm(t));
    expect(speed(start+8)).toBeGreaterThan(speed(start+2)*2);
  });
  it('is continuous and leaves the guard untouched at frame 0', () => {
    const guard=sampleAngles('Idle',0);
    expect(victoryPose(guard,0)).toBe(guard);
    let last=victoryPose(guard,.25);
    for(let t=.5;t<VICTORY_FRAMES+120;t+=.25) {
      const next=victoryPose(guard,t);
      for(const joint of Object.keys(guard.angles)) {
        const delta=Math.abs(((next.angles[joint]-last.angles[joint])%360+540)%360-180);
        expect(delta,`${joint} at ${t}`).toBeLessThan(12);
      }
      last=next;
    }
  });
});
