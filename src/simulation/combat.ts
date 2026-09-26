import bodies from '../data/bodies.json';
import rules from '../data/rules.json';
import { MOVES, type CompiledMove, type FrameBoxes, type HitLevel, type HitGroup } from '../data/schema';
import { buttonBit } from '../input/types';
import { consumeCommand } from '../input/commands';
import { readHistory } from '../input/history';
import { isActionable, isGroundActionable, recoverGround, transition } from './movement';
import { clampToStage, overlaps, resolvePushboxes, stance, worldBox } from './collision';
import type { Fighter, GameState } from './types';

export function localBoxes(f: Fighter): FrameBoxes {
  if (f.state === 'Attack' && f.moveId) return MOVES[f.moveId].frames[f.moveFrame];
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
  return (f.state==='Idle' || f.state==='Walk') && f.y===0 && !f.crouching;
}
export function startAttack(f: Fighter, combatFrame: number, holdEligible = standingHoldEligible(f)): void {
  // Real keyboard chords can straddle simulation frames. Upgrade only the
  // first three startup frames of a fresh forward-direction kick, preserving elapsed
  // time, advance and attack identity. Never turn recovery buffers into chords.
  if (f.state==='Attack' && ['tornado_mk','spin_hk'].includes(f.moveId??'') && f.moveFrame>0 && f.moveFrame<=3) {
    const first=buttonBit(f.moveId==='tornado_mk'?'MK':'HK');
    const second=buttonBit(f.moveId==='tornado_mk'?'HK':'MK');
    const current=f.input.current,history=readHistory(f.input.history).slice(-f.moveFrame-1);
    if (f.input.pending?.button===(f.moveId==='tornado_mk'?'HK':'MK') &&
      (current.pressed&second)!==0 && (current.held&(first|second))===(first|second) &&
      history.length===f.moveFrame+1 && (history[0].pressed&first)!==0 &&
      history.every(frame=>frame.direction===6 && (frame.held&first)!==0)) {
      f.moveId='tornado_spin_combo';f.landingRecovery=MOVES.tornado_spin_combo.recovery;
      f.input.pending=null;
      return;
    }
  }
  if (!isActionable(f) || !f.input.pending) return;
  const button = f.input.pending.button;
  // Reserved chord: consume it so releasing back cannot emit a buffered LK.
  if (holdEligible && button==='LK' && f.input.current.direction===4) {
    consumeCommand(f.input, true, combatFrame);
    return;
  }
  const candidates = Object.values(MOVES).filter(move => move.stance === stance(f) && move.button === button && (move.command.type === 'normal' || (move.command.type==='hold' ? holdEligible && move.command.directions.includes(f.input.current.direction) && move.command.buttons.every(b=>Boolean(f.input.current.pressed & buttonBit(b))) : f.input.pending!.motions.includes(move.command.motionId ?? ''))));
  const category={normal:0,hold:1,motion:2};
  candidates.sort((a,b) => category[b.command.type] - category[a.command.type] || b.command.priority-a.command.priority || (a.id < b.id ? -1 : 1));
  const move = candidates[0];
  if (!move || !consumeCommand(f.input, true, combatFrame)) return;
  transition(f, 'Attack'); f.moveId = move.id; f.moveFrame = 0; f.attackFacing = f.facing; f.attackId++; f.hitTargets = [];
  f.landingRecovery = move.recovery;
  if (f.y < 0) f.airAttackUsed = true; else f.vx = 0;
}
export function canBlock(f: Fighter, level: HitLevel): boolean {
  if (f.y < 0 || !(isGroundActionable(f) || f.state === 'Blockstun')) return false;
  const direction = f.input.current.direction;
  return direction === 1 ? level !== 'HIGH' : direction === 4 && level !== 'LOW';
}

interface Contact { attacker: Fighter; defender: Fighter; move: CompiledMove; hitGroup: HitGroup; group: string; blocked: boolean; side: number }
function addHitResource(fighter: Fighter, name: 'revenge' | 'special', damage: number): void {
  const resource = fighter.resources[name];
  const gain = Math.round(damage * resource.gainPerHit / 100);
  resource.current = Math.min(resource.max, resource.current + gain);
}
export function collectContacts(game: GameState): Contact[] {
  const contacts: Contact[] = [];
  for (const attacker of game.fighters) {
    if (attacker.state !== 'Attack' || !attacker.moveId) continue;
    const defender = game.fighters[1-attacker.id];
    if (defender.state === 'KO' || defender.state === 'Knockdown') continue;
    const move = MOVES[attacker.moveId];
    for (const hitbox of localBoxes(attacker).hitboxes) {
      const group = `${hitbox.hitGroup}:${defender.id}`;
      const count = attacker.hitTargets.filter(id => id === group).length;
      const hitGroup = move.hitGroups.find(g => g.id === hitbox.hitGroup)!;
      const max = move.multiHit ? hitGroup.maxHitsPerTarget : 1;
      if (count >= max || contacts.some(c=>c.attacker===attacker && c.group===group)) continue;
      if (!localBoxes(defender).hurtboxes.some(hurtbox => overlaps(worldBox(hitbox,attacker,attacker.attackFacing), worldBox(hurtbox,defender,defender.state==='Attack'?defender.attackFacing:defender.facing)))) continue;
      contacts.push({ attacker, defender, move, hitGroup, group, blocked: canBlock(defender,hitGroup.hitLevel??move.hitLevel), side: defender.x === attacker.x ? attacker.attackFacing : defender.x > attacker.x ? 1 : -1 });
    }
  }
  return contacts;
}

export function resolveCombat(game: GameState): void {
  const contacts = collectContacts(game);
  const displacement = [0, 0];
  for (const c of contacts) {
    const { attacker, defender, move, hitGroup, blocked, side } = c;
    attacker.hitTargets.push(c.group);
    const push = blocked ? move.pushbackBlock : move.pushbackHit;
    const projected = { ...defender, x: defender.x + side * push };
    clampToStage(projected);
    const moved = Math.abs(projected.x - defender.x);
    displacement[defender.id] += side * moved;
    displacement[attacker.id] -= side * (push - moved);
    const wasStunned = defender.state === 'Hitstun';
    defender.moveId = null; defender.landingRecovery = 0;
    defender.vx = 0;
    if (blocked) {
      defender.crouching = defender.input.current.direction === 1;
      transition(defender,'Blockstun',move.blockstun);
    } else {
      attacker.comboCount = wasStunned ? attacker.comboCount + 1 : 1;
      const baseDamage = hitGroup.damage ?? move.damage;
      addHitResource(attacker, 'special', baseDamage);
      addHitResource(defender, 'revenge', baseDamage);
      if(!game.training.enabled)
        defender.hp = Math.max(0, defender.hp - Math.trunc(baseDamage * attacker.damageScalePermille / rules.damageScaleUnit));
      if (!game.training.enabled && defender.hp === 0) { transition(defender,'KO'); defender.input.pending = null; }
      else if (defender.y < 0) { transition(defender,'Knockdown',rules.knockdownFrames); defender.vy = rules.airHitVelocity; defender.airAttackUsed = true; }
      else {
        transition(defender,'Hitstun',move.hitstun);
        if(move.groundHitReaction==='middlePunch') {
          defender.hitReaction='middlePunch';
          defender.vx=side*(move.slideSpeed??0);
        }
      }
    }
    game.hitstop = Math.max(game.hitstop, move.hitstop);
    game.lastContact = { attacker: attacker.id, defender: defender.id, blocked, frame: game.combatFrame, ...(hitGroup.hitLevel?{hitLevel:hitGroup.hitLevel}:{}) };
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
