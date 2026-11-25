import rules from '../data/rules.json';
import { FIGURE_SCALE } from '../data/figure-scale';
import { MOVES, type HitLevel } from '../data/schema';
import { strikeJoint } from '../data/pose-contact-moves';
import type { Fighter, GameState } from '../simulation/types';
import type { Palette } from '../platform/theme';
import type { EffectSettings } from '../platform/effects-settings';
import { describeStrike, type HitKind } from '../platform/hit-sound';
import { t } from '../platform/i18n';
import { animationTrails, samplePose, sampleYaw } from './skeleton';
import { STAGE_VIEW } from './stages';
import { newResourceFills, RESOURCE_NAMES, type ResourceName } from '../platform/resource-ready';

/*
 * Presentation only. Hit sparks, screen shake, dust, speed lines, the KO flash
 * and the combo counter are derived from consecutive game states (hitTargets
 * growth, lastContact, positions, states). Nothing here writes to a GameState;
 * the random source is private and seeded, so the same replay always produces
 * the same effects. Time advances once per simulation step (hitstop included,
 * KO slow motion therefore included), never while paused.
 */

/** Hard pool limit; the oldest particle is recycled when the pool is full. */
export const MAX_PARTICLES = 192;
/** Fixed seed: every reset (match, round, replay) restarts the same sequence. */
export const EFFECT_SEED = 0x2f6b9e1d;
/** Per-step multiplier of the shake amplitude (deterministic exponential decay). */
export const SHAKE_DECAY = 0.8;
/** Largest shake amplitude in logical pixels. */
export const MAX_SHAKE = 8;
/** Steps a finished combo counter stays visible while fading out. */
export const COMBO_FADE_STEPS = 45;
/** Steps of the pop when a counter increases. */
export const COMBO_POP_STEPS = 8;
/** Steps the KO zoom holds before it eases back. */
const ZOOM_HOLD = 24;
const ZOOM_AMOUNT = 0.07;
const LEVEL_SCALE: Record<HitLevel, number> = { LOW: 0.85, MID: 1, HIGH: 1.15 };
/** Height of a fighter's body centre above the feet, in logical pixels. */
const BODY_CENTRE = 58 * FIGURE_SCALE;
/** Minimum per-step ground slide of a stunned fighter that kicks up dust (subpixels). */
const SLIDE_DUST = 2 * rules.unit;

export const ParticleKind = { Ray: 0, Flash: 1, Arc: 2, Dust: 3, Ring: 4, Halo: 5, Aura: 6, Spark: 7, Star: 8 } as const;
export type ParticleKind = typeof ParticleKind[keyof typeof ParticleKind];
/** Index into the palette roles used for particles. */
export const Tint = { Special: 0, Revenge: 1, Muted: 2, Light: 3 } as const;
export type Tint = typeof Tint[keyof typeof Tint];

const ground = STAGE_VIEW.ground;
const screenX = (x: number) => x / rules.unit;
const screenY = (y: number) => ground + y / rules.unit;

/** mulberry32: tiny seeded PRNG, separate from the simulation and the CPU. */
class EffectRandom {
  private state = EFFECT_SEED;
  seed(value: number): void { this.state = value >>> 0; }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let a = this.state;
    a = Math.imul(a ^ (a >>> 15), a | 1);
    a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
    return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number): number { return min + (max - min) * this.next(); }
}

export interface SparkSpec { x: number; y: number; side: number; weight: number; level: HitLevel; kind: HitKind; blocked: boolean; damage: number }
export interface ComboDisplay { count: number; damage: number; pop: number; alpha: number }
export interface Camera { x: number; y: number; zoom: number; cx: number; cy: number }

export class HitEffects {
  settings: EffectSettings;
  // Structure-of-arrays pool: no allocation per step or per frame.
  private readonly kind = new Uint8Array(MAX_PARTICLES);
  private readonly tint = new Uint8Array(MAX_PARTICLES);
  private readonly px = new Float32Array(MAX_PARTICLES);
  private readonly py = new Float32Array(MAX_PARTICLES);
  private readonly vx = new Float32Array(MAX_PARTICLES);
  private readonly vy = new Float32Array(MAX_PARTICLES);
  private readonly size = new Float32Array(MAX_PARTICLES);
  private readonly age = new Float32Array(MAX_PARTICLES);
  private readonly life = new Float32Array(MAX_PARTICLES);
  /** Per-step size factor of rings and halos (1 = constant). */
  private readonly grow = new Float32Array(MAX_PARTICLES);
  private cursor = 0;
  /** "Bar full" bursts waiting for their staggered start: steps left, -1 = none. Index fighter * 2 + bar. */
  private readonly readyDelay = new Int16Array(4).fill(-1);
  /** Monotonic count of observed "bar full" events per bar (HUD flash trigger). Survives reset(). */
  private readonly readyEvents = new Uint32Array(4);
  private readonly random = new EffectRandom();
  /** Current shake amplitude and the offset rolled for this step. */
  shake = 0;
  private offsetX = 0;
  private offsetY = 0;
  private zoom = 0;
  private zoomAge = 0;
  private zoomX = 480;
  private zoomY = ground - 60;
  /** 1 on the KO step, fading afterwards. */
  flash = 0;
  private readonly comboCount = [0, 0];
  private readonly comboDamage = [0, 0];
  private readonly comboSince = [0, 0];
  /** -1 while the combo runs, otherwise steps since it ended. */
  private readonly comboEnding = [-1, -1];
  /** The running counter was opened by a throw: a single throw already shows "1 HIT". */
  private readonly comboThrow = [false, false];

  constructor(settings: EffectSettings = { effects: true, shake: true }) {
    this.settings = settings;
    this.reset();
  }

  /** Clears everything and restarts the effect random sequence. */
  reset(): void {
    this.life.fill(0); this.age.fill(0); this.cursor = 0; this.readyDelay.fill(-1);
    this.random.seed(EFFECT_SEED);
    this.shake = 0; this.offsetX = 0; this.offsetY = 0;
    this.zoom = 0; this.zoomAge = 0; this.flash = 0;
    this.comboCount.fill(0); this.comboDamage.fill(0); this.comboSince.fill(0); this.comboEnding.fill(-1); this.comboThrow.fill(false);
  }

  /**
   * Observes one simulation step. `live` is false for single frame steps while
   * paused: new events still spawn, but nothing ages, so the scene stands still.
   */
  update(game: GameState, previous: GameState, live = true): void {
    if (live) this.tick();
    this.observeContacts(game, previous);
    this.observeThrows(game, previous);
    for (const f of game.fighters) this.observeFighter(f, previous.fighters[f.id]);
    this.observeCombos(game);
    this.observeResources(game, previous);
  }

  /**
   * Survival: one player (index 0 of every view) against several opponents,
   * each observed through its own two-fighter view (see survival/views). Ages
   * the scene once, observes the player once and every opponent; only the
   * player's knockout gets the dramatic flash and zoom. A combo ends once
   * nobody is held in stun any more. `previous` views are matched by `uid`.
   */
  updateCrowd(views: readonly { uid: number; game: GameState }[], previous: readonly { uid: number; game: GameState }[], live = true): void {
    if (live) this.tick();
    let playerSeen = false;
    for (const { uid, game } of views) {
      const before = previous.find(v => v.uid === uid)?.game;
      if (!before) continue;
      this.observeContacts(game, before);
      if (!playerSeen) { this.observeFighter(game.fighters[0], before.fighters[0]); playerSeen = true; }
      this.observeFighter(game.fighters[1], before.fighters[1], false);
    }
    const stunned = (f: Fighter) => f.state === 'Hitstun' || f.state === 'Knockdown';
    for (let attacker = 0; attacker < 2; attacker++) {
      if (this.comboCount[attacker] === 0 || this.comboEnding[attacker] >= 0) continue;
      if (!views.some(({ game }) => stunned(game.fighters[1 - attacker]))) this.comboEnding[attacker] = 0;
    }
  }

  // -------------------------------------------------------- bar full -------
  /** Queues a burst for every bar that just became full and starts the due ones. */
  private observeResources(game: GameState, previous: GameState): void {
    for (const fill of newResourceFills(game, previous)) {
      const index = fill.fighter * 2 + RESOURCE_NAMES.indexOf(fill.resource);
      this.readyEvents[index]++;
      this.readyDelay[index] = fill.delay;
    }
    for (let index = 0; index < 4; index++) {
      const delay = this.readyDelay[index];
      if (delay < 0) continue;
      if (delay > 0) { this.readyDelay[index] = delay - 1; continue; }
      this.readyDelay[index] = -1;
      const fighter = game.fighters[index >> 1];
      // A bar that was spent again during the stagger no longer celebrates.
      const resource = RESOURCE_NAMES[index & 1], value = fighter.resources[resource];
      if (value.current >= value.max) this.spawnReadyBurst(screenX(fighter.x), screenY(fighter.y) - BODY_CENTRE, resource);
    }
  }

  /** Number of "bar full" events seen for this bar so far (monotonic, presentation only). */
  readyEventCount(fighter: number, resource: ResourceName): number {
    return this.readyEvents[fighter * 2 + RESOURCE_NAMES.indexOf(resource)];
  }

  /**
   * One-off burst at a fighter whose bar just became full: expanding ring,
   * rising sparks and a short aura shimmer. Revenge is red-orange, fast and
   * jagged; Special is a cooler, calmer ring with twinkling stars. No shake.
   * With effects switched off nothing is spawned at all.
   */
  spawnReadyBurst(x: number, y: number, resource: ResourceName): void {
    if (!this.settings.effects) return;
    const r = this.random;
    if (resource === 'revenge') {
      this.spawn(ParticleKind.Aura, x, y, 0, 0, 44, 20, Tint.Revenge, 1.012);
      this.spawn(ParticleKind.Halo, x, y, 0, 0, 16, 16, Tint.Revenge, 1.13);
      this.spawn(ParticleKind.Halo, x, y, 0, 0, 10, 12, Tint.Light, 1.16);
      for (let i = 0; i < 14; i++) {
        const side = i % 2 ? 1 : -1;
        this.spawn(ParticleKind.Spark, x + side * r.range(4, 20), y + r.range(-30, 52), side * r.range(0.3, 1.8), -r.range(3.6, 6.8),
          r.range(7, 12), Math.round(r.range(12, 19)), i % 4 === 0 ? Tint.Light : Tint.Revenge, 1);
      }
    } else {
      this.spawn(ParticleKind.Aura, x, y, 0, 0, 46, 32, Tint.Special, 1.004);
      this.spawn(ParticleKind.Halo, x, y, 0, 0, 22, 30, Tint.Special, 1.055);
      for (let i = 0; i < 9; i++) {
        const angle = (i / 9) * Math.PI * 2 + r.range(-0.25, 0.25), radius = r.range(18, 30);
        this.spawn(ParticleKind.Star, x + Math.cos(angle) * radius, y + Math.sin(angle) * radius * 1.4, Math.cos(angle) * 0.25, -r.range(0.8, 1.9),
          r.range(3, 5.5), Math.round(r.range(26, 38)), i % 3 === 0 ? Tint.Light : Tint.Special, 1);
      }
    }
  }

  /**
   * Revenge combo start: a hot flash at the body, a fast ring, sparks bursting
   * forward and a short shake. Shake follows the shake switch; with effects
   * switched off no particle is spawned.
   */
  spawnRevengeStart(x: number, y: number, facing: number): void {
    this.addShake(4);
    if (!this.settings.effects) return;
    const r = this.random;
    this.spawn(ParticleKind.Flash, x, y, 0, 0, 30, 9, Tint.Revenge);
    this.spawn(ParticleKind.Halo, x, y, 0, 0, 14, 14, Tint.Revenge, 1.18);
    this.spawn(ParticleKind.Ring, x, y + BODY_CENTRE, 0, 0, 16, 16, Tint.Revenge);
    for (let i = 0; i < 10; i++) {
      const angle = r.range(-0.9, 0.9), speed = r.range(3, 6.5);
      this.spawn(ParticleKind.Ray, x + facing * 8, y + r.range(-20, 20), facing * Math.cos(angle) * speed, Math.sin(angle) * speed,
        r.range(6, 11), Math.round(r.range(8, 13)), i % 3 === 0 ? Tint.Light : Tint.Revenge);
    }
  }

  // ------------------------------------------------------------- events ----
  private observeContacts(game: GameState, previous: GameState): void {
    const contact = game.lastContact, fresh = contact && (!previous.lastContact || previous.lastContact.frame !== contact.frame || previous.lastContact.attacker !== contact.attacker) ? contact : null;
    for (const attacker of game.fighters) {
      const before = previous.fighters[attacker.id];
      const known = before && before.attackId === attacker.attackId ? before.hitTargets.length : 0;
      if (attacker.hitTargets.length <= known) continue;
      const moveId = attacker.moveId ?? before?.moveId;
      if (!moveId || !MOVES[moveId]) continue;
      for (let i = known; i < attacker.hitTargets.length; i++) {
        const target = attacker.hitTargets[i], split = target.lastIndexOf(':');
        const groupId = target.slice(0, split), defender = game.fighters[Number(target.slice(split + 1))];
        if (!defender) continue;
        const move = MOVES[moveId], group = move.hitGroups.find(g => g.id === groupId) ?? move.hitGroups[0];
        const blocked = fresh && fresh.attacker === attacker.id && fresh.defender === defender.id ? fresh.blocked : defender.state === 'Blockstun';
        const strike = describeStrike(moveId, groupId);
        const [x, y] = this.strikePoint(game, attacker, before, moveId, groupId, defender, group.hitLevel ?? move.hitLevel);
        const damage = group.damage ?? move.damage;
        this.spawnSparks({ x, y, side: defender.x === attacker.x ? attacker.attackFacing : Math.sign(defender.x - attacker.x), weight: strike.weight,
          level: group.hitLevel ?? move.hitLevel, kind: strike.kind, blocked, damage });
        this.addShake(shakeForHit(damage, blocked));
        if (!blocked) this.countHit(attacker.id, defender, previous.fighters[defender.id]);
      }
    }
  }

  /**
   * Throws: a short spark at the grip when the opponent is seized, a heavy
   * impact (large spark, impact ring, dust, shake by the usual rules) when the
   * victim hits the floor, and a muted guard spark between both on a clash.
   */
  private observeThrows(game: GameState, previous: GameState): void {
    for (const victim of game.fighters) {
      const old = previous.fighters[victim.id], thrower = game.fighters[1 - victim.id];
      if (!old) continue;
      if (victim.state === 'Thrown' && old.state !== 'Thrown' && victim.thrownBy && MOVES[victim.thrownBy]) {
        const pose = samplePose(victim.thrownBy, 0, thrower.attackFacing);
        const x = screenX(thrower.x) + (pose.leftHand[0] + pose.rightHand[0]) / 2 * FIGURE_SCALE;
        const y = screenY(thrower.y) + (pose.leftHand[1] + pose.rightHand[1]) / 2 * FIGURE_SCALE;
        this.spawnSparks({ x, y, side: thrower.attackFacing, weight: 0.2, level: 'MID', kind: 'punch', blocked: false, damage: 35 });
      }
      if (old.state === 'Thrown' && victim.state !== 'Thrown' && old.thrownBy && MOVES[old.thrownBy]) {
        const move = MOVES[old.thrownBy], x = screenX(victim.x), feet = screenY(0);
        this.spawnSparks({ x, y: feet - 16, side: thrower.attackFacing, weight: 1, level: 'HIGH', kind: 'kick', blocked: false, damage: move.damage });
        this.spawn(ParticleKind.Ring, x, feet, 0, 0, 20, 22, Tint.Revenge);
        this.spawnDust(x, feet, 8, 1.6, 0);
        this.addShake(shakeForHit(move.damage, false));
        this.countHit(thrower.id, victim, old, true);
      }
    }
    const [a, b] = game.fighters, clash = (f: Fighter) => f.state === 'Attack' && MOVES[f.moveId ?? '']?.throw?.phase === 'break' && f.moveFrame === 0;
    if (clash(a) && clash(b) && !(clash(previous.fighters[0]) && clash(previous.fighters[1])))
      this.spawnSparks({ x: screenX((a.x + b.x) / 2), y: screenY(0) - 62 * FIGURE_SCALE, side: a.attackFacing, weight: 0.4, level: 'MID', kind: 'punch', blocked: true, damage: 40 });
  }

  /** Strike limb tip at the contact, pulled back onto the defender's front. */
  private strikePoint(game: GameState, attacker: Fighter, before: Fighter | undefined, moveId: string, groupId: string, defender: Fighter, level: HitLevel): [number, number] {
    const captured = game.lastContact?.poses?.[attacker.id];
    const source = captured?.moveId === moveId ? captured : attacker.moveId === moveId ? attacker : before ?? attacker;
    const trails = animationTrails(moveId);
    const joint = groupId === 'knee' ? trails.find(trail => trail.joint.endsWith('Knee'))?.joint
      : strikeJoint(moveId, groupId, trails.find(trail => !trail.joint.endsWith('Knee'))?.joint ?? 'rightFoot');
    const side = defender.x === attacker.x ? attacker.attackFacing : Math.sign(defender.x - attacker.x);
    const front = screenX(defender.x) - side * 7;
    let x: number, y: number;
    const point = joint ? samplePose(moveId, source.moveFrame, source.attackFacing)[joint] : undefined;
    if (point) {
      x = screenX(source.x) + point[0] * FIGURE_SCALE;
      y = screenY(source.y) + point[1] * FIGURE_SCALE;
    } else {
      x = front; y = screenY(defender.y) - (level === 'HIGH' ? 100 : level === 'MID' ? 62 : 22);
    }
    if ((x - front) * side > 0) x = front;
    return [x, Math.min(y, ground - 3)];
  }

  private observeFighter(f: Fighter, old: Fighter | undefined, dramaticKo = true): void {
    if (!old) return;
    const x = screenX(f.x), feet = screenY(0);
    // Start of a full-bar move (Revenge combo); a chord upgrade keeps the attackId.
    if (f.state === 'Attack' && f.moveId && MOVES[f.moveId]?.command.resource &&
      !(old.state === 'Attack' && old.moveId === f.moveId && old.attackId === f.attackId)) this.spawnRevengeStart(x, screenY(f.y) - BODY_CENTRE, f.attackFacing);
    // Landing from a jump, a knockdown or an aerial KO.
    if (old.y < 0 && f.y === 0) {
      const heavy = f.state === 'Knockdown' || f.state === 'KO';
      this.spawnDust(x, feet, heavy ? 7 : 4, heavy ? 1.35 : 0.9, 0);
      this.spawn(ParticleKind.Ring, x, feet, 0, 0, heavy ? 14 : 10, heavy ? 16 : 12, Tint.Muted);
      if (heavy) this.addShake(3);
    }
    // Pushback slide on the ground after a hit or block.
    const moved = f.x - old.x;
    if (f.y === 0 && (f.state === 'Hitstun' || f.state === 'Blockstun') && Math.abs(moved) >= SLIDE_DUST && Math.abs(moved) < 80 * rules.unit) {
      const burst = Math.abs(moved) >= 12 * rules.unit;
      this.spawnDust(x - Math.sign(moved) * 6, feet, burst ? 4 : 1, burst ? 1.1 : 0.7, -Math.sign(moved));
    }
    if (f.state === 'KO' && old.state !== 'KO' && !dramaticKo) this.addShake(MAX_SHAKE * 0.3);
    else if (f.state === 'KO' && old.state !== 'KO') {
      this.flash = 1;
      this.addShake(MAX_SHAKE * 0.85);
      this.zoom = ZOOM_AMOUNT; this.zoomAge = 0;
      this.zoomX = x; this.zoomY = screenY(f.y) - 60;
    }
  }

  // -------------------------------------------------------------- combos ---
  private countHit(attacker: number, defender: Fighter, before: Fighter | undefined, isThrow = false): void {
    const running = this.comboCount[attacker] > 0 && this.comboEnding[attacker] < 0;
    if (!running) { this.comboCount[attacker] = 0; this.comboDamage[attacker] = 0; this.comboThrow[attacker] = isThrow; }
    this.comboCount[attacker]++;
    this.comboDamage[attacker] += Math.max(0, (before?.hp ?? defender.hp) - defender.hp);
    this.comboSince[attacker] = 0; this.comboEnding[attacker] = -1;
  }

  /** A combo ends as soon as the defender may act again (or the round ends). */
  private observeCombos(game: GameState): void {
    for (let attacker = 0; attacker < 2; attacker++) {
      if (this.comboCount[attacker] === 0 || this.comboEnding[attacker] >= 0) continue;
      const defender = game.fighters[1 - attacker];
      if (defender.state !== 'Hitstun' && defender.state !== 'Knockdown') this.comboEnding[attacker] = 0;
    }
  }

  /** Counter of one attacker, or null when nothing (or a single hit) is shown. */
  combo(attacker: number): ComboDisplay | null {
    const count = this.comboCount[attacker];
    if (count < 2 && !(count === 1 && this.comboThrow[attacker])) return null;
    const ending = this.comboEnding[attacker];
    return { count, damage: this.comboDamage[attacker],
      pop: Math.max(0, 1 - this.comboSince[attacker] / COMBO_POP_STEPS),
      alpha: ending < 0 ? 1 : Math.max(0, 1 - ending / COMBO_FADE_STEPS) };
  }

  // --------------------------------------------------------------- pool ----
  /** Spark burst at a contact; size and count follow damage, level, limb and block. */
  spawnSparks(spec: SparkSpec): void {
    const r = this.random, weight = Math.max(0, Math.min(1, spec.weight));
    const scale = (0.7 + 0.6 * weight) * LEVEL_SCALE[spec.level] * (spec.blocked ? 0.6 : 1);
    const heavy = !spec.blocked && (spec.damage >= 75 || spec.level === 'HIGH');
    const rays = spec.blocked ? 5 : spec.kind === 'punch' ? 7 + Math.round(4 * weight) : 9 + Math.round(5 * weight);
    // Kicks fan out away from the attacker, tilted by the strike height; punches form a star.
    const base = spec.side > 0 ? 0 : Math.PI, tilt = spec.level === 'HIGH' ? -0.25 : spec.level === 'LOW' ? -0.6 : 0;
    for (let i = 0; i < rays; i++) {
      const angle = spec.kind === 'punch' || spec.blocked
        ? (i / rays) * Math.PI * 2 + r.range(-0.2, 0.2)
        : base + spec.side * tilt + r.range(-1.15, 1.15);
      const speed = r.range(2.2, 4.6) * scale;
      const tint = spec.blocked ? Tint.Muted : heavy && i % 3 === 0 ? Tint.Revenge : Tint.Special;
      this.spawn(ParticleKind.Ray, spec.x, spec.y, Math.cos(angle) * speed, Math.sin(angle) * speed,
        r.range(5, 11) * scale * (spec.kind === 'kick' ? 1.2 : 1), spec.blocked ? 8 : 10 + Math.round(6 * weight), tint);
    }
    this.spawn(ParticleKind.Flash, spec.x, spec.y, 0, 0, (spec.kind === 'punch' ? 7 : 9) * scale, spec.blocked ? 6 : 8, spec.blocked ? Tint.Muted : Tint.Light);
    if (spec.blocked) this.spawn(ParticleKind.Arc, spec.x, spec.y, -spec.side, 0, 11 * scale, 10, Tint.Muted);
  }

  private spawnDust(x: number, y: number, count: number, scale: number, direction: number): void {
    const r = this.random;
    for (let i = 0; i < count; i++) {
      const dir = direction || (i % 2 ? 1 : -1);
      this.spawn(ParticleKind.Dust, x + r.range(-6, 6), y - r.range(0, 3), dir * r.range(0.4, 1.6) * scale, -r.range(0.15, 0.6) * scale,
        r.range(2.5, 4.5) * scale, Math.round(r.range(16, 26)), Tint.Muted);
    }
  }

  private spawn(kind: ParticleKind, x: number, y: number, vx: number, vy: number, size: number, life: number, tint: Tint, grow = 1): void {
    const i = this.cursor;
    this.cursor = (i + 1) % MAX_PARTICLES;
    this.kind[i] = kind; this.tint[i] = tint;
    this.px[i] = x; this.py[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.size[i] = size; this.age[i] = 0; this.life[i] = life; this.grow[i] = grow;
  }

  addShake(amount: number): void { this.shake = Math.min(MAX_SHAKE, Math.max(this.shake, amount)); }

  /** One step of presentation time. */
  private tick(): void {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.age[i] >= this.life[i]) continue;
      this.age[i]++;
      this.px[i] += this.vx[i]; this.py[i] += this.vy[i];
      const kind = this.kind[i];
      if (kind === ParticleKind.Ray) { this.vx[i] *= 0.82; this.vy[i] = this.vy[i] * 0.82 + 0.12; }
      else if (kind === ParticleKind.Dust) { this.vx[i] *= 0.9; this.vy[i] *= 0.9; this.size[i] *= 1.045; }
      else if (kind === ParticleKind.Ring) this.size[i] *= 1.08;
      else if (kind === ParticleKind.Halo || kind === ParticleKind.Aura) this.size[i] *= this.grow[i];
      else if (kind === ParticleKind.Spark) { this.vx[i] *= 0.9; this.vy[i] *= 0.9; }
      else if (kind === ParticleKind.Star) { this.vx[i] *= 0.96; this.vy[i] *= 0.97; }
    }
    this.shake = this.shake * SHAKE_DECAY < 0.05 ? 0 : this.shake * SHAKE_DECAY;
    this.offsetX = this.shake ? this.shake * this.random.range(-1, 1) : 0;
    this.offsetY = this.shake ? this.shake * this.random.range(-0.6, 0.6) : 0;
    if (this.zoom > 0 && ++this.zoomAge > ZOOM_HOLD) this.zoom = this.zoom * 0.9 < 0.002 ? 0 : this.zoom * 0.9;
    this.flash = this.flash * 0.84 < 0.02 ? 0 : this.flash * 0.84;
    for (let attacker = 0; attacker < 2; attacker++) {
      this.comboSince[attacker]++;
      if (this.comboEnding[attacker] >= 0 && ++this.comboEnding[attacker] > COMBO_FADE_STEPS) {
        this.comboCount[attacker] = 0; this.comboDamage[attacker] = 0; this.comboEnding[attacker] = -1; this.comboThrow[attacker] = false;
      }
    }
  }

  /** Number of live particles (tests and debugging). */
  activeCount(): number {
    let count = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) if (this.age[i] < this.life[i]) count++;
    return count;
  }
  /** Snapshot of the live particles (tests only; allocates). */
  particles(): { kind: ParticleKind; tint: Tint; size: number; x: number; y: number }[] {
    const list = [];
    for (let i = 0; i < MAX_PARTICLES; i++) if (this.age[i] < this.life[i]) list.push({ kind: this.kind[i] as ParticleKind, tint: this.tint[i] as Tint, size: this.size[i], x: this.px[i], y: this.py[i] });
    return list;
  }

  // ------------------------------------------------------------- drawing ---
  /** Camera offset and zoom of the current step; identity when motion is off or paused. */
  camera(paused: boolean): Camera | null {
    if (paused || !this.settings.shake || (!this.shake && !this.zoom)) return null;
    // A slight overscan keeps the shaken stage covering the canvas edges.
    const overscan = 1 + (2 * this.shake) / STAGE_VIEW.height;
    return { x: this.offsetX, y: this.offsetY, zoom: (1 + this.zoom) * overscan, cx: this.zoomX, cy: this.zoomY };
  }

  /** Speed lines behind spinning and airborne fighters, drawn under the figures. */
  drawBehind(ctx: CanvasRenderingContext2D, game: GameState, previous: GameState, alpha: number, palette: Palette): void {
    if (!this.settings.effects) return;
    for (const f of game.fighters) {
      const old = previous.fighters[f.id];
      let strength = 0, direction = 0, tint = palette.muted;
      if (f.state === 'Attack' && f.moveId) {
        const now = sampleYaw(f.moveId, f.moveFrame), then = sampleYaw(f.moveId, Math.max(0, f.moveFrame - 1));
        if (now !== undefined && then !== undefined && Math.abs(now - then) > 4) {
          strength = Math.min(1, Math.abs(now - then) / 24); direction = -f.attackFacing; tint = palette.revenge;
        }
      }
      if (!strength && f.y < 0 && (f.x !== old.x || f.vy !== 0)) {
        strength = Math.min(1, (Math.abs(f.x - old.x) + Math.abs(f.vy)) / (6 * rules.unit));
        direction = f.x !== old.x ? -Math.sign(f.x - old.x) : 0;
      }
      if (strength < 0.15) continue;
      const x = screenX(old.x + (f.x - old.x) * alpha), y = screenY(old.y + (f.y - old.y) * alpha);
      ctx.save(); ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const height = (22 + i * 21) * FIGURE_SCALE, length = (18 + ((i * 7) % 11)) * strength;
        const fromX = direction ? x + direction * (16 + (i % 2) * 6) : x - 10 + i * 6;
        const toX = direction ? fromX + direction * length : fromX;
        const fromY = y - height, toY = direction ? fromY : fromY + length * 0.8;
        ctx.globalAlpha = 0.55 * strength; ctx.strokeStyle = palette.arena; ctx.lineWidth = 3.2;
        ctx.beginPath(); ctx.moveTo(fromX, fromY); ctx.lineTo(toX, toY); ctx.stroke();
        ctx.strokeStyle = tint; ctx.lineWidth = 1.4; ctx.stroke();
      }
      ctx.restore();
    }
  }

  /** Sparks, dust and rings in stage coordinates (inside the camera transform). */
  drawWorld(ctx: CanvasRenderingContext2D, alpha: number, palette: Palette): void {
    if (!this.settings.effects) return;
    const tints = [palette.special, palette.revenge, palette.muted, palette.rigLight];
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const life = this.life[i], age = this.age[i];
      if (age >= life) continue;
      const fade = Math.max(0, 1 - (age + alpha) / life), x = this.px[i] + this.vx[i] * alpha, y = this.py[i] + this.vy[i] * alpha;
      const size = this.size[i], color = tints[this.tint[i]];
      switch (this.kind[i]) {
        case ParticleKind.Ray: {
          // Streak along the flight direction; it shortens as it fades.
          const speed = Math.hypot(this.vx[i], this.vy[i]) || 1, length = size * (0.35 + 0.65 * fade);
          const tx = x - (this.vx[i] / speed) * length, ty = y - (this.vy[i] / speed) * length;
          ctx.globalAlpha = fade; ctx.strokeStyle = palette.arena; ctx.lineWidth = 3.4;
          ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
          ctx.strokeStyle = color; ctx.lineWidth = 1.7; ctx.stroke();
          break;
        }
        case ParticleKind.Flash: {
          // Four-point star, shrinking.
          const r = size * (0.4 + 0.6 * fade), w = r * 0.28;
          ctx.globalAlpha = fade;
          ctx.beginPath();
          ctx.moveTo(x, y - r); ctx.lineTo(x + w, y - w); ctx.lineTo(x + r, y); ctx.lineTo(x + w, y + w);
          ctx.lineTo(x, y + r); ctx.lineTo(x - w, y + w); ctx.lineTo(x - r, y); ctx.lineTo(x - w, y - w); ctx.closePath();
          ctx.strokeStyle = palette.arena; ctx.lineWidth = 2.6; ctx.stroke();
          ctx.fillStyle = color; ctx.fill();
          ctx.strokeStyle = palette.special; ctx.lineWidth = 0.9; ctx.stroke();
          break;
        }
        case ParticleKind.Arc: {
          // Blocked: a short guard arc facing the attacker.
          const start = this.vx[i] > 0 ? -0.9 : Math.PI - 0.9, r = size * (1 + 0.3 * (1 - fade));
          ctx.globalAlpha = fade; ctx.strokeStyle = palette.arena; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(x, y, r, start, start + 1.8); ctx.stroke();
          ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
          break;
        }
        case ParticleKind.Dust: {
          ctx.globalAlpha = 0.42 * fade; ctx.fillStyle = color;
          ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 0.7 * fade; ctx.strokeStyle = palette.arena; ctx.lineWidth = 1; ctx.stroke();
          break;
        }
        case ParticleKind.Ring: {
          // Flat impact ellipse on the floor.
          ctx.globalAlpha = 0.85 * fade; ctx.strokeStyle = palette.arena; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.ellipse(x, y, size * 1.6, size * 0.35, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = color; ctx.lineWidth = 1.3; ctx.stroke();
          break;
        }
        case ParticleKind.Halo: {
          // Expanding ring around the body (bar full).
          ctx.globalAlpha = 0.9 * fade; ctx.strokeStyle = palette.arena; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.ellipse(x, y, size, size * 1.25, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
          break;
        }
        case ParticleKind.Aura: {
          // Short body-sized shimmer; a slow deterministic flicker, well below 3 Hz.
          const shimmer = 0.75 + 0.25 * Math.sin((age + alpha) * 0.45);
          ctx.globalAlpha = 0.2 * fade * shimmer; ctx.fillStyle = color;
          ctx.beginPath(); ctx.ellipse(x, y, size * 0.5, size * (1 + 0.04 * (age + alpha)), 0, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 0.55 * fade * shimmer; ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.stroke();
          break;
        }
        case ParticleKind.Spark: {
          // Rising streak along its flight direction.
          const speed = Math.hypot(this.vx[i], this.vy[i]) || 1, length = size * (0.4 + 0.6 * fade);
          const tx = x - (this.vx[i] / speed) * length, ty = y - (this.vy[i] / speed) * length;
          ctx.globalAlpha = fade; ctx.strokeStyle = palette.arena; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
          ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
          break;
        }
        case ParticleKind.Star: {
          // Small twinkling four-point star.
          const r = size * (0.6 + 0.4 * Math.abs(Math.cos((age + alpha) * 0.3))), w = r * 0.3;
          ctx.globalAlpha = fade;
          ctx.beginPath();
          ctx.moveTo(x, y - r); ctx.lineTo(x + w, y - w); ctx.lineTo(x + r, y); ctx.lineTo(x + w, y + w);
          ctx.lineTo(x, y + r); ctx.lineTo(x - w, y + w); ctx.lineTo(x - r, y); ctx.lineTo(x - w, y - w); ctx.closePath();
          ctx.strokeStyle = palette.arena; ctx.lineWidth = 2; ctx.stroke();
          ctx.fillStyle = color; ctx.fill();
          break;
        }
      }
    }
    ctx.restore();
  }

  /** KO flash and combo counters, outside the camera transform. */
  drawOverlay(ctx: CanvasRenderingContext2D, palette: Palette): void {
    if (!this.settings.effects) return;
    if (this.flash > 0) {
      ctx.save();
      ctx.globalAlpha = 0.32 * this.flash; ctx.fillStyle = palette.rigLight; ctx.fillRect(0, 0, STAGE_VIEW.width, STAGE_VIEW.height);
      ctx.globalAlpha = 0.18 * this.flash; ctx.fillStyle = palette.special; ctx.fillRect(0, 0, STAGE_VIEW.width, STAGE_VIEW.height);
      ctx.restore();
    }
    for (let attacker = 0; attacker < 2; attacker++) {
      const combo = this.combo(attacker);
      if (!combo || combo.alpha <= 0) continue;
      const x = attacker === 0 ? 118 : STAGE_VIEW.width - 118, y = 122, size = 26 * (1 + 0.35 * combo.pop);
      ctx.save(); ctx.globalAlpha = combo.alpha; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
      const label = t(combo.count === 1 ? 'effects.hit' : 'effects.hits', { count: combo.count });
      ctx.font = `bold ${size.toFixed(1)}px Arial`;
      ctx.strokeStyle = palette.arena; ctx.lineWidth = 6; ctx.strokeText(label, x, y);
      ctx.fillStyle = attacker === 0 ? palette.p1 : palette.p2; ctx.fillText(label, x, y);
      const damage = t('effects.damage', { damage: combo.damage });
      ctx.font = '11px monospace'; ctx.lineWidth = 4; ctx.strokeText(damage, x, y + 17);
      ctx.fillStyle = palette.text; ctx.fillText(damage, x, y + 17);
      ctx.restore();
    }
  }
}

/** Shake for one contact: heavy hits only, scaled by damage; blocks barely move the screen. */
export function shakeForHit(damage: number, blocked: boolean): number {
  const amount = Math.max(0, (damage - 45) / 65) * 5;
  return blocked ? amount * 0.15 : amount;
}
