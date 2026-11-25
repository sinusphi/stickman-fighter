/**
 * Wirbel (special_spin): 360° spin kick with the rear (right) leg, back + LP+LK+MK
 * with a full Special bar. A breakaway strike against crowds, not a finisher.
 *
 * The leg is held like a blade at a fixed angle to the body while the body
 * turns once around the planted lead (left) foot:
 *  - f0–9   weight onto the lead foot, the rear leg chambers and thrusts
 *           straight backwards (heel first, torso leans forward): rear hit,
 *  - f9–17  the body turns on; seen from the side the leg folds while it points
 *           at the viewer (yaw ≈ 90°) and opens again towards the front,
 *  - f17–19 back to the opponent (yaw 180°), the leg sweeps through in front at
 *           hip height, torso leaning back: front hit,
 *  - f19–41 the leg folds, the foot lands back on its guard spot while the body
 *           finishes the turn (yaw 360°) into the guard.
 * Hit- and hurtboxes come from spin-boxes.ts (`boxes: 'spin'`).
 */
import { guardArms } from './dwit-chagi.mjs';

/** Foot of the striking leg relative to the hip (rig units) at both hits. */
export const SPIN_REACH = { back: [-48, -3], front: [48, 2] };

export function specialSpinDefinition(G) {
  const arms = guardArms(G), L = G.leftFoot, R = G.rightFoot;
  const ground = foot => ({ foot, knee: 1, space: 'ground' });
  const hip = (x, y) => ({ foot: [x, y], knee: 1, space: 'hip' });
  return {
    id: 'special_spin', button: 'MK', buttons: ['LP', 'LK', 'MK'], direction: 4, priority: 30,
    resource: 'special', boxes: 'spin', duration: 42,
    frame: { startup: 9, active: 11, recovery: 22 },
    kickFoot: 'rightFoot',
    // Base values; each side carries its own group (one hit per side).
    hit: { damage: 50, hitLevel: 'MID', hitstun: 20, blockstun: 14, pushbackHit: 4096, pushbackBlock: 3072, hitstop: 8 },
    strikes: [
      { from: 9, to: 11, joint: 'rightFoot', group: 'back',
        hit: { damage: 50, hitLevel: 'MID', hitstun: 20, blockstun: 14, hitstop: 8, pushbackHit: 4096, pushbackBlock: 3072 } },
      { from: 17, to: 19, joint: 'rightFoot', group: 'front',
        hit: { damage: 60, hitLevel: 'MID', hitstun: 22, blockstun: 16, hitstop: 9, pushbackHit: 5120, pushbackBlock: 4096 } },
    ],
    keys: [
      { f: 0, hip: G.hip, torso: G.torso, head: G.head, arms: G.arms, yaw: 0, headYaw: 0, left: ground(L), right: ground(R) },
      // Load: weight forward over the lead foot, the rear heel peels off.
      { f: 3, hip: [3, -45], torso: -66, arms, yaw: 6, headYaw: 0, right: ground([R[0] - 2, -7]) },
      { f: 6, hip: [3, -46], torso: -60, arms, yaw: 12, headYaw: 0, right: hip(-22, 2) },
      // Rear hit: heel straight back, torso leaning away from it.
      { f: 9, ease: 'in', hip: [1, -46.5], torso: -50, arms, yaw: 18, headYaw: -20, right: hip(...SPIN_REACH.back) },
      { f: 11, ease: 'lin', torso: -52, arms, yaw: 34, headYaw: -10, right: hip(-47, -4) },
      // The leg points at the viewer: folded, knee up.
      { f: 14, hip: [4, -47], torso: -80, arms, yaw: 105, headYaw: 90, right: hip(6, 2) },
      // Front hit: back to the opponent, the leg sweeps through at hip height.
      { f: 17, ease: 'in', hip: [2, -47], torso: -108, arms, yaw: 180, headYaw: 170, right: hip(...SPIN_REACH.front) },
      { f: 19, ease: 'lin', torso: -106, arms, yaw: 198, headYaw: 190, right: hip(47, 1) },
      // Fold and land the foot on its guard spot while the turn completes.
      { f: 24, hip: [2, -46], torso: -88, arms, yaw: 255, headYaw: 250, right: hip(8, 8) },
      { f: 29, hip: [1, -45], torso: -78, arms, yaw: 310, headYaw: 310, right: ground([R[0], -6]) },
      { f: 32, torso: -75, arms, yaw: 340, headYaw: 340, right: ground(R) },
      { f: 36, hip: G.hip, torso: G.torso, head: G.head, arms: G.arms, yaw: 360, headYaw: 360 },
      { f: 41, hip: G.hip, torso: G.torso, head: G.head, arms: G.arms, yaw: 360, headYaw: 360, left: ground(L), right: ground(R) },
    ],
  };
}
