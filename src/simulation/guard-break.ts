import rules from '../data/rules.json';
import { MOVES, type CompiledMove } from '../data/schema';
import type { Fighter } from './types';

/*
 * Guard break, combo lock and unstoppable, three reusable attack properties.
 *
 *  - Guard break: a contact that the defender blocks does not end as a block.
 *    Both fighters freeze for `rules.guardBreak.freezeFrames` with the
 *    defender in block pose (the renderer flashes, see render/effects), then
 *    the strike breaks through and lands as a regular hit
 *    (combat.resolveGuardBreak).
 *  - Combo lock: once a strike of the move hits, the defender stays in hitstun
 *    (or on the floor) until the move has no hits ahead. No walking away, no
 *    jump, no block in between.
 *  - Unstoppable: from its first frame to its end the attacker cannot be hit
 *    by any move without this property. An opposing strike that would trade
 *    or interrupt the startup simply passes through, so the move always runs
 *    its full course. Two unstoppable moves still trade with each other.
 *
 * Every full-bar move (Revenge combos, Wirbel) breaks guards and locks on hit;
 * the Revenge combos (full Revenge bar) are also unstoppable, the Wirbel keeps
 * its vulnerable startup. Further moves join through the sets below;
 * everything else stays blockable and interruptible.
 */

/** Extra guard-breaking moves besides the full-bar moves. */
const EXTRA_GUARD_BREAK: readonly string[] = [];
/** Extra combo-locking moves besides the full-bar moves. */
const EXTRA_COMBO_LOCK: readonly string[] = [];
/** Extra unstoppable moves besides the Revenge combos. */
const EXTRA_UNSTOPPABLE: readonly string[] = [];

const fullBar = Object.values(MOVES).filter(move => move.command.resource !== undefined).map(move => move.id);
export const GUARD_BREAK_MOVES: ReadonlySet<string> = new Set([...fullBar, ...EXTRA_GUARD_BREAK]);
export const COMBO_LOCK_MOVES: ReadonlySet<string> = new Set([...fullBar, ...EXTRA_COMBO_LOCK]);
const revenge = Object.values(MOVES).filter(move => move.command.resource === 'revenge').map(move => move.id);
export const UNSTOPPABLE_MOVES: ReadonlySet<string> = new Set([...revenge, ...EXTRA_UNSTOPPABLE]);
export const GUARD_BREAK_FREEZE_FRAMES: number = rules.guardBreak.freezeFrames;

export function breaksGuard(move: CompiledMove): boolean { return GUARD_BREAK_MOVES.has(move.id); }
export function locksOnHit(move: CompiledMove): boolean { return COMBO_LOCK_MOVES.has(move.id); }
/** The fighter currently runs an unstoppable move (any frame, startup included). */
export function runsUnstoppable(f: Fighter): boolean {
  return f.state === 'Attack' && f.moveId !== null && UNSTOPPABLE_MOVES.has(f.moveId);
}
/** `attacker`'s strike cannot touch `defender`: only unstoppable moves reach an unstoppable fighter. */
export function shieldedFrom(defender: Fighter, attacker: Fighter): boolean {
  return runsUnstoppable(defender) && !runsUnstoppable(attacker);
}

/** Pending guard break: the blocked contact that lands when the freeze ends. */
export interface GuardBreak {
  attacker: number;
  defender: number;
  /** attackId of the breaking move; a different attack cancels the break. */
  attackId: number;
  /** Hit group of the blocked strike. */
  group: string;
  /** Direction from attacker to defender at the contact. */
  side: number;
  /** Combat frame of the blocked contact. */
  frame: number;
}

const lastHits = new Map<string, number>();
/** Last move frame with an active hitbox. */
export function lastHitFrame(moveId: string): number {
  let frame = lastHits.get(moveId);
  if (frame === undefined) {
    frame = MOVES[moveId].frames.reduce((last, boxes, index) => boxes.hitboxes.length ? index : last, -1);
    lastHits.set(moveId, frame);
  }
  return frame;
}

/**
 * Keeps a locked defender in hitstun or on the floor while the locking move
 * still has hits ahead; afterwards the regular stun runs out. Runs once per
 * combat frame before the fighters move. `attackers` are the defender's
 * opponents (one in versus, every enemy for the survival player).
 */
export function holdComboLock(defender: Fighter, attackers: readonly Fighter[]): void {
  if (defender.lockedBy === undefined) return;
  const active = attackers.some(attacker => attacker.state === 'Attack' && attacker.moveId !== null &&
    attacker.attackId === defender.lockedBy && attacker.moveFrame < lastHitFrame(attacker.moveId));
  if (!active || defender.state === 'KO') { delete defender.lockedBy; return; }
  if (defender.state === 'Hitstun' || (defender.state === 'Knockdown' && defender.y === 0)) defender.remaining = Math.max(defender.remaining, 2);
}
