import type { SegmentDepths } from './animation-types';
import { DEFAULT_DEPTHS } from './depth';
import { segmentWidths } from './figure-geometry';
import data from '../data/poses.json';
import type { Pose } from './skeleton';
import { FIGURE_STYLE, type Palette } from '../platform/theme';
import { applyFacing, facingDepth } from './facing';

export function mixColor(color: string, other: string, amount: number): string {
  const target=other.slice(1).match(/../g)!.map(hex=>parseInt(hex,16));
  return '#'+color.slice(1).match(/../g)!.map((hex,i)=>Math.round(parseInt(hex,16)*(1-amount)+target[i]*amount).toString(16).padStart(2,'0')).join('');
}

/** Eye transforms in head-local space. A full yaw passes through two profiles,
 * a hidden back view and a readable two-eye front view. Legacy partial turns
 * retain their authored eye fade. */
export function eyeViews(turn: number, yaw?: number): {scale: number; offset: number; alpha: number}[] {
  if(yaw===undefined)return turn>=.95?[]:[{scale:1,offset:0,alpha:1-Math.min(1,turn/.95)}];
  const angle=yaw*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  const front=Math.max(0,-s),visibility=Math.max(0,1-3*Math.max(0,s));
  if(visibility<.01)return [];
  const center=FIGURE_STYLE.eye.vertices.reduce((sum,p)=>sum+p[0],0)/3;
  // Convex profile/front blend keeps both triangles inside the circular head,
  // including the far eye as it emerges from the opposite profile.
  const weight=Math.abs(c)+front,profile=c/weight,frontal=front/weight;
  const views=[{scale:profile+.85*frontal,offset:frontal*(.4-.85*center),alpha:visibility}];
  if(front>.15)views.push({scale:-.85*frontal,offset:profile*center+frontal*(-.4+.85*center),alpha:(front-.15)/.85});
  return views;
}

/** A single outer boundary around two unequal endpoint discs. Unlike a polygon
 * plus stroked circles, this does not add seams inside an individual segment. */
function capsule(a: number[], b: number[], r: number, s: number, path: Path2D = new Path2D()): Path2D {
  const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
  if(length<=Math.abs(r-s)) {
    const center=r>=s?a:b;path.arc(center[0],center[1],Math.max(r,s),0,Math.PI*2);
  } else {
    const angle=Math.atan2(dy,dx),spread=Math.acos((r-s)/length),lo=angle-spread,hi=angle+spread;
    path.moveTo(a[0]+r*Math.cos(lo),a[1]+r*Math.sin(lo));
    path.lineTo(b[0]+s*Math.cos(lo),b[1]+s*Math.sin(lo));
    path.arc(b[0],b[1],s,lo,hi);
    path.lineTo(a[0]+r*Math.cos(hi),a[1]+r*Math.sin(hi));
    path.arc(a[0],a[1],r,hi,lo+Math.PI*2);
  }
  path.closePath();return path;
}

/** Shared silhouette, then overlap contours in the authored painter order.
 * Pose and light use the right-hand reference view's local coordinates.
 * This renderer owns reflection, including eye, lighting and occlusion. Callers
 * pass a canonical pose and only apply position/positive display scale. */
export function drawFigure(ctx: CanvasRenderingContext2D, pose: Pose, color: string, palette: Palette, facing = 1, flash = 0, depths: Readonly<SegmentDepths> = DEFAULT_DEPTHS, turn = 0, yaw?: number, fixedLegDepth = false): void {
  const style=FIGURE_STYLE,head=pose[data.skeleton.headJoint],radius=style.headRadius;
  const segments=data.skeleton.bones.map(bone=>{
    const [width,tipWidth]=segmentWidths(bone.joint);
    return {id:bone.joint,path:capsule(pose[bone.parent],pose[bone.joint],width/2,tipWidth/2),
      joints:[{id:bone.parent,radius:width/2},{id:bone.joint,radius:tipWidth/2}]};
  });
  const headPath=new Path2D();headPath.arc(head[0],head[1],radius,0,Math.PI*2);headPath.closePath();
  segments.push({id:'headCircle',path:headPath,joints:[{id:data.skeleton.headJoint,radius}]});
  // Short connector chains (for example across the shoulder bridge) form one
  // attachment too. Use skeletal distance, never screen proximity alone.
  const joints=Object.keys(pose);
  const distances=Object.fromEntries(joints.map(a=>[a,Object.fromEntries(joints.map(b=>[b,a===b?0:Infinity]))]));
  for(const bone of data.skeleton.bones) {
    const a=pose[bone.parent],b=pose[bone.joint];
    distances[bone.parent][bone.joint]=distances[bone.joint][bone.parent]=Math.hypot(a[0]-b[0],a[1]-b[1]);
  }
  for(const k of joints)for(const a of joints)for(const b of joints)
    distances[a][b]=Math.min(distances[a][b],distances[a][k]+distances[k][b]);
  const authoredDepths={...DEFAULT_DEPTHS,...depths};
  const turningFacing=turn>=.5?-facing:facing;
  const depth=(id:string)=>facingDepth(authoredDepths[id],fixedLegDepth&&/^(left|right)(Knee|Foot)$/.test(id)?facing:turningFacing,id,authoredDepths);
  segments.sort((a,b)=>depth(a.id)-depth(b.id));
  const points=Object.values(pose),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  ctx.save();applyFacing(ctx,facing);ctx.lineCap='round';ctx.lineJoin='round';
  ctx.globalAlpha=1;ctx.strokeStyle=mixColor(color,palette.rigOutline,style.outlineMix);
  ctx.lineWidth=style.outlineWidth*2;ctx.fillStyle=color;
  // Filling the complete union after stroking leaves only its outside boundary.
  for(const segment of segments)ctx.stroke(segment.path);
  for(const segment of segments)ctx.fill(segment.path);
  const bounds=Object.values(pose),margin=radius*4;
  const minX=Math.min(...bounds.map(p=>p[0]))-margin,minY=Math.min(...ys)-margin;
  const width=Math.max(...bounds.map(p=>p[0]))-minX+margin,height=Math.max(...ys)-minY+margin;
  const axial=new Set(['neck','head','leftShoulder','rightShoulder']);
  for(const [index,segment] of segments.entries()) {
    const fill=color;
    for(const back of segments.slice(0,index)) {
      // Torso, neck and shoulder bridge form one body, never internal panels.
      if(axial.has(segment.id)&&axial.has(back.id))continue;
      ctx.save();ctx.clip(back.path);
      // Only the local attachment is seamless. An acute bend can still overlap
      // farther along the same chain and keeps its foreground boundary there.
      for(const a of segment.joints)for(const b of back.joints) {
        const pa=pose[a.id],pb=pose[b.id],distance=Math.hypot(pa[0]-pb[0],pa[1]-pb[1]);
        const connected=distances[a.id][b.id]<=1.5*(a.radius+b.radius);
        if(!connected)continue;
        const mask=new Path2D();mask.rect(minX,minY,width,height);
        mask.moveTo((pa[0]+pb[0])/2+1.5*Math.max(a.radius,b.radius)+distance/2+style.outlineWidth,(pa[1]+pb[1])/2);
        mask.arc((pa[0]+pb[0])/2,(pa[1]+pb[1])/2,1.5*Math.max(a.radius,b.radius)+distance/2+style.outlineWidth,0,Math.PI*2);
        ctx.clip(mask,'evenodd');
      }
      ctx.globalAlpha=1;ctx.strokeStyle=mixColor(fill,palette.rigOutline,style.outlineMix);
      ctx.stroke(segment.path);ctx.restore();
    }
    ctx.globalAlpha=1;ctx.fillStyle=fill;ctx.fill(segment.path);
    const light=segment.id==='headCircle'
      ?ctx.createRadialGradient(head[0]+radius*.35,head[1]-radius*.4,0,head[0],head[1],radius)
      :ctx.createLinearGradient(Math.max(...xs)+radius,Math.min(...ys)-radius,Math.min(...xs),Math.max(...ys));
    light.addColorStop(0,palette.rigLight);light.addColorStop(segment.id==='headCircle'?1:.65,fill);light.addColorStop(1,fill);
    ctx.globalAlpha=style.lightAlpha;ctx.fillStyle=light;ctx.fill(segment.path);
    if(flash>0) {
      ctx.globalAlpha=Math.min(1,flash)*.65;ctx.fillStyle=palette.rigLight;ctx.fill(segment.path);
    }
    ctx.globalAlpha=1;
    // The eye belongs to the head layer, so a foreground arm can occlude it.
    if(segment.id==='headCircle')for(const view of eyeViews(turn,yaw)) {
      const neck=pose.neck,eye=style.eye,visibility=view.alpha;
      ctx.save();ctx.translate(head[0],head[1]);ctx.rotate(Math.atan2(head[1]-neck[1],head[0]-neck[0])+Math.PI/2);
      const [a,b,c]=eye.vertices.map(([x,y])=>[view.offset+x*view.scale,y]);
      // Local-space halo scales with the head (Canvas shadowBlur alone does not).
      const cx=(a[0]+b[0]+c[0])/3*radius,cy=(a[1]+b[1]+c[1])/3*radius;
      const glowRadius=eye.glowRadius*radius;
      const glow=ctx.createRadialGradient(cx,cy,0,cx,cy,glowRadius);
      glow.addColorStop(0,palette.eyeGlow);glow.addColorStop(1,`${palette.eyeGlow}00`);
      ctx.globalAlpha=eye.glowAlpha*visibility;ctx.fillStyle=glow;
      ctx.beginPath();ctx.arc(cx,cy,glowRadius,0,Math.PI*2);ctx.fill();ctx.globalAlpha=visibility;
      ctx.beginPath();ctx.moveTo(a[0]*radius,a[1]*radius);
      ctx.lineTo(b[0]*radius,b[1]*radius);
      ctx.lineTo(c[0]*radius,c[1]*radius);ctx.closePath();
      ctx.fillStyle=palette.eye;ctx.shadowColor=palette.eyeGlow;ctx.shadowBlur=eye.glowBlur;ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
}

export function drawTrail(ctx: CanvasRenderingContext2D, points: number[][], color: string, strength = 1, arrow = true, facing = 1, accent = color): void {
  if(points.length<2)return;
  ctx.save();applyFacing(ctx,facing);ctx.lineCap='round';ctx.lineJoin='round';
  for(let i=1;i<points.length;i++) {
    const t=i/(points.length-1);
    // A broad translucent wake supplies the soft tail; the narrow colored
    // core preserves the exact path and stays legible on either theme.
    ctx.strokeStyle=accent;ctx.globalAlpha=strength*t*t*.12;ctx.lineWidth=3+6*t;
    ctx.beginPath();ctx.moveTo(points[i-1][0],points[i-1][1]);ctx.lineTo(points[i][0],points[i][1]);ctx.stroke();
    ctx.strokeStyle=color;ctx.globalAlpha=strength*t*.5;ctx.lineWidth=.55+2.6*t;
    ctx.beginPath();ctx.moveTo(points[i-1][0],points[i-1][1]);ctx.lineTo(points[i][0],points[i][1]);ctx.stroke();
    ctx.strokeStyle=accent;ctx.globalAlpha=strength*t*.55;ctx.lineWidth=.35+1.05*t;
    ctx.beginPath();ctx.moveTo(points[i-1][0],points[i-1][1]);ctx.lineTo(points[i][0],points[i][1]);ctx.stroke();
  }
  const b=points.at(-1)!;
  // Find the last nonstationary tangent, also when the end pose is held.
  const a=[...points].reverse().find(p=>Math.hypot(b[0]-p[0],b[1]-p[1])>2);
  if(arrow && a) {
    const theta=Math.atan2(b[1]-a[1],b[0]-a[0]);
    ctx.strokeStyle=accent;ctx.globalAlpha=strength*.9;ctx.lineWidth=2.1;ctx.beginPath();
    ctx.moveTo(b[0]-7*Math.cos(theta-.5),b[1]-7*Math.sin(theta-.5));ctx.lineTo(b[0],b[1]);
    ctx.lineTo(b[0]-7*Math.cos(theta+.5),b[1]-7*Math.sin(theta+.5));ctx.stroke();
  }
  ctx.restore();
}
