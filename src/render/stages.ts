import type { Palette } from '../platform/theme';
import { mixColor } from './figure';

/** Presentation only: stages never influence simulation, replays or snapshots. */
export const STAGE_IDS = ['dojo', 'rooftop', 'shrine'] as const;
export type StageId = typeof STAGE_IDS[number];
export const DEFAULT_STAGE: StageId = 'dojo';
export const STAGES: Record<StageId, { label: string; caption: string }> = {
  dojo: { label: 'Dojo', caption: 'THE DOJO' },
  rooftop: { label: 'Rooftop', caption: 'THE ROOFTOP' },
  shrine: { label: 'Shrine', caption: 'THE SHRINE' },
};
export const isStageId = (value: unknown): value is StageId => STAGE_IDS.includes(value as StageId);

/**
 * Canvas-space layout shared by all stages. The fighting plane is depth 1 and
 * lies on the existing ground line; larger depths recede towards the horizon.
 * One world unit at depth 1 equals one canvas pixel, so fighters keep their
 * positions. `floorFront` ends the floor in a visible plinth edge above the
 * resource HUD; `hudFade` dissolves the scene into the arena colour behind the
 * health HUD so both keep their contrast.
 */
export const STAGE_VIEW = {
  width: 960, height: 420, ground: 330, horizon: 212,
  floorFront: 352, plinth: 7, hudFade: 112,
  /** Horizontal shift of the vanishing point per unit of fighter midpoint offset. */
  parallax: .08,
  shadow: { alpha: .26, radius: 24, height: 5, fadeHeight: 150 },
} as const;

/** Canvas bands the palette checks treat as fighter background and HUD background. */
export const STAGE_BANDS = { fighters: [190, 330], hudTop: [0, 80], hudBottom: [372, 420] } as const;

type Point = [number, number];
type Ctx = CanvasRenderingContext2D;

/**
 * Oblique one-point perspective: `pan` moves the vanishing point while depth 1
 * stays pinned to the fighting plane, like a camera following the fighters
 * sideways without moving the fighters themselves.
 */
class View {
  readonly eye = STAGE_VIEW.ground - STAGE_VIEW.horizon;
  constructor(readonly pan: number) {}
  x(X: number, z: number): number { return STAGE_VIEW.width/2+(X-STAGE_VIEW.width/2-this.pan)/z+this.pan; }
  y(Y: number, z: number): number { return STAGE_VIEW.horizon+(this.eye-Y)/z; }
  p(X: number, Y: number, z: number): Point { return [this.x(X,z),this.y(Y,z)]; }
  /** Depth at which the floor meets a canvas row below the horizon. */
  depthAt(y: number): number { return this.eye/(y-STAGE_VIEW.horizon); }
}

/** Fills one or many polygons with a single path, keeping draw calls low. */
function fill(ctx: Ctx, shapes: Point[] | Point[][], color: string, alpha = 1): void {
  const list=(typeof shapes[0]?.[0]==='number'?[shapes]:shapes) as Point[][];
  if(!list.length)return;
  ctx.globalAlpha=alpha;ctx.fillStyle=color;ctx.beginPath();
  for(const points of list){points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();}
  ctx.fill();ctx.globalAlpha=1;
}
function stroke(ctx: Ctx, lines: Point[] | Point[][], color: string, width = 1, alpha = 1): void {
  const list=(typeof lines[0]?.[0]==='number'?[lines]:lines) as Point[][];
  if(!list.length)return;
  ctx.globalAlpha=alpha;ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();
  for(const points of list)points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));
  ctx.stroke();ctx.globalAlpha=1;
}
/** Vertical quad in the plane X = const or z = const, given four world corners. */
const rect = (v: View, X0: number, X1: number, Y0: number, Y1: number, z: number): Point[] =>
  [v.p(X0,Y0,z),v.p(X1,Y0,z),v.p(X1,Y1,z),v.p(X0,Y1,z)];
const sideQuad = (v: View, X: number, Y0: number, Y1: number, z0: number, z1: number): Point[] =>
  [v.p(X,Y0,z0),v.p(X,Y0,z1),v.p(X,Y1,z1),v.p(X,Y1,z0)];
const floorQuad = (v: View, X0: number, X1: number, z0: number, z1: number, Y = 0): Point[] =>
  [v.p(X0,Y,z0),v.p(X1,Y,z0),v.p(X1,Y,z1),v.p(X0,Y,z1)];

/** Atmospheric perspective: distant surfaces approach the stage haze colour. */
const haze = (color: string, target: string, z: number, strength = .09): string => mixColor(color,target,1-Math.exp(-(z-1)*strength));

/** Axis-aligned box with the faces a camera at the horizon height can see. */
function box(ctx: Ctx, v: View, X0: number, X1: number, Y0: number, Y1: number, z0: number, z1: number, front: string, side: string, top: string): void {
  if(Y1<v.eye)fill(ctx,[v.p(X0,Y1,z0),v.p(X1,Y1,z0),v.p(X1,Y1,z1),v.p(X0,Y1,z1)],top);
  const vanish=STAGE_VIEW.width/2+v.pan;
  if(v.x(X0,z0)>vanish)fill(ctx,sideQuad(v,X0,Y0,Y1,z0,z1),side);
  if(v.x(X1,z0)<vanish)fill(ctx,sideQuad(v,X1,Y0,Y1,z0,z1),side);
  fill(ctx,rect(v,X0,X1,Y0,Y1,z0),front);
}

/** Deterministic hash for layout variation; rendering only, never simulation. */
const hash = (n: number): number => { const s=Math.sin(n*127.1+311.7)*43758.5453;return s-Math.floor(s); };

/** Floor, plank or tile strips from the front edge back to depth `back`.
 * Only strips that can reach the canvas are generated; each colour is one path. */
function floor(ctx: Ctx, v: View, back: number, base: string, alt: string, line: string, strip: number, cross: number[], stagger: boolean, span: readonly [number, number] = [-1e6, 1e6]): void {
  const front=v.depthAt(STAGE_VIEW.floorFront),centre=STAGE_VIEW.width/2+v.pan,reach=(STAGE_VIEW.width/2+Math.abs(v.pan)+strip)*back;
  const from=Math.max(span[0],centre-reach),to=Math.min(span[1],centre+reach);
  // Strip parity and joints are anchored in world space, so panning never re-stripes.
  const anchor=span[0]>-1e6?span[0]:0,firstIndex=Math.floor((from-anchor)/strip);
  fill(ctx,floorQuad(v,from,to,front,back),base);
  const strips: Point[][]=[],lines: Point[][]=[],joints: Point[][]=[];
  for(let i=firstIndex,X=anchor+i*strip;X<to;i++,X+=strip) {
    if(X+strip<from)continue;
    const a=Math.max(from,X),b=Math.min(to,X+strip);
    if(Math.abs(i)%2===1)strips.push(floorQuad(v,a,b,front,back));
    if(X>from)lines.push([v.p(X,0,front),v.p(X,0,back)]);
    if(stagger)for(const [index,z] of cross.entries())
      if(z>front&&z<back&&hash(i*7+index+1e4)<.34)joints.push([v.p(a,0,z),v.p(b,0,z)]);
  }
  if(!stagger)for(const z of cross)if(z>front&&z<back)lines.push([v.p(from,0,z),v.p(to,0,z)]);
  fill(ctx,strips,alt);stroke(ctx,lines,line,.8,.8);stroke(ctx,joints,line,.8,.7);
}

/** Plinth face below the floor's front edge: gives the floor a visible thickness. */
function plinth(ctx: Ctx, floorColor: string, edge: string): void {
  const y=STAGE_VIEW.floorFront;
  fill(ctx,[[0,y],[STAGE_VIEW.width,y],[STAGE_VIEW.width,y+STAGE_VIEW.plinth],[0,y+STAGE_VIEW.plinth]],mixColor(floorColor,edge,.4));
  stroke(ctx,[[0,y+.5],[STAGE_VIEW.width,y+.5]],mixColor(floorColor,edge,.15),1);
}

/** Soft light pool in the middle of the fighting area. */
function lightPool(ctx: Ctx, v: View, back: number, color: string, alpha: number): void {
  const c=v.p(STAGE_VIEW.width/2,0,1.25),gradient=ctx.createRadialGradient(c[0],c[1],10,c[0],c[1],420);
  gradient.addColorStop(0,color);gradient.addColorStop(1,color+'00');
  ctx.save();ctx.beginPath();ctx.rect(0,v.y(0,back),STAGE_VIEW.width,STAGE_VIEW.height);ctx.clip();
  ctx.globalAlpha=alpha;ctx.fillStyle=gradient;ctx.translate(c[0],c[1]);ctx.scale(1,.28);ctx.translate(-c[0],-c[1]);
  ctx.fillRect(c[0]-440,c[1]-440,880,880);ctx.restore();
}

function verticalGradient(ctx: Ctx, top: number, bottom: number, from: string, to: string): void {
  const gradient=ctx.createLinearGradient(0,top,0,bottom);
  gradient.addColorStop(0,from);gradient.addColorStop(1,to);
  ctx.fillStyle=gradient;ctx.fillRect(0,top,STAGE_VIEW.width,bottom-top);
}

// ---------------------------------------------------------------------------
// Dojo: one-point interior, wooden floor, shoji back wall, hanging lanterns.

function drawDojo(ctx: Ctx, v: View, p: Palette): void {
  const back=2.4,height=236,left=-60,right=STAGE_VIEW.width+60;
  const wood=p.dojoWood,trim=p.dojoTrim,paper=p.dojoPaper,tint=(c: string,z: number)=>haze(c,p.dojoHaze,z,.16);
  // Ceiling and ceiling beams.
  fill(ctx,[v.p(left-900,height,.6),v.p(right+900,height,.6),v.p(right,height,back),v.p(left,height,back)],p.dojoCeiling);
  for(const z of [1.3,1.7,2.1])fill(ctx,[v.p(left-900,height,z),v.p(right+900,height,z),v.p(right+900,height,z+.07),v.p(left-900,height,z+.07)],tint(wood,z));
  // Back wall: wainscot, shoji panels between posts, lintel and transom.
  fill(ctx,rect(v,left,right,0,height,back),tint(paper,back));
  fill(ctx,rect(v,left,right,0,46,back),tint(wood,back));
  fill(ctx,rect(v,left,right,168,height,back),tint(mixColor(wood,paper,.35),back));
  const posts=[left,190,480,770,right];
  for(let i=0;i<posts.length-1;i++) {
    const a=posts[i]+10,b=posts[i+1]-10;
    for(let k=1;k<4;k++)stroke(ctx,[v.p(a+(b-a)*k/4,46,back),v.p(a+(b-a)*k/4,168,back)],tint(trim,back),1,.7);
    for(let k=1;k<5;k++)stroke(ctx,[v.p(a,46+122*k/5,back),v.p(b,46+122*k/5,back)],tint(trim,back),1,.7);
  }
  for(const X of posts)fill(ctx,rect(v,X-8,X+8,0,height,back-.01),tint(wood,back));
  fill(ctx,rect(v,left,right,160,172,back-.01),tint(wood,back));
  // Hanging scroll with a brushed circle.
  const sc=back-.02;
  fill(ctx,rect(v,450,510,70,150,sc),tint(mixColor(paper,p.dojoCeiling,.2),sc));
  fill(ctx,rect(v,446,514,148,153,sc),tint(trim,sc));fill(ctx,rect(v,446,514,67,72,sc),tint(trim,sc));
  const [cx,cy]=v.p(480,112,sc);
  ctx.globalAlpha=.75;ctx.strokeStyle=tint(p.dojoAccent,sc);ctx.lineWidth=2.4;ctx.lineCap='round';
  ctx.beginPath();ctx.arc(cx,cy,19/sc*1.1,-.9,Math.PI*1.72);ctx.stroke();ctx.lineCap='butt';ctx.globalAlpha=1;
  // Side walls with receding posts and a continuous wainscot rail.
  for(const X of [left,right]) {
    const facing=X===left?1:-1,near=.6;
    fill(ctx,sideQuad(v,X,0,height,near,back),tint(paper,1.6));
    fill(ctx,sideQuad(v,X,0,46,near,back),tint(wood,1.6));
    fill(ctx,sideQuad(v,X,160,height,near,back),tint(mixColor(wood,paper,.35),1.6));
    for(const z of [.85,1.2,1.62,2.05])fill(ctx,sideQuad(v,X,0,height,z,z+.06),tint(wood,z));
    for(const Y of [80,120])stroke(ctx,[v.p(X,Y,near),v.p(X,Y,back)],tint(trim,1.6),1,.55);
    stroke(ctx,[v.p(X+facing,0,near),v.p(X+facing,0,back)],tint(trim,1.6),1.2);
  }
  // Floor with long boards and staggered joints; lamp light pools in the centre.
  floor(ctx,v,back,p.dojoFloor,p.dojoFloorAlt,tint(trim,1.2),44,[1,1.25,1.55,1.9,2.2],true,[left,right]);
  lightPool(ctx,v,back,p.stageLight,.22);
  fill(ctx,rect(v,left,right,0,6,back-.01),tint(trim,back));
  // Two paper lanterns at different depths make the room's depth readable.
  for(const [X,z] of [[250,1.55],[735,2.05]] as const) {
    const [x,top]=v.p(X,height,z),[,y]=v.p(X,196,z),r=17/z,h=24/z;
    stroke(ctx,[[x,top],[x,y-h]],tint(trim,z),1);
    const glow=ctx.createRadialGradient(x,y,1,x,y,r*4);glow.addColorStop(0,p.dojoLamp);glow.addColorStop(1,p.dojoLamp+'00');
    ctx.globalAlpha=.16;ctx.fillStyle=glow;ctx.fillRect(x-r*4,y-r*4,r*8,r*8);ctx.globalAlpha=1;
    ctx.fillStyle=tint(p.dojoLamp,z);ctx.beginPath();ctx.ellipse(x,y,r,h,0,0,Math.PI*2);ctx.fill();
    for(const k of [-.5,0,.5])stroke(ctx,[[x-r*Math.sqrt(1-k*k),y+h*k],[x+r*Math.sqrt(1-k*k),y+h*k]],tint(trim,z),.6,.45);
    fill(ctx,[[x-r*.55,y-h-2/z],[x+r*.55,y-h-2/z],[x+r*.55,y-h+2/z],[x-r*.55,y-h+2/z]],tint(trim,z));
    fill(ctx,[[x-r*.55,y+h-2/z],[x+r*.55,y+h-2/z],[x+r*.55,y+h+2/z],[x-r*.55,y+h+2/z]],tint(trim,z));
  }
  plinth(ctx,p.dojoFloor,trim);
}

// ---------------------------------------------------------------------------
// Rooftop: tiled roof, parapet, water tank and a layered skyline behind.

/** Skyline layers in screen proportions: building widths and roof lines in
 * canvas pixels, converted to world units at the layer depth. */
const SKYLINE: {z: number; count: number; width: [number, number]; top: [number, number]; windows: number; seed: number}[] = [
  { z: 30, count: 44, width: [26, 58], top: [118, 196], windows: 0, seed: 1 },
  { z: 14, count: 26, width: [40, 86], top: [132, 204], windows: .18, seed: 2 },
  { z: 7, count: 15, width: [70, 138], top: [150, 214], windows: .3, seed: 3 },
];

function drawRooftop(ctx: Ctx, v: View, p: Palette): void {
  const tint=(c: string,z: number)=>haze(c,p.roofHaze,z,.11);
  verticalGradient(ctx,0,STAGE_VIEW.horizon+30,p.roofSky,p.roofHaze);
  // Skyline layers are wider than the canvas so parallax never shows an edge.
  for(const layer of SKYLINE) {
    const {z}=layer,color=tint(p.roofCity,z),window=tint(p.roofWindow,z),step=1800/layer.count;
    for(let i=0;i<layer.count;i++) {
      const r=(k: number)=>hash(layer.seed*1000+i*10+k);
      const width=layer.width[0]+(layer.width[1]-layer.width[0])*r(1),offset=-900+i*step+r(2)*Math.max(0,step-width*.6);
      const topY=layer.top[0]+(layer.top[1]-layer.top[0])*r(3)**.8;
      const X=STAGE_VIEW.width/2+offset*z,W=width*z,top=v.eye-(topY-STAGE_VIEW.horizon)*z;
      fill(ctx,rect(v,X,X+W,-2000,top,z),color);
      if(r(4)>.7)stroke(ctx,[v.p(X+W*.5,top,z),v.p(X+W*.5,top+(6+r(5)*8)*z,z)],color,1);
      if(r(6)>.75)fill(ctx,rect(v,X+W*.2,X+W*.8,top,top+3*z,z),color);
      if(!layer.windows)continue;
      const [left,roof]=v.p(X,top,z),[right]=v.p(X+W,top,z);
      if(right<0||left>STAGE_VIEW.width)continue;
      const panes: Point[][]=[];
      for(let y=roof+6,row=0;y<STAGE_VIEW.horizon+34;y+=9,row++)for(let x=left+5,col=0;x<right-7;x+=8,col++)
        if(hash(i*977+row*31+col*7+layer.seed)<layer.windows)panes.push([[x,y],[x+3,y],[x+3,y+4],[x,y+4]]);
      fill(ctx,panes,window);
    }
  }
  const wall=2.7,wallHeight=46;
  floor(ctx,v,wall,p.roofFloor,mixColor(p.roofFloor,p.roofLine,.12),p.roofLine,60,[.95,1.1,1.28,1.5,1.78,2.12,2.55],false);
  lightPool(ctx,v,wall,p.stageLight,.16);
  // Parapet with coping along the back edge of the roof.
  fill(ctx,rect(v,-2400,STAGE_VIEW.width+2400,0,wallHeight,wall),tint(p.roofWall,wall));
  fill(ctx,[v.p(-2400,wallHeight,wall),v.p(STAGE_VIEW.width+2400,wallHeight,wall),v.p(STAGE_VIEW.width+2400,wallHeight,wall+.12),v.p(-2400,wallHeight,wall+.12)],tint(mixColor(p.roofWall,p.roofSky,.3),wall));
  fill(ctx,rect(v,-2400,STAGE_VIEW.width+2400,wallHeight-5,wallHeight,wall-.01),tint(mixColor(p.roofWall,p.roofLine,.4),wall));
  // Water tank on legs, behind the left fighter.
  const tz=2.35,tx=150,metal=tint(p.roofMetal,tz),dark=tint(mixColor(p.roofMetal,p.roofLine,.5),tz);
  for(const [X,dz] of [[112,.12],[188,.12],[112,-.06],[188,-.06]] as const)fill(ctx,rect(v,X-3,X+3,0,78,tz+dz),dark);
  stroke(ctx,[v.p(112,40,tz-.06),v.p(188,70,tz-.06)],dark,1);stroke(ctx,[v.p(188,40,tz-.06),v.p(112,70,tz-.06)],dark,1);
  const [l,bottom]=v.p(tx-48,78,tz),[r,top]=v.p(tx+48,168,tz),ry=5/tz;
  fill(ctx,[[l,top],[r,top],[r,bottom],[l,bottom]],metal);
  ctx.fillStyle=metal;ctx.beginPath();ctx.ellipse((l+r)/2,bottom,(r-l)/2,ry,0,0,Math.PI);ctx.fill();
  for(const Y of [100,124,148]){const [,y]=v.p(tx,Y,tz);stroke(ctx,[[l,y],[r,y]],dark,1,.6);}
  fill(ctx,[[l-2,top],[r+2,top],[(l+r)/2,top-26/tz]],dark);
  // Stair bulkhead with a door on the right, plus two vents.
  box(ctx,v,690,860,0,122,1.95,2.45,tint(p.roofWall,1.95),tint(mixColor(p.roofWall,p.roofLine,.35),2.1),tint(mixColor(p.roofWall,p.roofSky,.3),2.1));
  fill(ctx,rect(v,720,772,0,92,1.94),tint(p.roofLine,1.95));
  box(ctx,v,540,580,0,34,2.2,2.3,metal,dark,metal);
  box(ctx,v,600,622,0,58,2.25,2.3,metal,dark,metal);
  plinth(ctx,p.roofFloor,p.roofLine);
}

// ---------------------------------------------------------------------------
// Shrine: misty mountains, torii gate, stone path and stone lanterns.

/** Mountain ridges in screen proportions; peaks become lower towards the front. */
const RIDGES: {z: number; top: number; base: number; seed: number}[] = [
  { z: 60, top: 92, base: 205, seed: 1 },
  { z: 28, top: 128, base: 208, seed: 2 },
  { z: 13, top: 162, base: 212, seed: 3 },
];
const ridgeHeight = (x: number, seed: number): number => {
  const n=(k: number)=>hash(seed*31+k);
  return (.5+.5*Math.sin(x*.0065+n(1)*6))*.55+(.5+.5*Math.sin(x*.017+n(2)*6))*.3+(.5+.5*Math.sin(x*.043+n(3)*6))*.15;
};

function lantern(ctx: Ctx, v: View, X: number, z: number, stone: string, dark: string, light: string): void {
  box(ctx,v,X-16,X+16,0,10,z-.03,z+.03,stone,dark,stone);
  box(ctx,v,X-5,X+5,10,48,z-.01,z+.01,stone,dark,stone);
  box(ctx,v,X-13,X+13,48,54,z-.025,z+.025,stone,dark,stone);
  box(ctx,v,X-10,X+10,54,70,z-.02,z+.02,stone,dark,stone);
  fill(ctx,rect(v,X-5,X+5,57,67,z-.021),light);
  fill(ctx,[v.p(X-20,70,z),v.p(X+20,70,z),v.p(X+7,82,z),v.p(X-7,82,z)],stone);
  fill(ctx,rect(v,X-3,X+3,82,88,z),stone);
}

function drawShrine(ctx: Ctx, v: View, p: Palette): void {
  const tint=(c: string,z: number)=>haze(c,p.shrineHaze,z,.13);
  verticalGradient(ctx,0,STAGE_VIEW.horizon+20,p.shrineSky,p.shrineHaze);
  const [mx,my]=v.p(STAGE_VIEW.width/2+330*90,v.eye+(STAGE_VIEW.horizon-104)*90,90);
  ctx.fillStyle=p.shrineMoon;ctx.beginPath();ctx.arc(mx,my,15,0,Math.PI*2);ctx.fill();
  for(const ridge of RIDGES) {
    const {z}=ridge,points: Point[]=[v.p(STAGE_VIEW.width/2-1400*z,-4000,z)];
    for(let offset=-1400;offset<=1400;offset+=12) {
      const y=ridge.base-(ridge.base-ridge.top)*ridgeHeight(offset,ridge.seed);
      points.push(v.p(STAGE_VIEW.width/2+offset*z,v.eye-(y-STAGE_VIEW.horizon)*z,z));
    }
    points.push(v.p(STAGE_VIEW.width/2+1400*z,-4000,z));
    fill(ctx,points,tint(p.shrineMountain,z));
  }
  const far=9;
  fill(ctx,floorQuad(v,-6000,STAGE_VIEW.width+6000,far-.01,40),tint(p.shrineGround,12));
  // Gravel courtyard with a stone slab path towards the gate.
  floor(ctx,v,far,p.shrineGround,mixColor(p.shrineGround,p.shrineStone,.12),mixColor(p.shrineGround,p.shrineStone,.45),120,[],false);
  lightPool(ctx,v,far,p.stageLight,.18);
  const front=v.depthAt(STAGE_VIEW.floorFront);
  for(let z=front,i=0;z<far;i++) {
    const depth=.34*z**1.05,next=z+depth;
    fill(ctx,floorQuad(v,420,540,z+depth*.08,next),tint(p.shrineStone,z));
    z=next;if(i>40)break;
  }
  fill(ctx,floorQuad(v,-6000,STAGE_VIEW.width+6000,far-.3,far),tint(mixColor(p.shrineFoliage,p.shrineGround,.4),far));
  // Cedar line behind the gate in two depths, laid out in screen proportions
  // so both rows cover the full width at any pan.
  for(const [z,seed] of [[9,5],[7.4,6]] as const) {
    const color=tint(p.shrineFoliage,z),cedars: Point[][]=[];
    for(let i=0;i<40;i++) {
      const r=(k: number)=>hash(seed*100+i*7+k);
      const offset=-700+i*35+r(1)*14,width=9+r(2)*6,height=34+r(3)*30;
      if(Math.abs(offset)<60&&z<8)continue; // keep the view through the gate open
      const [x,base]=v.p(STAGE_VIEW.width/2+offset*z,0,z);
      if(x<-30||x>STAGE_VIEW.width+30)continue;
      cedars.push([[x-1.5,base],[x+1.5,base],[x+1.5,base-height*.3],[x-1.5,base-height*.3]]);
      for(const [from,to,spread] of [[.22,.72,1],[.48,.9,.78],[.7,1,.52]])
        cedars.push([[x-width*spread,base-height*from],[x+width*spread,base-height*from],[x,base-height*to-(to===1?0:2)]]);
    }
    fill(ctx,cedars,color);
  }
  // Torii: two pillars, tie beam and the curved top beam.
  const gz=4.4,gate=tint(p.shrineGate,gz),gateDark=tint(mixColor(p.shrineGate,p.shrineStone,.35),gz);
  for(const X of [380,580])fill(ctx,rect(v,X-11,X+11,0,300,gz),gate);
  fill(ctx,rect(v,340,620,238,256,gz),gate);
  fill(ctx,rect(v,470,490,256,290,gz),gateDark);
  const [l,y0]=v.p(300,300,gz),[r]=v.p(660,300,gz),[,y1]=v.p(0,322,gz),lift=10/gz*1.8;
  ctx.fillStyle=gateDark;ctx.beginPath();ctx.moveTo(l-4,y0-lift);ctx.quadraticCurveTo((l+r)/2,y0+lift*.4,r+4,y0-lift);
  ctx.lineTo(r+2,y1-lift);ctx.quadraticCurveTo((l+r)/2,y1+lift*.1,l-2,y1-lift);ctx.closePath();ctx.fill();
  fill(ctx,rect(v,330,630,286,300,gz),gate);
  // Stone lanterns along the path at three depths.
  for(const [X,z] of [[190,3.2],[770,3.2],[-170,2.05],[1130,2.05]] as const)
    lantern(ctx,v,X,z,tint(p.shrineStone,z),tint(mixColor(p.shrineStone,p.shrineFoliage,.5),z),tint(mixColor(p.shrineStone,p.shrineGate,.55),z));
  plinth(ctx,p.shrineGround,p.shrineStone);
}

const DRAW: Record<StageId, (ctx: Ctx, v: View, p: Palette) => void> = { dojo: drawDojo, rooftop: drawRooftop, shrine: drawShrine };

/** Camera pan for the current fighter midpoint (canvas units). */
export const stagePan = (midpoint: number): number => (midpoint-STAGE_VIEW.width/2)*STAGE_VIEW.parallax;

function paintStage(ctx: Ctx, stage: StageId, palette: Palette, pan: number): void {
  const {width,height}=STAGE_VIEW;
  ctx.save();
  ctx.fillStyle=palette.arena;ctx.fillRect(0,0,width,height);
  ctx.beginPath();ctx.rect(0,0,width,STAGE_VIEW.floorFront+STAGE_VIEW.plinth);ctx.clip();
  DRAW[stage](ctx,new View(pan),palette);
  ctx.restore();
  ctx.globalAlpha=1;
  const fade=ctx.createLinearGradient(0,0,0,STAGE_VIEW.hudFade);
  fade.addColorStop(0,palette.arena);fade.addColorStop(.08,palette.arena);fade.addColorStop(.45,palette.arena+'b0');fade.addColorStop(1,palette.arena+'00');
  ctx.fillStyle=fade;ctx.fillRect(0,0,width,STAGE_VIEW.hudFade);
}

/** Pan steps below this size reuse the cached stage image. */
const PAN_STEP = .5;
let cache: { stage: StageId; palette: Palette; pan: number; image: HTMLCanvasElement } | null = null;

/** Draws the complete stage background, including the HUD fade. The image is
 * cached per stage, palette and quantised pan, so a paused or standing match
 * only blits one bitmap per frame. */
export function drawStage(ctx: Ctx, stage: StageId, palette: Palette, pan = 0): void {
  const quantised=Math.round(pan/PAN_STEP)*PAN_STEP;
  if(typeof document==='undefined') { paintStage(ctx,stage,palette,quantised);return; }
  if(!cache||cache.stage!==stage||cache.palette!==palette||cache.pan!==quantised) {
    const image=cache?.image??document.createElement('canvas');
    image.width=STAGE_VIEW.width;image.height=STAGE_VIEW.height;
    paintStage(image.getContext('2d')!,stage,palette,quantised);
    cache={stage,palette,pan:quantised,image};
  }
  ctx.drawImage(cache.image,0,0);
}

/** Contact shadow on the floor; it shrinks and fades while the fighter is airborne. */
export function drawContactShadow(ctx: Ctx, x: number, halfWidth: number, lift: number, palette: Palette): void {
  const s=STAGE_VIEW.shadow,air=Math.min(1,Math.max(0,lift)/s.fadeHeight);
  const radius=Math.max(s.radius,halfWidth)*(1-air*.45);
  ctx.save();ctx.globalAlpha=s.alpha*(1-air*.7);ctx.fillStyle=palette.stageShadow;
  ctx.beginPath();ctx.ellipse(x,STAGE_VIEW.ground+1,radius,s.height*(1-air*.4),0,0,Math.PI*2);ctx.fill();ctx.restore();
}
