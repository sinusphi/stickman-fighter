import rules from '../data/rules.json';
import { MOVES } from '../data/schema';
import { Rng } from '../ai/rng';
import type { Facing } from '../simulation/types';
import { SURVIVAL } from './config';
import { alive, inFront, type Enemy, type SurvivalState } from './state';

/*
 * Director: decides which survival enemies may attack.
 *
 * Only enemies holding an attack token attack; everyone else waits at a
 * lurking spot (see pilot.ts). "Front" is always the side the player looks
 * at – the director only reads the player's facing, it never changes it.
 *
 *  - Front tokens (config.frontTokens) go to the closest free enemies in front.
 *  - Back tokens have their own tiny budget (config.backTokens) with a long
 *    cooldown. A back attacker walks up, shows a warning and then strikes once.
 *  - Back enemies move up to full rights when at most `promoteFrontAtMost`
 *    enemies are left in front, or when the player turns (they are in front
 *    then). Moving up starts a grace period before they may strike.
 *  - Every token starts with a small random delay; identical moves of two
 *    enemies and attack starts closer than `attackGapFrames` are vetoed.
 *
 * Cheap by design: the full evaluation runs every `intervalFrames` frames or
 * at once after the player turned; per frame only token holders are checked.
 * Lives outside the deterministic simulation like the CPU, with its own
 * seeded random stream.
 */

export type Side = 'front' | 'back';
export type BackPhase = 'approach' | 'warn' | 'strike';
interface Slot {
  side: Side;
  /** Back enemy with full attack rights (few enemies left in front). */
  promoted: boolean;
  token: Side | null;
  since: number;
  startAt: number;
  attacks: number;
  /** Back tokens: frame the warning started, null while still approaching. */
  warnAt: number | null;
  /** After a strike from behind: from this frame on (and once the attack is over) a new warning is required. */
  rewarnFrom: number | null;
  cooldownUntil: number;
  /** Frame of the last allowed attack (its inputs take a few frames to start the move). */
  lastAllowed: number;
  graceUntil: number;
  /** Waiting position: rank among the waiting enemies on the same side. */
  rank: number;
  shuffle: number;
  shuffleUntil: number;
}
const READY_STATES = ['Idle', 'Walk', 'Crouch', 'CrouchWalk'];
/** Frames an allowed attack may take from the decision to its first move frame (input sequence plus buffer). */
const ATTACK_START_FRAMES = 8;

export class Director {
  private slots = new Map<number, Slot>();
  private nextFull = 0;
  private lastFacing: Facing | null = null;
  private backReadyAt = 0;
  private lastAttack = -Infinity;
  private locks = new Map<string, { uid: number; frame: number }>();
  private rng: Rng;
  constructor(seed: number, private config = SURVIVAL) { this.rng = new Rng(seed); }

  reset(seed: number): void {
    this.rng = new Rng(seed); this.slots.clear(); this.locks.clear();
    this.nextFull = 0; this.lastFacing = null; this.backReadyAt = 0; this.lastAttack = -Infinity;
  }

  /** Call once per frame before the enemies decide. */
  update(state: SurvivalState): void {
    const frame = state.frame, p = state.player;
    const turned = this.lastFacing !== null && this.lastFacing !== p.facing;
    if (turned || frame >= this.nextFull) { this.evaluate(state, turned); this.nextFull = frame + this.config.director.intervalFrames; }
    this.lastFacing = p.facing;
    // Per frame: back attackers that reached striking distance start their warning.
    const d = this.config.director;
    for (const e of state.enemies) {
      const slot = this.slots.get(e.uid);
      if (slot?.rewarnFrom != null && frame >= slot.rewarnFrom && e.fighter.state !== 'Attack') { slot.warnAt = null; slot.rewarnFrom = null; }
      if (!slot?.token || !this.attacksFromBehind(slot) || slot.warnAt !== null) continue;
      if (slot.token === 'back' && slot.attacks >= 1) continue;
      if (Math.abs(e.fighter.x - p.x) <= d.backStrikeDistance * rules.unit && READY_STATES.includes(e.fighter.state)) {
        slot.warnAt = frame; slot.startAt = Math.max(slot.startAt, frame + d.backWarningFrames);
      }
    }
  }

  private attacksFromBehind(slot: Slot): boolean { return slot.side === 'back'; }

  private evaluate(state: SurvivalState, turned: boolean): void {
    const d = this.config.director, frame = state.frame, p = state.player;
    const active = state.enemies.filter(e => alive(e) && !e.entering);
    const present = new Set(active.map(e => e.uid));
    for (const uid of this.slots.keys()) if (!present.has(uid)) this.slots.delete(uid);
    const distance = (e: Enemy) => Math.abs(e.fighter.x - p.x);

    for (const e of active) {
      const side: Side = inFront(p, e.fighter) ? 'front' : 'back';
      let slot = this.slots.get(e.uid);
      if (!slot) {
        slot = { side, promoted: false, token: null, since: 0, startAt: 0, attacks: 0, warnAt: null, rewarnFrom: null, cooldownUntil: 0, lastAllowed: -Infinity, graceUntil: 0, rank: 0, shuffle: 0, shuffleUntil: 0 };
        this.slots.set(e.uid, slot);
      } else if (slot.side !== side) {
        // Re-sorted after a turn (or after walking around the player).
        if (side === 'front' && (turned || !slot.promoted)) slot.graceUntil = Math.max(slot.graceUntil, frame + d.promotionGraceFrames);
        if (slot.token && e.fighter.state !== 'Attack') this.release(slot, frame);
        slot.side = side; slot.promoted = false;
      }
    }
    const slots = active.map(e => ({ e, slot: this.slots.get(e.uid)! }));
    const promote = slots.filter(s => s.slot.side === 'front').length <= d.promoteFrontAtMost;
    for (const { slot } of slots) {
      if (slot.side !== 'back' || slot.promoted === promote) continue;
      slot.promoted = promote;
      if (promote) slot.graceUntil = Math.max(slot.graceUntil, frame + d.promotionGraceFrames);
      else if (slot.token === 'front') this.release(slot, frame);
    }

    // Give tokens back: time over, attacks used up, knocked down.
    for (const { e, slot } of slots) {
      if (!slot.token) continue;
      const f = e.fighter, idle = f.state !== 'Attack' && frame - slot.lastAllowed > ATTACK_START_FRAMES;
      const used = slot.attacks >= (slot.token === 'back' ? 1 : d.attacksPerToken);
      if (idle && (used || frame - slot.since > d.tokenMaxFrames || f.state === 'Knockdown')) this.release(slot, frame);
    }

    const ready = (e: Enemy, slot: Slot) => !slot.token && frame >= slot.cooldownUntil && frame >= slot.graceUntil && READY_STATES.includes(e.fighter.state);
    // Front pool: enemies in front first, then promoted back enemies; closest first.
    let front = slots.filter(s => s.slot.token === 'front').length;
    const frontPool = slots.filter(s => (s.slot.side === 'front' || s.slot.promoted) && ready(s.e, s.slot))
      .sort((a, b) => Number(a.slot.side === 'back') - Number(b.slot.side === 'back') || distance(a.e) - distance(b.e));
    for (const { slot } of frontPool) {
      if (front >= d.frontTokens) break;
      this.grant(slot, 'front', frame); front++;
    }
    // Back pool: small separate budget with a long cooldown.
    let back = slots.filter(s => s.slot.token === 'back').length;
    if (frame >= this.backReadyAt) {
      const backPool = slots.filter(s => s.slot.side === 'back' && !s.slot.promoted && ready(s.e, s.slot)).sort((a, b) => distance(a.e) - distance(b.e));
      for (const { slot } of backPool) {
        if (back >= d.backTokens) break;
        this.grant(slot, 'back', frame); back++;
      }
    }

    // Waiting spots: rank among the waiting enemies on each side; a fresh lurking shift now and then.
    const lurk = this.config.lurk;
    for (const side of ['front', 'back'] as const) {
      slots.filter(s => s.slot.side === side && !s.slot.token).sort((a, b) => distance(a.e) - distance(b.e))
        .forEach(({ slot }, rank) => { slot.rank = rank; });
    }
    for (const { slot } of slots) if (frame >= slot.shuffleUntil) {
      slot.shuffle = Math.round((this.rng.next() * 2 - 1) * lurk.shuffle);
      slot.shuffleUntil = frame + this.range(lurk.shuffleFrames);
    }
  }

  private range([min, max]: readonly [number, number]): number { return min + Math.floor(this.rng.next() * (max - min + 1)); }

  private grant(slot: Slot, token: Side, frame: number): void {
    slot.token = token; slot.since = frame; slot.attacks = 0; slot.warnAt = null; slot.rewarnFrom = null;
    slot.startAt = frame + this.range(this.config.director.startDelayFrames);
  }

  private release(slot: Slot, frame: number): void {
    if (slot.token === 'back') this.backReadyAt = frame + this.config.director.backCooldownFrames;
    slot.token = null; slot.warnAt = null; slot.rewarnFrom = null; slot.attacks = 0;
    slot.cooldownUntil = frame + this.config.director.tokenCooldownFrames;
  }

  // ------------------------------------------------------------ queries ---
  token(uid: number): Side | null { return this.slots.get(uid)?.token ?? null; }
  side(uid: number): Side | null { return this.slots.get(uid)?.side ?? null; }
  promoted(uid: number): boolean { return this.slots.get(uid)?.promoted ?? false; }
  /** Token held and start delay over. */
  mayAttack(uid: number, frame: number): boolean {
    const slot = this.slots.get(uid);
    return !!slot?.token && frame >= slot.startAt && (!this.attacksFromBehind(slot) || slot.warnAt !== null);
  }
  /** Back attackers: walk up, warn, strike. */
  backPhase(uid: number, frame: number): BackPhase | null {
    const slot = this.slots.get(uid);
    if (!slot?.token || !this.attacksFromBehind(slot)) return null;
    return slot.warnAt === null ? 'approach' : frame < slot.startAt ? 'warn' : 'strike';
  }
  /** Frames left of the visible back-attack warning (0 = none). */
  warning(uid: number, frame: number): number {
    const slot = this.slots.get(uid);
    if (!slot?.token || !this.attacksFromBehind(slot) || slot.warnAt === null || slot.rewarnFrom !== null) return 0;
    // The warning stays up until the strike actually starts.
    return Math.max(1, slot.startAt - frame);
  }
  /** Waiting spot relative to the player: distance (px) for this enemy's rank plus its lurking shift. */
  lurkDistance(uid: number): number {
    const slot = this.slots.get(uid), lurk = this.config.lurk;
    if (!slot) return lurk.frontDistance;
    const base = slot.side === 'front' || slot.promoted ? lurk.frontDistance : lurk.backDistance;
    return base + slot.rank * lurk.spacing + slot.shuffle;
  }
  /**
   * Veto for the attack an enemy wants to start now. Allows it only with a
   * token after its start delay, never a throw, not the move another enemy
   * started within `sameMoveLockFrames`, and not within `attackGapFrames` of
   * any other enemy's attack start. An allowed attack is counted.
   */
  allowMove(uid: number, moveId: string, frame: number): boolean {
    const d = this.config.director, slot = this.slots.get(uid);
    if (!slot || !this.mayAttack(uid, frame) || MOVES[moveId]?.throw) return false;
    if (frame - this.lastAttack < d.attackGapFrames) return false;
    const lock = this.locks.get(moveId);
    if (lock && lock.uid !== uid && frame - lock.frame < d.sameMoveLockFrames) return false;
    this.locks.set(moveId, { uid, frame }); this.lastAttack = frame; slot.attacks++; slot.lastAllowed = frame;
    // Every further strike from behind needs its own approach and warning.
    // (The pilot's input sequence needs a few frames until the attack starts.)
    if (this.attacksFromBehind(slot)) slot.rewarnFrom = frame + 4;
    return true;
  }
}
