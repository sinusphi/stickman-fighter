import { expect, it } from 'vitest';
import { FIGURE_SCALE } from '../../src/data/figure-scale';
import { FIGURE_STYLE } from '../../src/platform/theme';
import { buildPose } from '../../src/render/skeleton';
import { MOVES } from '../../src/data/schema';
import bodies from '../../src/data/bodies.json';
import { worldBox } from '../../src/simulation/collision';
import { createGame } from '../../src/simulation/state';

it('adds one further current head radius to the outlined standing silhouette',()=>{
  // FIGURE_SCALE was derived from the Update 08 fighting guard. The relaxed
  // Reference 12 stance is intentionally lower and must not rescale the rig.
  const pose=buildPose({root:[0,-43],angles:{neck:-88,head:-2,leftShoulder:143,rightShoulder:213,leftElbow:-20,leftHand:-100,
    rightElbow:10,rightHand:-165,leftKnee:60,leftFoot:18,rightKnee:122,rightFoot:-17}},true);
  const height=Math.max(pose.leftFoot[1],pose.rightFoot[1])+FIGURE_STYLE.widths.shin[1]/2+FIGURE_STYLE.outlineWidth-(pose.head[1]-FIGURE_STYLE.headRadius-FIGURE_STYLE.outlineWidth);
  const previousScale=(height+FIGURE_STYLE.headRadius)/height;
  expect(height*(FIGURE_SCALE-previousScale)).toBeCloseTo(FIGURE_STYLE.headRadius*previousScale,10);
});
it('encloses every scaled box with subpixel rounding and exact mirrored bounds for both players',()=>{
  const frames=[...Object.values(bodies).map(body=>({...body,hitboxes:[]})),...Object.values(MOVES).flatMap(move=>move.frames)];
  for(const frame of frames)for(const box of [frame.pushbox,...frame.hurtboxes,...frame.hitboxes]) {
    for(const fighter of createGame().fighters) {
      const a=worldBox(box,fighter,1),b=worldBox(box,fighter,-1);
      expect(a.x-fighter.x+b.x-fighter.x+a.width).toBe(0);
      expect(b.width).toBe(a.width);expect(b.y).toBe(a.y);
      for(const [actual,ideal] of [[a.x-fighter.x,box.x*FIGURE_SCALE],[a.y-fighter.y,box.y*FIGURE_SCALE]]) {
        expect(Number.isInteger(actual)).toBe(true);expect(ideal-actual).toBeGreaterThanOrEqual(0);expect(ideal-actual).toBeLessThan(1);
      }
      expect(a.x+a.width-fighter.x).toBeGreaterThanOrEqual((box.x+box.width)*FIGURE_SCALE);
      expect(a.y+a.height-fighter.y).toBeGreaterThanOrEqual((box.y+box.height)*FIGURE_SCALE);
    }
  }
});
