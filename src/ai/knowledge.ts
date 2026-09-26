import { MOVES, type CompiledMove, type HitLevel } from '../data/schema';
import { FIGURE_SCALE } from '../data/figure-scale';
import bodies from '../data/bodies.json';
import type { Box } from '../simulation/collision';
import type { VisibleFighter } from './observation';
export interface ActiveBox extends Box { frame: number; group: string; level: HitLevel; damage: number }
export interface MoveKnowledge {
  id: string; stance: CompiledMove['stance']; button: CompiledMove['button']; command: CompiledMove['command'];
  startup: number; active: number; recovery: number; duration: number; damage: number;
  hitstun: number; blockstun: number; blockAdvantage: number; boxes: ActiveBox[];
  reach: number; lastActive: number;
}
/** Same integer edges as worldBox, without manufacturing a mutable Fighter. */
export function scaledBox(b: Box): Box {
  const x = Math.floor(b.x * FIGURE_SCALE), y = Math.floor(b.y * FIGURE_SCALE);
  return { x, y, width:Math.ceil((b.x+b.width)*FIGURE_SCALE)-x, height:Math.ceil((b.y+b.height)*FIGURE_SCALE)-y };
}
export function buildKnowledge(moves: Record<string, CompiledMove>): MoveKnowledge[] {
  return Object.values(moves).map(m => {
    const boxes: ActiveBox[] = [];
    m.frames.forEach((frame, i) => {
      const t = m.advance ? Math.min(1, i / m.advance.frames) : 0;
      const advance = Math.round((m.advance?.distance ?? 0) * t*t*(3-2*t));
      for (const b of frame.hitboxes) {
        const group = m.hitGroups.find(g => g.id === b.hitGroup)!;
        const scaled = scaledBox(b);
        boxes.push({ ...scaled, x:scaled.x+advance, frame:i, group:b.hitGroup, level:group.hitLevel ?? m.hitLevel, damage:group.damage ?? m.damage });
      }
    });
    const lastActive = Math.max(...boxes.map(b => b.frame));
    return { id:m.id, stance:m.stance, button:m.button, command:m.command, startup:m.startup, active:m.active,
      recovery:m.recovery, duration:m.duration, damage:m.hitGroups.reduce((n,g) => n+(g.damage??m.damage),0),
      hitstun:m.hitstun, blockstun:m.blockstun, blockAdvantage:m.blockstun-(m.duration-lastActive-1),
      boxes, reach:Math.max(...boxes.map(b => b.x+b.width)), lastActive };
  });
}
export const KNOWLEDGE = buildKnowledge(MOVES);
export const MOVE_INFO = Object.fromEntries(KNOWLEDGE.map(m => [m.id, m]));
const hurt = Object.fromEntries(Object.entries(bodies).map(([s,b]) => [s,b.hurtboxes.map(scaledBox)]));
/** Tests the perceived current geometry, never a simulated future game state. */
export function reaches(m: MoveKnowledge, self: VisibleFighter, opponent: VisibleFighter, margin = 0): boolean {
  const direction = opponent.x >= self.x ? 1 : -1;
  const dx = (opponent.x-self.x)*direction, dy = opponent.y-self.y;
  const target = hurt[opponent.y < 0 ? 'airborne' : opponent.crouching ? 'crouching' : 'standing'];
  return m.boxes.some(b => target.some(h => {
    const hx = dx + (opponent.facing === direction ? h.x : -h.x-h.width);
    return b.x < hx+h.width+margin && b.x+b.width+margin > hx && b.y < dy+h.y+h.height && b.y+b.height > dy+h.y;
  }));
}
export function nextHitLevel(moveId: string | null, frame: number): HitLevel | null {
  const next = moveId ? MOVE_INFO[moveId]?.boxes.find(b => b.frame >= frame) : undefined;
  return next?.level ?? null;
}
