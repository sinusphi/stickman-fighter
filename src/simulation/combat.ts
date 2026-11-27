import bodies from '../data/bodies.json';
import rules from '../data/rules.json';
import { CROUCH_BUTTONS, MOVES, advanceAt, isPlayableMove, groupValue, type CompiledMove, type FrameBoxes, type HitLevel, type HitGroup } from '../data/schema';
import { buttonBit, type Button, type Direction } from '../input/types';
import { consumeCommand } from '../input/commands';
import { readHistory } from '../input/history';
import { isActionable, isGroundActionable, recoverGround, transition } from './movement';
import { clampToStage, overlaps, resolvePushboxes, stance, worldBox } from './collision';
import { requiresCrouchGuard } from './guard';
import type { Stance } from './collision';
import type { Fighter, GameState } from './types';
import { hasPoseContact, usesPoseContact } from './pose-contact';

export function localBoxes(f: Fighter): FrameBoxes {
  if (f.state === 'Attack' && f.moveId) return MOVES[f.moveId].frames[f.moveFrame];
  // Thrown fighters are invulnerable until the knockdown after the impact.
  if (f.state === 'Thrown') return { ...bodies[stance(f)], hurtboxes: [], hitboxes: [] };
  return { ...bodies[stance(f)], hitboxes: [] };
}
export function advanceAttack(f: Fighter): void {
  if (f.state !== 'Attack' || !f.moveId) return;
  const move = MOVES[f.moveId];
  if (++f.moveFrame >= move.duration) {
    f.moveId = null;
    if (f.y < 0) transition(f, 'Airborne'); else recoverGround(f);
  } else f.landingRecovery = Math.min(move.recovery, move.duration - f.moveFrame);
}
export function standingHoldEligible(f: Fighter): boolean {
  return (f.state==='Idle' || f.state==='Walk' || f.state==='Run') && f.y===0 && !f.crouching;
}
/** Frames after a single kick started in which its chord partners may still arrive. */
export const CHORD_WINDOW_FRAMES = 3;
/**
 * Multi-button chords (two or three keys) whose physical keys can straddle
 * simulation frames. The single move started by whichever key arrived first
 * is upgraded in place during its first startup frames, once the last partner
 * key arrives. Order matters: the first matching entry wins. `sources` maps
 * each single move to the button that started it; the partners are the other
 * buttons of the chord. `travel` keeps every key order on the same world path:
 *  - undoSource: the single's own advance is undone,
 *  - catchUpTarget: the chord's advance for the elapsed frames is applied,
 *  - none: all singles and the chord share the same travel,
 *  - replace: both: the single's advance is undone and the chord's applied.
 */
interface ChordUpgrade { sources: Readonly<Record<string, Button>>; direction: Direction; target: string; travel: 'undoSource' | 'catchUpTarget' | 'none' | 'replace' }
export const CHORD_UPGRADES: readonly ChordUpgrade[] = [
  // Back LP+LK+MK (A+R+F+B, pad X+A+B), only with a full Special bar: the Wirbel.
  // No two-key subset of it is a back chord (those are LK+LMK and MK+HP).
  { sources: { standing_lp: 'LP', left_turn_kick: 'LK', spin_mk: 'MK' }, direction: 4, target: 'special_spin', travel: 'replace' },
  // Forward H+N. Remove the single right high kick’s startup advance.
  { sources: { spin_hk: 'HK', standing_rhk: 'RHK' }, direction: 6, target: 'middle_high_punch_combo', travel: 'undoSource' },
  // Forward G+B.
  { sources: { standing_lmk: 'LMK', tornado_mk: 'MK' }, direction: 6, target: 'middle_high_low_combo', travel: 'undoSource' },
  // Forward V+B.
  { sources: { standing_rlk: 'RLK', tornado_mk: 'MK' }, direction: 6, target: 'spin_high_middle_combo', travel: 'undoSource' },
  // Back LK+LMK.
  { sources: { left_turn_kick: 'LK', standing_lmk: 'LMK' }, direction: 4, target: 'double_high_kick', travel: 'catchUpTarget' },
  // Forward MK+HK.
  { sources: { tornado_mk: 'MK', spin_hk: 'HK' }, direction: 6, target: 'tornado_spin_combo', travel: 'none' },
  // Forward T+N. Remove the single right high kick’s startup advance.
  { sources: { standing_mp: 'MP', standing_rhk: 'RHK' }, direction: 6, target: 'punch_kick_combo', travel: 'undoSource' },
  // Back B+Y. Neither single (spin_mk, standing_hp) nor the chord travels.
  { sources: { spin_mk: 'MK', standing_hp: 'HP' }, direction: 4, target: 'kick_punch_combo', travel: 'none' },
];
const advanceOffset = (moveId: string, frame: number): number => advanceAt(MOVES[moveId].advance, frame);
/**
 * The chord is complete in this step: the key that started the single was
 * pressed on the single's first frame and held since, the direction was held
 * throughout, every partner key was pressed inside the window and is still
 * held, and one of them arrives right now (the buffered command).
 */
function chordCompleted(f: Fighter, first: Button, partners: readonly Button[], direction: Direction): boolean {
  const mask = partners.reduce((bits, button) => bits | buttonBit(button), buttonBit(first)), current = f.input.current;
  const history = readHistory(f.input.history).slice(-f.moveFrame - 1);
  const arriving = f.input.pending?.button;
  return arriving !== undefined && partners.includes(arriving) && (current.pressed & buttonBit(arriving)) !== 0 &&
    (current.held & mask) === mask && history.length === f.moveFrame + 1 &&
    (history[0].pressed & buttonBit(first)) !== 0 &&
    history.every(frame => frame.direction === direction && (frame.held & buttonBit(first)) !== 0) &&
    partners.every(button => {
      const bit = buttonBit(button), from = history.findIndex(frame => (frame.pressed & bit) !== 0);
      return from >= 0 && history.slice(from).every(frame => (frame.held & bit) !== 0);
    });
}
/**
 * Full-bar moves (`command.resource`): available only with that bar completely
 * full and while standing on the ground; otherwise the input behaves exactly as
 * if the move did not exist.
 */
export function resourceReady(f: Fighter, move: CompiledMove): boolean {
  const name = move.command.resource;
  if (!name) return true;
  const resource = f.resources[name];
  return resource.current >= resource.max && f.y === 0 && !f.crouching;
}
/** A full-bar move empties its bar when it starts, whether it lands or not. */
function spendResource(f: Fighter, move: CompiledMove): void {
  if (move.command.resource) f.resources[move.command.resource].current = 0;
}
/** Upgrades a fresh single kick into its chord. Never turns recovery buffers into chords. */
function upgradeChord(f: Fighter): boolean {
  if (f.state !== 'Attack' || !f.moveId || f.moveFrame <= 0 || f.moveFrame > CHORD_WINDOW_FRAMES) return false;
  for (const chord of CHORD_UPGRADES) {
    const first = chord.sources[f.moveId];
    if (!first) continue;
    const partners = Object.values(chord.sources).filter(button => button !== first);
    const target = MOVES[chord.target];
    if (!resourceReady(f, target) || !chordCompleted(f, first, partners, chord.direction)) continue;
    if (chord.travel === 'undoSource' || chord.travel === 'replace') f.x -= f.attackFacing * advanceOffset(f.moveId, f.moveFrame);
    f.moveId = chord.target; f.landingRecovery = target.recovery;
    if (chord.travel === 'catchUpTarget' || chord.travel === 'replace') f.x += f.attackFacing * advanceOffset(chord.target, f.moveFrame);
    spendResource(f, target);
    f.input.pending = null;
    return true;
  }
  return false;
}
export function startAttack(f: Fighter, combatFrame: number, holdEligible = standingHoldEligible(f)): void {
  if (upgradeChord(f)) return;
  if (!isActionable(f) || !f.input.pending) return;
  const button = f.input.pending.button;
  if (stance(f) === 'crouching' && !CROUCH_BUTTONS.includes(button)) {
    f.input.pending = null;
    return;
  }
  const pending = f.input.pending, current = f.input.current;
  const commandMatches = (move: CompiledMove): boolean => {
    const command = move.command;
    if (command.type === 'normal') return true;
    if (command.type === 'hold') return holdEligible && resourceReady(f, move) && command.directions.includes(current.direction) && command.buttons.every(b => Boolean(current.pressed & buttonBit(b)));
    return resourceReady(f, move) && pending.motions.includes(command.motionId ?? '');
  };
  const candidates = Object.values(MOVES).filter(move => isPlayableMove(move) && move.stance === stance(f) && move.button === button && commandMatches(move));
  const category={normal:0,hold:1,motion:2};
  candidates.sort((a,b) => category[b.command.type] - category[a.command.type] || b.command.priority-a.command.priority || (a.id < b.id ? -1 : 1));
  const move = candidates[0];
  if (!move || !consumeCommand(f.input, true, combatFrame)) return;
  transition(f, 'Attack'); f.moveId = move.id; f.moveFrame = 0; f.attackFacing = f.facing; f.attackId++; f.hitTargets = [];
  f.landingRecovery = move.recovery;
  spendResource(f, move);
  if (f.y < 0) f.airAttackUsed = true; else f.vx = 0;
}
export function canBlock(f: Fighter, level: HitLevel, autoBlock = false, attackStance: Stance = 'standing', airborne = false): boolean {
  if (f.y < 0 || !(isGroundActionable(f) || f.state === 'Blockstun')) return false;
  const direction = f.input.current.direction;
  const raw = f.input.previous;
  const forward = f.facing === 1 ? raw.right : raw.left;
  const back = f.facing === 1 ? raw.left : raw.right;
  const automatic = !raw.up && !forward && !raw.buttons && !f.input.current.pressed &&
    ((!raw.down && !back && direction === 5) || (raw.down && (direction === 1 || direction === 2)));
  const crouching = direction >= 1 && direction <= 3;
  if (crouching !== requiresCrouchGuard(level, attackStance, airborne)) return false;
  return (autoBlock && automatic) || direction === 1 || direction === 4;
}

/**
 * Strength of one hit group: an explicit entry in rules.hitStrength.overrides
 * (`moveId:groupId`), otherwise its damage. Light hits only cause hitstun; a
 * grounded hit whose strength reaches the defender's stability knocks down.
 */
export function hitStrength(move: CompiledMove, group: HitGroup): number {
  const overrides: Record<string, number> = rules.hitStrength.overrides;
  return overrides[`${move.id}:${group.id}`] ?? group.damage ?? move.damage;
}
export function knocksDown(move: CompiledMove, group: HitGroup, defender: Fighter): boolean {
  return hitStrength(move, group) >= (defender.stability ?? rules.hitStrength.defaultStability);
}
interface Contact { attacker: Fighter; defender: Fighter; move: CompiledMove; hitGroup: HitGroup; group: string; blocked: boolean; side: number }
export function addHitResource(fighter: Fighter, name: 'revenge' | 'special', damage: number): void {
  const resource = fighter.resources[name];
  const gain = Math.round(damage * resource.gainPerHit / 100);
  resource.current = Math.min(resource.max, resource.current + gain);
}
// Blocked hits feed only a trickle (at least 1) so both meters never fill in lockstep.
export function addBlockResource(fighter: Fighter, name: 'revenge' | 'special', damage: number): void {
  const resource = fighter.resources[name];
  if (resource.gainPerBlock <= 0) return;
  const gain = Math.max(1, Math.round(damage * resource.gainPerBlock / 100));
  resource.current = Math.min(resource.max, resource.current + gain);
}
export function collectContacts(game: GameState): Contact[] {
  const contacts: Contact[] = [];
  for (const attacker of game.fighters) {
    if (attacker.state !== 'Attack' || !attacker.moveId) continue;
    const defender = game.fighters[1-attacker.id];
    if (defender.state === 'KO' || defender.state === 'Knockdown' || defender.state === 'Thrown') continue;
    const move = MOVES[attacker.moveId];
    for (const hitbox of localBoxes(attacker).hitboxes) {
      const group = `${hitbox.hitGroup}:${defender.id}`;
      const count = attacker.hitTargets.filter(id => id === group).length;
      const hitGroup = move.hitGroups.find(g => g.id === hitbox.hitGroup)!;
      const max = move.multiHit ? hitGroup.maxHitsPerTarget : 1;
      if (count >= max || contacts.some(c=>c.attacker===attacker && c.group===group)) continue;
      if (!localBoxes(defender).hurtboxes.some(hurtbox => overlaps(worldBox(hitbox,attacker,attacker.attackFacing), worldBox(hurtbox,defender,defender.state==='Attack'?defender.attackFacing:defender.facing)))) continue;
      if (usesPoseContact(move.id)) {
        if (!hasPoseContact(attacker,defender,hitbox.hitGroup,game.lastContact?.defender===defender.id?game.lastContact.hitLevel:undefined)) continue;
      }
      const side = defender.x === attacker.x ? attacker.attackFacing : defender.x > attacker.x ? 1 : -1;
      // Survival: no guard against an attacker in the back (the defender faces away).
      const guardable = !game.noRearGuard || defender.facing !== side;
      contacts.push({ attacker, defender, move, hitGroup, group, blocked: guardable && canBlock(defender,hitGroup.hitLevel??move.hitLevel,game.inputConfig.autoBlock?.[defender.id],move.stance,attacker.y<0), side });
    }
  }
  return contacts;
}

export function resolveCombat(game: GameState): void {
  const contacts = collectContacts(game);
  // Capture the actual contact before pushback/reactions separate the figures.
  // A replay carries this small pose snapshot through hitstop as well.
  const poses=contacts.some(c=>usesPoseContact(c.move.id))?game.fighters.map(({id,x,y,vx,facing,attackFacing,state,stateFrame,moveId,moveFrame,crouching,hitReaction})=>({x,y,vx,facing,attackFacing,state,stateFrame,moveId,moveFrame,crouching,hitReaction,hitLevel:game.lastContact?.defender===id?game.lastContact.hitLevel:undefined})):undefined;
  const displacement = [0, 0];
  for (const c of contacts) {
    const { attacker, defender, move, hitGroup, blocked, side } = c;
    attacker.hitTargets.push(c.group);
    // A secondary group (the knee before a kick) may carry its own reactions.
    const push = groupValue(move, hitGroup, blocked ? 'pushbackBlock' : 'pushbackHit');
    const projected = { ...defender, x: defender.x + side * push };
    clampToStage(projected);
    const moved = Math.abs(projected.x - defender.x);
    displacement[defender.id] += side * moved;
    displacement[attacker.id] -= side * (push - moved);
    const wasStunned = defender.state === 'Hitstun';
    defender.moveId = null; defender.landingRecovery = 0;
    defender.vx = 0;
    if (blocked) {
      defender.crouching = defender.input.current.direction <= 3;
      addBlockResource(attacker, 'special', hitGroup.damage ?? move.damage);
      const fullDamage = Math.trunc((hitGroup.damage ?? move.damage) * attacker.damageScalePermille / rules.damageScaleUnit);
      if (!game.training.enabled) defender.hp = Math.max(0, defender.hp - Math.round(fullDamage * .08));
      if (!game.training.enabled && defender.hp === 0) { transition(defender,'KO'); defender.input.pending = null; }
      else transition(defender,'Blockstun',groupValue(move,hitGroup,'blockstun'));
    } else {
      attacker.comboCount = wasStunned ? attacker.comboCount + 1 : 1;
      const baseDamage = hitGroup.damage ?? move.damage;
      addHitResource(attacker, 'special', baseDamage);
      addHitResource(defender, 'revenge', baseDamage);
      if(!game.training.enabled)
        defender.hp = Math.max(0, defender.hp - Math.trunc(baseDamage * attacker.damageScalePermille / rules.damageScaleUnit));
      if (!game.training.enabled && defender.hp === 0) { transition(defender,'KO'); defender.input.pending = null; }
      else if (defender.y < 0) { transition(defender,'Knockdown',rules.knockdownFrames); defender.vy = rules.airHitVelocity; defender.airAttackUsed = true; }
      else if (knocksDown(move, hitGroup, defender)) {
        // Heavy grounded hit: a short hop backwards, then the regular knockdown and stand-up.
        transition(defender,'Knockdown',rules.knockdownFrames);
        defender.vy = rules.hitStrength.groundKnockdownVelocity; defender.vx = side * rules.hitStrength.groundKnockdownSpeed;
        defender.airAttackUsed = true;
      }
      else {
        if (move.standingHitstun) defender.crouching = false;
        transition(defender,'Hitstun',groupValue(move,hitGroup,'hitstun'));
        if(move.groundHitReaction==='middlePunch') {
          defender.hitReaction='middlePunch';
          defender.vx=side*(move.slideSpeed??0);
        }
      }
    }
    game.hitstop = Math.max(game.hitstop, groupValue(move,hitGroup,'hitstop'));
    game.lastContact = { attacker: attacker.id, defender: defender.id, blocked, frame: game.combatFrame, hitLevel:hitGroup.hitLevel??move.hitLevel, ...(poses?{poses}:{}) };
    for (const measurement of game.measurements) if (!measurement.complete) {
      game.fighters[measurement.attacker].advantage = 'n/a'; game.fighters[measurement.defender].advantage = 'n/a'; measurement.complete = true;
    }
    attacker.advantage = defender.hp === 0 ? 'n/a' : 'pending';
    defender.advantage = attacker.advantage;
    game.measurements.push({ attacker:attacker.id, defender:defender.id, attackerReady:null, defenderReady:null, complete:defender.hp===0 });
  }
  game.fighters.forEach(f => f.x += displacement[f.id]);
  resolvePushboxes(game.fighters);
  game.measurements = game.measurements.slice(-2);
}

export function measureAdvantage(game: GameState, available = game.fighters.map(isActionable)): void {
  for (const measurement of game.measurements) {
    if (measurement.complete) continue;
    if (measurement.attackerReady === null && available[measurement.attacker]) measurement.attackerReady = game.combatFrame;
    if (measurement.defenderReady === null && available[measurement.defender]) measurement.defenderReady = game.combatFrame;
    if (measurement.attackerReady !== null && measurement.defenderReady !== null) {
      game.fighters[measurement.attacker].advantage = measurement.defenderReady-measurement.attackerReady;
      game.fighters[measurement.defender].advantage = measurement.attackerReady-measurement.defenderReady;
      measurement.complete = true;
    }
  }
}
