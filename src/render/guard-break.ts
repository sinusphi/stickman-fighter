import { GUARD_BREAK_FREEZE_FRAMES, type GuardBreak } from '../simulation/guard-break';

/**
 * Presentation only. Figure glow during a guard-break freeze (see
 * simulation/guard-break): the blocking defender lights up more and more until
 * the strike breaks through, the attacker shines faintly. Derived from the
 * snapshot alone (pending break and remaining hitstop), no render history; it
 * only rises, so there is no strobing.
 */
export function guardBreakGlow(guardBreak: GuardBreak | undefined, hitstop: number, fighter: number): number {
  if (!guardBreak) return 0;
  const built = 1 - Math.max(0, Math.min(1, hitstop / GUARD_BREAK_FREEZE_FRAMES));
  if (fighter === guardBreak.defender) return 0.3 + 0.55 * built;
  if (fighter === guardBreak.attacker) return 0.12 + 0.18 * built;
  return 0;
}
