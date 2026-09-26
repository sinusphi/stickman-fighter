import { FIGURE_SCALE } from '../data/figure-scale';
import rules from '../data/rules.json';
import bodies from '../data/bodies.json';
import type { Fighter } from './types';
import { MOVES } from '../data/schema';

export interface Box { x: number; y: number; width: number; height: number }
export type Stance = 'standing' | 'crouching' | 'airborne';
export function stance(f: Fighter): Stance { return f.y < 0 ? 'airborne' : f.crouching ? 'crouching' : 'standing'; }
export function worldBox(box: Box, f: Fighter, facing = f.facing): Box {
  const left=Math.floor(box.x*FIGURE_SCALE),top=Math.floor(box.y*FIGURE_SCALE);
  box={...box,x:left,y:top,width:Math.ceil((box.x+box.width)*FIGURE_SCALE)-left,height:Math.ceil((box.y+box.height)*FIGURE_SCALE)-top};
  return { ...box, x: f.x + (facing === 1 ? box.x : -box.x - box.width), y: f.y + box.y };
}
export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
function localPushbox(f: Fighter): Box { return f.state === 'Attack' && f.moveId ? MOVES[f.moveId].frames[f.moveFrame].pushbox : bodies[stance(f)].pushbox; }
export function pushbox(f: Fighter): Box { return worldBox(localPushbox(f), f, f.state === 'Attack' ? f.attackFacing : f.facing); }
export function clampToStage(f: Fighter): void {
  const box = pushbox(f);
  f.x += Math.max(0, -box.x) - Math.max(0, box.x + box.width - rules.stageWidth);
}
export function resolvePushboxes(fighters: [Fighter, Fighter]): void {
  fighters.forEach(clampToStage);
  const [a, b] = fighters;
  if (!overlaps(pushbox(a), pushbox(b))) return;
  const [left, right] = a.x <= b.x ? [a, b] : [b, a];
  const l = pushbox(left), r = pushbox(right);
  const depth = l.x + l.width - r.x;
  const leftShare = Math.min(l.x, Math.ceil(depth / 2));
  const rightShare = Math.min(rules.stageWidth - r.x - r.width, depth - leftShare);
  left.x -= Math.min(l.x, depth - rightShare);
  right.x += rightShare;
}
