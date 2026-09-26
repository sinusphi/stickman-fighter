import { afterEach, expect, it, vi } from 'vitest';
import { drawFigure, eyeViews } from '../../src/render/figure';
import { animations, samplePose, sampleTurn, sampleYaw } from '../../src/render/skeleton';
import { sampleDepths } from '../../src/render/depth';
import { FIGURE_STYLE, PALETTE_KEYS, type Palette } from '../../src/platform/theme';
import data from '../../src/data/poses.json';
import { render } from '../../src/render/canvas';
import { createGame, snapshot, updateFacing } from '../../src/simulation/state';
import { FIGURE_SCALE } from '../../src/data/figure-scale';
import { MOVES } from '../../src/data/schema';

type Point = number[];
type Matrix = [number, number, number, number, number, number];
class RecordedPath {
  centers: Point[] = [];
  arc(x:number,y:number):void { this.centers.push([x,y]); }
  moveTo():void {}
  lineTo():void {}
  closePath():void {}
  rect():void {}
}

// Record actual paths submitted by drawFigure, including their Canvas matrix.
// No renderer/sampler mock: capsule arc centers are the rendered joint positions.
function recorder() {
  let matrix:Matrix=[1,0,0,1,0,0], triangle:Point[]=[];
  const stack:Matrix[]=[], seen=new Set<RecordedPath>();
  const segments:Point[][]=[], eyes:Point[][]=[];
  const point=(x:number,y:number):Point=>[matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]];
  const ctx={
    save(){stack.push([...matrix]);}, restore(){matrix=stack.pop()!;},
    transform(a:number,b:number,c:number,d:number,e:number,f:number){
      const m=matrix;
      matrix=[m[0]*a+m[2]*b,m[1]*a+m[3]*b,m[0]*c+m[2]*d,m[1]*c+m[3]*d,m[0]*e+m[2]*f+m[4],m[1]*e+m[3]*f+m[5]];
    },
    translate(x:number,y:number){this.transform(1,0,0,1,x,y);},
    scale(x:number,y:number){this.transform(x,0,0,y,0,0);},
    rotate(a:number){this.transform(Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),0,0);},
    beginPath(){triangle=[];},
    moveTo(x:number,y:number){triangle.push(point(x,y));},
    lineTo(x:number,y:number){triangle.push(point(x,y));},
    closePath(){}, clip(){}, stroke(){}, arc(){}, clearRect(){}, fillRect(){}, fillText(){},
    // Stage background and overlay text (render() only); not part of the figure checks.
    rect(){}, ellipse(){}, quadraticCurveTo(){}, strokeText(){}, drawImage(){},
    fill(path?:RecordedPath){
      if(path&&!seen.has(path)) {seen.add(path);segments.push(path.centers.map(([x,y])=>point(x,y)));}
      if(!path&&triangle.length===3)eyes.push([...triangle]);
    },
    createRadialGradient(){return {addColorStop(){}};},
    createLinearGradient(){return {addColorStop(){}};},
  };
  return {ctx:ctx as unknown as CanvasRenderingContext2D,segments,eyes};
}
const palette={...Object.fromEntries(PALETTE_KEYS.map(key=>[key,'#80a0c0'])),boxAlpha:.2} as Palette;
afterEach(()=>vi.unstubAllGlobals());

// Independent expectation: anatomical limbs turn through depth, the head stays
// above its neck in both views. The right-side back view is the fixed reference.
const expectedDepth=(id:string,value:number,facing:number,depths:Record<string,number>,fixedLegDepth=false,initialFacing=facing)=>{
  if(fixedLegDepth&&/^(left|right)(Knee|Foot)$/.test(id))return initialFacing===-1?value:-value;
  if(facing===-1||['neck','head','headCircle'].includes(id))return value;
  for(const side of ['left','right'])if(['Shoulder','Elbow','Hand'].some(part=>id===side+part))
    return value-2*depths[side+'Shoulder'];
  return -value;
};


it.each(Object.entries(animations))('renders every frame of %s with mirrored joints and opposite front/back occlusion', (id,animation)=>{
  vi.stubGlobal('Path2D',RecordedPath);
  for(let frame=0;frame<animation.durationFrames;frame++) {
    const pose=samplePose(id,frame),depths=sampleDepths(id,frame);
    const expected=[...data.skeleton.bones.map(b=>({id:b.joint,points:[pose[b.joint],pose[b.parent]]})),
      {id:'headCircle',points:[pose.head]}].sort((a,b)=>depths[a.id]-depths[b.id]);
    const right=recorder(),left=recorder();
    drawFigure(right.ctx,pose,palette.p1,palette,1,0,depths,sampleTurn(id,frame),sampleYaw(id,frame));
    drawFigure(left.ctx,pose,palette.p1,palette,-1,0,depths,sampleTurn(id,frame),sampleYaw(id,frame));
    expect(right.segments.length).toBe(expected.length);
    expect(left.segments.length).toBe(expected.length);
    const front=[...expected].sort((a,b)=>expectedDepth(a.id,depths[a.id],sampleTurn(id,frame)>=.5?-1:1,depths)-expectedDepth(b.id,depths[b.id],sampleTurn(id,frame)>=.5?-1:1,depths));
    for(const [i,segment] of front.entries())for(const [j,[x,y]] of segment.points.entries()) {
      expect(right.segments[i][j][0],`${id}/${frame}/${segment.id} canonical X`).toBeCloseTo(x,10);
      expect(right.segments[i][j][1]).toBeCloseTo(y,10);
    }
    for(const [i,segment] of [...expected].sort((a,b)=>expectedDepth(a.id,depths[a.id],sampleTurn(id,frame)>=.5?1:-1,depths)-expectedDepth(b.id,depths[b.id],sampleTurn(id,frame)>=.5?1:-1,depths)).entries())for(const [j,[x,y]] of segment.points.entries()) {
      expect(left.segments[i][j][0],`${id}/${frame}/${segment.id} back reference X`).toBeCloseTo(-x,10);
      expect(left.segments[i][j][1]).toBeCloseTo(y,10);
    }
    expect(right.eyes.length).toBe(eyeViews(sampleTurn(id,frame),sampleYaw(id,frame)).length);
    expect(left.eyes.length).toBe(right.eyes.length);
    right.eyes.forEach((triangle,n)=>triangle.forEach(([x,y],i)=>{
      expect(left.eyes[n][i][0]).toBeCloseTo(-x,10);
      expect(left.eyes[n][i][1]).toBeCloseTo(y,10);
    }));
    expect(samplePose(id,frame)).toEqual(pose);
  }
});

it('keeps the enlarged eye inside the head and preserves its centroid',()=>{
  const vertices=FIGURE_STYLE.eye.vertices;
  for(const [x,y] of vertices)expect(Math.hypot(x,y)).toBeLessThan(1);
  expect(vertices.reduce((sum,v)=>sum+v[0],0)/3).toBeCloseTo((.71+.58+.88)/3,10);
  expect(vertices.reduce((sum,v)=>sum+v[1],0)/3).toBeCloseTo((-.10+.15+.28)/3,10);
  const reference=[[.71,-.10],[.58,.15],[.88,.28]];
  for(let i=0;i<3;i++) {
    const next=(i+1)%3;
    const length=(p:readonly number[][])=>Math.hypot(p[i][0]-p[next][0],p[i][1]-p[next][1]);
    expect(length(vertices)/length(reference)).toBeCloseTo(1.21,10);
  }
});

it('renders both player slots through the same reflection after side swaps and with locked attack facing',()=>{
  vi.stubGlobal('Path2D',RecordedPath);
  for(const id of ['Idle',...Object.keys(MOVES)])for(const swapped of [false,true]) {
    const game=createGame(),frame=MOVES[id]?.startup??0;
    if(swapped)[game.fighters[0].x,game.fighters[1].x]=[game.fighters[1].x,game.fighters[0].x];
    updateFacing(game);
    const facings=game.fighters.map(f=>f.facing);
    for(const f of game.fighters) {
      if(id!=='Idle') {
        f.state='Attack';f.moveId=id;f.moveFrame=frame;
        f.attackFacing=f.facing;f.facing=f.facing===1?-1:1;
      }
    }
    const before=snapshot(game),record=recorder();
    render({getContext:()=>record.ctx} as unknown as HTMLCanvasElement,game,before,0,true,false,palette);
    const pose=samplePose(id,frame),depths=sampleDepths(id,frame);
    const expected=[...data.skeleton.bones.map(b=>({id:b.joint,points:[pose[b.joint],pose[b.parent]]})),
      {id:'headCircle',points:[pose.head]}];
    expect(record.segments.length).toBe(expected.length*2);
    for(const f of game.fighters)for(const [i,segment] of [...expected].sort((a,b)=>expectedDepth(a.id,depths[a.id],(sampleTurn(id,frame)>=.5?-1:1)*facings[f.id],depths,animations[id].fixedLegDepth,facings[f.id])-expectedDepth(b.id,depths[b.id],(sampleTurn(id,frame)>=.5?-1:1)*facings[f.id],depths,animations[id].fixedLegDepth,facings[f.id])).entries())for(const [j,[x,y]] of segment.points.entries()) {
      const drawn=record.segments[f.id*expected.length+i][j];
      expect((drawn[0]-f.x/256)/FIGURE_SCALE,`${id}/${swapped}/P${f.id}/${segment.id}`).toBeCloseTo(x*facings[f.id],10);
      expect((drawn[1]-330)/FIGURE_SCALE).toBeCloseTo(y,10);
    }
    expect(game).toEqual(before);
  }
});


it.each(['Idle','standing_mk','spin_mk'])('%s keeps the front right forearm above its own upper arm',id=>{
  vi.stubGlobal('Path2D',RecordedPath);
  const frame=MOVES[id]?.startup??0,pose=samplePose(id,frame),record=recorder();
  drawFigure(record.ctx,pose,palette.p1,palette,1,0,sampleDepths(id,frame),sampleTurn(id,frame),sampleYaw(id,frame));
  // The two recorded centers are the forearm's elbow and hand joints.
  const index=(joint:string)=>record.segments.findIndex(points=>points.length>=2&&
    points[0][0]===pose[joint][0]&&points[0][1]===pose[joint][1]);
  expect(index('rightElbow')).toBeGreaterThan(index('rightShoulder'));
  expect(index('rightHand')).toBeGreaterThan(index('rightElbow'));
});

it.each(['spin_mk','spin_hk'])('%s keeps the same rear kick leg through both mirrored turns',id=>{
  vi.stubGlobal('Path2D',RecordedPath);
  const animation=animations[id],frames=[0,animation.keyframes[2].frame,animation.keyframes[3].frame,MOVES[id].startup,MOVES[id].startup+MOVES[id].active-1];
  for(const facing of [-1,1])for(const frame of frames) {
    const pose=samplePose(id,frame),depths=sampleDepths(id,frame),record=recorder();
    drawFigure(record.ctx,pose,palette.p1,palette,facing,0,depths,sampleTurn(id,frame),sampleYaw(id,frame),animation.fixedLegDepth);
    const index=(joint:string)=>record.segments.findIndex(points=>points.length>=2&&
      points.some(([x,y])=>x===pose[joint][0]*facing&&y===pose[joint][1]));
    const left=index('leftFoot'),right=index('rightFoot');
    expect(left).toBeGreaterThanOrEqual(0);expect(right).toBeGreaterThanOrEqual(0);
    expect(Math.sign(right-left),`${id}/${facing}/${frame}`).toBe(-facing*Math.sign(depths.rightFoot-depths.leftFoot));
  }
});

it.each([0,1])('paints the turning attacker in front at close contact, player %s',attacker=>{
  vi.stubGlobal('Path2D',RecordedPath);
  const game=createGame(),a=game.fighters[attacker],b=game.fighters[1-attacker];
  a.x=480*256;b.x=a.x+(attacker===0?1:-1)*40*256;
  a.state='Attack';a.moveId='standing_mp';a.moveFrame=MOVES.standing_mp.startup;
  b.state='Hitstun';b.hitReaction='middlePunch';
  const before=snapshot(game),record=recorder();
  render({getContext:()=>record.ctx} as unknown as HTMLCanvasElement,game,before,0,true,false,palette);
  const heads=record.segments.filter(s=>s.length===1);
  for(const [index,f] of [b,a].entries()) {
    const id=f===a?'standing_mp':'HitMiddlePunch',pose=samplePose(id,f===a?MOVES.standing_mp.startup:0);
    expect(heads[index][0][0]).toBeCloseTo(f.x/256+pose.head[0]*f.facing*FIGURE_SCALE,10);
  }
  expect(game).toEqual(before);
});

it('shows two separated eyes in front, no eyes at the back and opposite profile eyes during full yaw',()=>{
 vi.stubGlobal('Path2D',RecordedPath);
 const pose=samplePose('Idle',0);
 const draw=(yaw:number)=>{const r=recorder();drawFigure(r.ctx,pose,palette.p1,palette,1,0,undefined,0,yaw);return r.eyes;};
 expect(draw(90)).toHaveLength(0);
 expect(draw(0)).toHaveLength(1);expect(draw(180)).toHaveLength(1);
 const front=draw(270);expect(front).toHaveLength(2);
 const cx=(eye:number[][])=>eye.reduce((n,p)=>n+p[0],0)/3;
 // Measure along the head's own horizontal axis: the stance tilts the head forward.
 const tilt=Math.atan2(pose.head[1]-pose.neck[1],pose.head[0]-pose.neck[0])+Math.PI/2;
 const across=(eye:number[][])=>eye.reduce((n,p)=>n+p[0]*Math.cos(tilt)+p[1]*Math.sin(tilt),0)/3;
 expect(across(front[0])-across(front[1])).toBeGreaterThan(FIGURE_STYLE.headRadius*.7);
 expect(cx(draw(0)[0])).toBeGreaterThan(pose.head[0]);expect(cx(draw(180)[0])).toBeLessThan(pose.head[0]);
 draw(360)[0].forEach((p,i)=>p.forEach((n,j)=>expect(n).toBeCloseTo(draw(0)[0][i][j],10)));
});

it('keeps every turning eye vertex inside the head throughout both revolutions',()=>{
 for(let yaw=0;yaw<=720;yaw+=.5)for(const view of eyeViews(0,yaw)) {
  expect(view.alpha).toBeGreaterThan(0);expect(view.alpha).toBeLessThanOrEqual(1);
  for(const [x,y] of FIGURE_STYLE.eye.vertices)expect(Math.hypot(view.offset+x*view.scale,y)).toBeLessThan(1);
 }
});

// Compare actual painted paths to Idle, so a shared depth formula cannot hide
// a discontinuity when entering or leaving one of these attacks.
it.each(['jumping_uppercut','spin_mk','spin_hk'])('%s enters and leaves the normal guard without swapping leg layers',id=>{
  vi.stubGlobal('Path2D',RecordedPath);
  for(const facing of [-1,1]) {
    const idle=recorder();
    drawFigure(idle.ctx,samplePose('Idle',0),palette.p1,palette,facing,0,sampleDepths('Idle',0));
    for(const frame of [0,animations[id].durationFrames-1]) {
      const attack=recorder();
      drawFigure(attack.ctx,samplePose(id,frame),palette.p1,palette,facing,0,sampleDepths(id,frame),sampleTurn(id,frame),sampleYaw(id,frame),animations[id].fixedLegDepth);
      expect(attack.segments).toEqual(idle.segments);
    }
  }
});
