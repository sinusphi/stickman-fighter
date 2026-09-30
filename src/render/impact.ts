import { MOVES, groupValue } from '../data/schema';
import type { Fighter, GameState } from '../simulation/types';
import type { Palette } from '../platform/theme';
import { animationTrails, isKneeTrail, sampleKneeSwoosh } from './skeleton';
import { drawTrail } from './figure';

export interface KneeImpact { joint: string; strength: number; blocked: boolean }

/** Presentation only. While the hitstop of a knee contact runs, the attacker is
 * frozen on the contact frame inside the knee window. The burst fades with the
 * remaining hitstop and is derived from the snapshot alone (no render history). */
export function kneeImpact(game: GameState, f: Pick<Fighter,'id'|'state'|'moveId'|'moveFrame'>, alpha = 0): KneeImpact | null {
  const contact = game.lastContact;
  if (!game.hitstop || !contact || contact.attacker !== f.id || f.state !== 'Attack' || !f.moveId) return null;
  const move = MOVES[f.moveId], knee = move?.hitGroups.find(g => g.id === 'knee' && g.activeFrames);
  if (!knee || f.moveFrame < knee.activeFrames![0] || f.moveFrame > knee.activeFrames![1]) return null;
  const joint = animationTrails(f.moveId).find(t => t.joint.endsWith('Knee'))?.joint;
  if (!joint) return null;
  const total = groupValue(move, knee, 'hitstop');
  return { joint, blocked: contact.blocked, strength: Math.max(0, Math.min(1, (game.hitstop - alpha) / total)) };
}

/** Short radial burst at the kneecap in fighter-local (already faced) space. */
export function drawKneeImpact(ctx: CanvasRenderingContext2D, point: number[], impact: KneeImpact, palette: Palette): void {
  const t = impact.strength, grow = 1 - t, scale = impact.blocked ? .7 : 1;
  if (t <= 0) return;
  const [x, y] = point;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // Expanding shock ring with an arena-coloured rim, readable on the flashing opponent.
  const ring = (6 + 10 * grow) * scale;
  ctx.globalAlpha = .3 * t; ctx.fillStyle = palette.special;
  ctx.beginPath(); ctx.arc(x, y, ring, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = .9 * t * t; ctx.strokeStyle = palette.arena; ctx.lineWidth = 3.4 * scale;
  ctx.beginPath(); ctx.arc(x, y, ring, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = t; ctx.strokeStyle = palette.special; ctx.lineWidth = 1.6 * scale; ctx.stroke();
  // Eight rays; alternating lengths read as an impact star, not a clock face.
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4 + Math.PI / 8, long = i % 2 ? .65 : 1;
    const inner = (3 + 4 * grow) * scale, outer = inner + (7 + 7 * t) * long * scale;
    const from = [x + Math.cos(angle) * inner, y + Math.sin(angle) * inner], to = [x + Math.cos(angle) * outer, y + Math.sin(angle) * outer];
    ctx.globalAlpha = t; ctx.strokeStyle = palette.arena; ctx.lineWidth = 3.6 * scale;
    ctx.beginPath(); ctx.moveTo(from[0], from[1]); ctx.lineTo(to[0], to[1]); ctx.stroke();
    ctx.strokeStyle = impact.blocked ? palette.muted : palette.special; ctx.lineWidth = 1.8 * scale; ctx.stroke();
  }
  // Bright core that shrinks as the hitstop runs out.
  ctx.globalAlpha = t; ctx.fillStyle = impact.blocked ? palette.muted : palette.rigLight;
  ctx.beginPath(); ctx.arc(x, y, (2.6 * t + 1) * scale, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = palette.special; ctx.lineWidth = 1 * scale; ctx.stroke();
  ctx.restore();
}

/** Rising-knee swoosh above the figure (canonical pose space, before facing).
 * Fades out over the trail history after the knee apex like every swing trail. */
export function drawKneeSwoosh(ctx: CanvasRenderingContext2D, id: string, time: number, facing: number, color: string, palette: Palette): void {
  for (const trail of animationTrails(id).filter(isKneeTrail)) {
    const fade = Math.min(1, Math.max(0, (trail.toFrame + trail.historyFrames - time) / trail.historyFrames));
    drawTrail(ctx, sampleKneeSwoosh(id, time, trail), color, fade, true, facing, palette.special);
  }
}
