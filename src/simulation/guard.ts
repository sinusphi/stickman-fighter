import type { HitLevel } from '../data/schema';
import type { Stance } from './collision';

/** Air attacks require standing guard, even when their hit level is MID/LOW. */
export function requiresCrouchGuard(level: HitLevel, attackStance: Stance = 'standing', airborne = false): boolean {
  if (airborne || attackStance === 'airborne') return false;
  return attackStance === 'crouching' || level !== 'HIGH';
}
