/**
 * Single source for which moves resolve contact against the baked silhouette
 * (pose contact) instead of boxes alone, and which joint carries each strike.
 * Used by the simulation and by scripts/generate-contact-geometry.mjs.
 */
import moves from './moves.json';

interface MoveShape { id: string; button: string; command: { type: string } }

/** Normal (non-command) moves on these buttons strike with a limb. */
const POSE_CONTACT_BUTTONS = ['HP', 'MK', 'LMK', 'HK', 'RHK'];
/** Command moves that also resolve against the silhouette. */
const POSE_CONTACT_SPECIALS = [
  'spin_mk', 'spin_hk', 'tornado_mk', 'forward_spin_hk', 'tornado_spin_combo', 'dwit_chagi',
  'left_turn_kick', 'double_high_kick', 'spin_high_middle_combo', 'middle_high_low_combo', 'middle_high_punch_combo',
  'punch_kick_combo', 'kick_punch_combo',
];

export function isPoseContactMove(move: MoveShape): boolean {
  return (move.command.type === 'normal' && POSE_CONTACT_BUTTONS.includes(move.button)) || POSE_CONTACT_SPECIALS.includes(move.id);
}

export const POSE_CONTACT_MOVES: ReadonlySet<string> = new Set((moves as MoveShape[]).filter(isPoseContactMove).map(move => move.id));

/** Multi-group moves whose hit groups are delivered by different feet. */
const STRIKE_JOINTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  middle_high_punch_combo: { leftMiddle: 'leftFoot', leftHigh: 'leftFoot', punch: 'leftHand', default: 'rightFoot' },
  middle_high_low_combo: { low: 'leftFoot', default: 'rightFoot' },
  double_high_kick: { first: 'rightFoot', default: 'leftFoot' },
  tornado_spin_combo: { spin: 'leftFoot', default: 'rightFoot' },
  punch_kick_combo: { punch: 'leftHand', default: 'rightFoot' },
  kick_punch_combo: { punch: 'leftHand', default: 'rightFoot' },
};

/** Joint that carries a hit group's strike capsule; `trailJoint` is the animation's own strike joint. */
export function strikeJoint(moveId: string, hitGroup: string, trailJoint: string): string {
  const joints = STRIKE_JOINTS[moveId];
  return joints ? joints[hitGroup] ?? joints.default : trailJoint;
}
