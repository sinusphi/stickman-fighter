import { MOVES, type CompiledMove, type HitGroup, type HitLevel } from '../data/schema';
import rules from '../data/rules.json';
import { mappedStrikeJoint } from '../data/pose-contact-moves';
import type { Fighter, GameState } from '../simulation/types';

/* Pure sound selection: no Web Audio access, no simulation RNG, no game-state writes. */

/** `throw`: the slam of a throw (no sample role; synth unless a manifest adds one). */
export type HitKind = 'punch' | 'kick' | 'knee' | 'throw';
export type HitStrength = 'light' | 'middle' | 'high';
/** Hand-maintained roles; additional nested roles can be loaded without changing the loader. */
export interface SoundManifest {
  hit?: Partial<Record<HitKind, Partial<Record<HitStrength, string[]>>>>;
  block?: string[];
  swing?: string[];
  rate?: Partial<Record<HitKind, number>>;
  [role: string]: unknown;
}

/** Every file list, including future roles; rate/settings numbers are ignored. */
export function sampleFiles(manifest: SoundManifest): string[] {
  const files = new Set<string>();
  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const path of value) if (typeof path === 'string' && path.length) files.add(path);
    } else if (value && typeof value === 'object') for (const child of Object.values(value)) visit(child);
  }
  visit(manifest);
  return [...files].sort();
}

function pickSample(list: string[] | undefined, rng: () => number, last?: string | null): string | null {
  const unique = [...new Set(list?.filter(Boolean) ?? [])];
  const choices = unique.length > 1 ? unique.filter(path => path !== last) : unique;
  return choices.length ? choices[Math.min(choices.length - 1, Math.max(0, Math.floor(rng() * choices.length)))] : null;
}

/** Near a damage boundary (within five damage points), try the neighbouring tier 20% of the time. */
export function pickHitSample(manifest: SoundManifest, kind: HitKind, strength: HitStrength, weight: number, rng = Math.random, last?: string | null): string | null {
  const tiers = manifest.hit?.[kind];
  if (!tiers?.[strength]?.length) return null;
  const damage = SOUND_DAMAGE_RANGE.light + clamp(weight, 0, 1) * (SOUND_DAMAGE_RANGE.heavy - SOUND_DAMAGE_RANGE.light);
  let neighbour: HitStrength | undefined;
  if (strength === 'light' && Math.abs(damage - SOUND_STRENGTH_DAMAGE.middle) <= 5) neighbour = 'middle';
  if (strength === 'middle') {
    if (Math.abs(damage - SOUND_STRENGTH_DAMAGE.middle) <= 5) neighbour = 'light';
    else if (Math.abs(damage - SOUND_STRENGTH_DAMAGE.high) <= 5) neighbour = 'high';
  }
  if (strength === 'high' && Math.abs(damage - SOUND_STRENGTH_DAMAGE.high) <= 5) neighbour = 'middle';
  const tier = neighbour && tiers[neighbour]?.length && rng() < 0.2 ? neighbour : strength;
  return pickSample(tiers[tier], rng, last);
}

export function pickBlockSample(manifest: SoundManifest, rng = Math.random, last?: string | null): string | null {
  return pickSample(manifest.block, rng, last);
}
export function pickSwingSample(manifest: SoundManifest, rng = Math.random, last?: string | null): string | null {
  return pickSample(manifest.swing, rng, last);
}

/** Pure URL switch. Callers may pass location.search; absent browser state means enabled. */
export function samplesEnabled(search = ''): boolean {
  return new URLSearchParams(search).get('samples') !== '0';
}
/** Where the strike lands, derived from the block level: HIGH → head, MID → body, LOW → legs. */
export type HitZone = 'head' | 'body' | 'legs';
/** Technique family; changes the character on top of kind and weight. */
export type HitStyle = 'normal' | 'spin' | 'uppercut';

export interface StrikeSound {
  kind: HitKind;
  strength: HitStrength;
  /** 0 … 1, continuous from the hit group's damage. Drives loudness, length, pitch and bass. */
  weight: number;
  zone: HitZone;
  style: HitStyle;
  /** −1 … 1, fixed per move and hit group: every technique keeps its own recognisable timbre. */
  signature: number;
  /** −1 … 1, stereo position on the stage. */
  pan: number;
}
export interface ContactSound extends StrikeSound {
  blocked: boolean;
  /** The hit that ended the round (presentation only). */
  finisher: boolean;
}
export interface SwingSound extends StrikeSound {
  /** Seconds from the swing cue to the first active hitbox frame: the whoosh peaks there. */
  leadSeconds: number;
}

/** Damage → weight. 25 (crouching LP) is the lightest, 110 (spin HK) the heaviest hit. */
export const SOUND_DAMAGE_RANGE = { light: 25, heavy: 110 } as const;
/** Strength label for tests/logging: damage below 45 is light, below 75 middle, otherwise high. */
export const SOUND_STRENGTH_DAMAGE = { middle: 45, high: 75 } as const;
/** Whoosh lead before the first active frame, in frames at 60 Hz (light → heavy, spin adds). */
export const SWING_LEAD_FRAMES = { punch: [3, 5], kick: [5, 8], knee: [4, 5], throw: [6, 10], spin: 2 } as const;
/** Hitbox onsets closer than this (e.g. knee then foot of one kick) share a single whoosh. */
export const SWING_MERGE_FRAMES = 8;
const PAN_WIDTH = 0.55;
const SPIN_MOVE = /spin|tornado|turn|dwit/;
const UPPERCUT_MOVE = /uppercut/;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function groupOf(move: CompiledMove, groupId?: string): HitGroup {
  return move.hitGroups.find(group => group.id === groupId) ?? move.hitGroups[0];
}
function kindOf(move: CompiledMove, group: HitGroup): HitKind {
  if (move.throw) return 'throw';
  if (group.id === 'knee') return 'knee';
  // Mixed combos name their groups after the striking limb, or map them to it.
  if (group.id === 'punch') return 'punch';
  if (group.id === 'kick') return 'kick';
  const joint = mappedStrikeJoint(move.id, group.id);
  if (joint) return joint.endsWith('Hand') ? 'punch' : 'kick';
  return move.button.endsWith('P') ? 'punch' : 'kick';
}
function strengthOf(damage: number): HitStrength {
  return damage >= SOUND_STRENGTH_DAMAGE.high ? 'high' : damage >= SOUND_STRENGTH_DAMAGE.middle ? 'middle' : 'light';
}
function zoneOf(level: HitLevel): HitZone {
  return level === 'HIGH' ? 'head' : level === 'LOW' ? 'legs' : 'body';
}
/** Deterministic −1 … 1 from a string (FNV-1a). Not related to the simulation RNG. */
function signatureOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return ((hash >>> 0) % 2001) / 1000 - 1;
}
export function panOf(x: number): number {
  return clamp((x / rules.stageWidth) * 2 - 1, -1, 1) * PAN_WIDTH;
}

/** Everything the synth needs about one strike. Unknown moves fall back to a middle kick. */
export function describeStrike(moveId: string, groupId?: string, x = rules.stageWidth / 2): StrikeSound {
  const move = MOVES[moveId];
  const pan = panOf(x);
  if (!move) return { kind: 'kick', strength: 'middle', weight: 0.5, zone: 'body', style: 'normal', signature: 0, pan };
  const group = groupOf(move, groupId);
  const damage = group.damage ?? move.damage;
  const kind = kindOf(move, group);
  const style: HitStyle = kind === 'knee' ? 'normal' : SPIN_MOVE.test(move.id) ? 'spin' : UPPERCUT_MOVE.test(move.id) ? 'uppercut' : 'normal';
  return {
    kind, strength: strengthOf(damage),
    weight: clamp((damage - SOUND_DAMAGE_RANGE.light) / (SOUND_DAMAGE_RANGE.heavy - SOUND_DAMAGE_RANGE.light), 0, 1),
    zone: zoneOf(group.hitLevel ?? move.hitLevel), style,
    signature: signatureOf(`${move.id}:${group.id}`), pan,
  };
}

/** Short summary kept for tests and debugging. */
export function classifyHit(moveId: string, groupId?: string): { kind: HitKind; strength: HitStrength } {
  const { kind, strength } = describeStrike(moveId, groupId);
  return { kind, strength };
}

type LastContact = GameState['lastContact'];
function sameContact(a: LastContact, b: LastContact): boolean {
  return !!a && !!b && a.frame === b.frame && a.attacker === b.attacker && a.defender === b.defender;
}
/** hitTargets entries this step added. A new attack (attackId) starts from an empty list. */
function addedTargets(fighter: Fighter, before: Fighter | undefined): string[] {
  const known = before && before.attackId === fighter.attackId ? before.hitTargets.length : 0;
  return fighter.hitTargets.slice(known);
}

/**
 * New contacts of this step, each exactly once. The simulation appends `group:defender`
 * to the attacker's hitTargets for every resolved contact, so growth of that list is the
 * contact event: it survives hitstop (no growth), snapshots (values, not identity), resets
 * and round changes (fresh fighters) and reports both strikes of a trade.
 */
export function newContactSounds(game: GameState, previous: GameState): ContactSound[] {
  const sounds: ContactSound[] = [];
  const fresh = game.lastContact && !sameContact(game.lastContact, previous.lastContact) ? game.lastContact : null;
  for (const attacker of game.fighters) {
    const before = previous.fighters[attacker.id];
    const moveId = attacker.moveId ?? before?.moveId;
    for (const target of addedTargets(attacker, before)) {
      const split = target.lastIndexOf(':');
      const groupId = target.slice(0, split), defenderId = Number(target.slice(split + 1));
      const defender = game.fighters[defenderId];
      if (!moveId || !MOVES[moveId] || !defender) continue;
      const blocked = fresh && fresh.attacker === attacker.id && fresh.defender === defenderId ? fresh.blocked : defender.state === 'Blockstun';
      const finisher = !blocked && defender.hp === 0 && (previous.fighters[defenderId]?.hp ?? 0) > 0;
      sounds.push({ ...describeStrike(moveId, groupId, (attacker.x + defender.x) / 2), blocked, finisher });
    }
  }
  return sounds;
}

export interface ThrowSounds {
  /** Grab: short cloth/grip thud when the opponent is seized. */
  grabs: StrikeSound[];
  /** Flight: the regular whoosh (sample where available), peaking on the impact. */
  flights: SwingSound[];
  /** Impact: heavy slam (kind `throw`), never blocked. */
  slams: ContactSound[];
}
/**
 * Throw sounds of this step, derived like every other cue from two consecutive
 * states: the victim entering `Thrown`, the thrower's execute move passing its
 * release frame, and the victim leaving `Thrown` on the impact.
 */
export function newThrowSounds(game: GameState, previous: GameState): ThrowSounds {
  const result: ThrowSounds = { grabs: [], flights: [], slams: [] };
  for (const victim of game.fighters) {
    const old = previous.fighters[victim.id];
    if (!old) continue;
    if (victim.state === 'Thrown' && old.state !== 'Thrown' && victim.thrownBy) result.grabs.push(describeStrike(victim.thrownBy, undefined, victim.x));
    if (old.state === 'Thrown' && victim.state !== 'Thrown' && old.thrownBy)
      result.slams.push({ ...describeStrike(old.thrownBy, undefined, victim.x), blocked: false, finisher: victim.hp === 0 && old.hp > 0 });
    const thrower = game.fighters[1 - victim.id], before = previous.fighters[thrower.id];
    const data = thrower.state === 'Attack' && thrower.moveId ? MOVES[thrower.moveId]?.throw : undefined;
    if (data?.phase === 'execute' && victim.state === 'Thrown') {
      const from = before?.moveId === thrower.moveId && before.attackId === thrower.attackId ? before.moveFrame : -1;
      if (from < data.releaseFrame! && thrower.moveFrame >= data.releaseFrame!)
        result.flights.push({ ...describeStrike(thrower.moveId!, undefined, victim.x), leadSeconds: (data.impactFrame! - data.releaseFrame!) / rules.hz });
    }
  }
  return result;
}

interface SwingCue { frame: number; lead: number; groupId: string }
const cueCache = new Map<string, SwingCue[]>();

/** One whoosh per separate strike of a move, timed from its hitbox data. */
export function swingCues(moveId: string): SwingCue[] {
  const cached = cueCache.get(moveId);
  if (cached) return cached;
  const move = MOVES[moveId];
  if (!move) return [];
  const onsets: { frame: number; groupId: string; damage: number }[] = [];
  for (const group of move.hitGroups) {
    let active = false;
    move.frames.forEach((frame, index) => {
      const present = frame.hitboxes.some(box => box.hitGroup === group.id);
      if (present && !active) onsets.push({ frame: index, groupId: group.id, damage: group.damage ?? move.damage });
      active = present;
    });
  }
  onsets.sort((a, b) => a.frame - b.frame);
  // Merge onsets of one limb motion (knee → foot); the heavier group gives the sound.
  const merged: { frame: number; groupId: string; damage: number }[] = [];
  for (const onset of onsets) {
    const last = merged[merged.length - 1];
    if (last && onset.frame - last.frame < SWING_MERGE_FRAMES) {
      if (onset.damage > last.damage || last.groupId === 'knee') { last.groupId = onset.groupId; last.damage = onset.damage; }
    } else merged.push({ ...onset });
  }
  const cues = merged.map(({ frame, groupId }) => {
    const strike = describeStrike(moveId, groupId);
    const [light, heavy] = SWING_LEAD_FRAMES[strike.kind];
    const wanted = Math.round(light + (heavy - light) * strike.weight) + (strike.style === 'spin' ? SWING_LEAD_FRAMES.spin : 0);
    const cue = Math.max(0, frame - wanted);
    return { frame: cue, lead: frame - cue, groupId };
  });
  cueCache.set(moveId, cues);
  return cues;
}

/** Whooshes whose cue frame the attack reached in this step (whiffs included). */
export function newSwingSounds(game: GameState, previous: GameState): SwingSound[] {
  const sounds: SwingSound[] = [];
  for (const fighter of game.fighters) {
    if (fighter.state !== 'Attack' || !fighter.moveId) continue;
    const before = previous.fighters[fighter.id];
    const continuing = before && before.state === 'Attack' && before.moveId !== null && before.attackId === fighter.attackId;
    const from = continuing ? before.moveFrame : -1;
    if (fighter.moveFrame <= from) continue;
    for (const cue of swingCues(fighter.moveId)) {
      if (cue.frame > from && cue.frame <= fighter.moveFrame)
        sounds.push({ ...describeStrike(fighter.moveId, cue.groupId, fighter.x), leadSeconds: cue.lead / rules.hz });
    }
  }
  return sounds;
}

/**
 * Fighters that started a full-bar move (`command.resource`: Revenge combo,
 * Wirbel) in this step, with the spent bar and their stereo position. A chord
 * upgrade switches the move in place (same attackId), so the move id is
 * compared as well.
 */
export function newResourceStarts(game: GameState, previous: GameState): { fighter: number; pan: number; resource: 'revenge' | 'special' }[] {
  const starts: { fighter: number; pan: number; resource: 'revenge' | 'special' }[] = [];
  for (const f of game.fighters) {
    const before = previous.fighters[f.id];
    const resource = f.state === 'Attack' && f.moveId ? MOVES[f.moveId]?.command.resource : undefined;
    if (!resource) continue;
    if (before && before.state === 'Attack' && before.moveId === f.moveId && before.attackId === f.attackId) continue;
    starts.push({ fighter: f.id, pan: panOf(f.x), resource });
  }
  return starts;
}
