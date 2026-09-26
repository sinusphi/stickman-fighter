import { expect, it } from 'vitest';
import { animations, samplePose, type Pose } from '../../src/render/skeleton';
import { FIGURE_STYLE } from '../../src/platform/theme';

const deg=(a:number[],b:number[])=>Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI;

// Reference 12 (refs/referenz_12_grund_koerperhaltung_stehen_und_gehen.png):
// hunched torso, head hanging forward, open stride, feet planted. Per user
// correction the arms do not hang: both fists stay raised in the fighting guard.
const guardHeld=(p:Pose)=>{
  const headTop=p.head[1]-FIGURE_STYLE.headRadius;
  for(const side of ['left','right']) {
    expect(p[side+'Hand'][1]).toBeLessThan(p.neck[1]+10);
    expect(p[side+'Hand'][1]).toBeGreaterThan(headTop);
    expect(p[side+'Hand'][0]).toBeGreaterThan(p.hip[0]);
  }
  // Lead fist ahead of the face, rear fist in front of the chest.
  expect(p.leftHand[0]).toBeGreaterThan(p.head[0]+FIGURE_STYLE.headRadius);
  expect(p.rightHand[0]).toBeLessThan(p.leftHand[0]);
};
it.each([0,38,75,113])('Idle frame %s holds the hunched Reference 12 stance with a raised guard',frame=>{
  const p=samplePose('Idle',frame);
  const lean=90+deg(p.hip,p.neck);
  expect(lean).toBeGreaterThan(12);expect(lean).toBeLessThan(20);
  const head=90+deg(p.neck,p.head);
  expect(head).toBeGreaterThan(30);expect(head).toBeLessThan(45);
  guardHeld(p);
  for(const side of ['left','right'])expect(p[side+'Foot'][1]).toBeCloseTo(0,10);
  expect(p.leftFoot[0]).toBeGreaterThan(p.hip[0]);expect(p.rightFoot[0]).toBeLessThan(p.hip[0]);
  expect(p.leftFoot[0]-p.rightFoot[0]).toBeGreaterThan(20);
});

it.each(['Walk','WalkBackward'])('%s keeps the hunched posture and never drops the guard',id=>{
  const n=animations[id].durationFrames;
  for(let i=0;i<n*4;i++) {
    const p=samplePose(id,i/4);
    expect(90+deg(p.hip,p.neck)).toBeGreaterThan(12);
    expect(90+deg(p.neck,p.head)).toBeGreaterThan(30);
    guardHeld(p);
  }
});
