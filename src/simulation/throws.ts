import bodies from '../data/bodies.json';
import rules from '../data/rules.json';
import { MOVES, type CompiledMove } from '../data/schema';
import { clampToStage, overlaps, pushbox, resolvePushboxes, worldBox, type Box } from './collision';
import { transition } from './movement';
import { addHitResource } from './combat';
import type { Fighter, GameState } from './types';

/*
 * Throws. A throw attempt is an ordinary standing hold move (6/4 + THROW). Its
 * first active frame is the grab check:
 *  - both fighters reach their grab frame in the same step and stand in each
 *    other's grab range → throw clash: both switch to the break move, are pushed
 *    apart and recover briefly (symmetric, no player priority);
 *  - the opponent is grabbable and in range → the attacker switches to the
 *    attempt's execute move and the opponent becomes `Thrown`;
 *  - otherwise the attempt whiffs and plays its long recovery.
 * While `Thrown` the victim follows the execute move's per-frame table relative
 * to the thrower and is invulnerable. On the impact frame damage, resources and
 * hitstop apply and the victim lies in a regular knockdown (or KO).
 * Throws are never blocked and give no combo follow-up.
 */

/** States in which a fighter can be grabbed: on the ground and able to act. */
export const THROWABLE_STATES: readonly Fighter['state'][] = ['Idle', 'Walk', 'Crouch', 'CrouchWalk'];
export function isThrowable(f: Fighter): boolean { return f.y === 0 && THROWABLE_STATES.includes(f.state); }

/** Grab range in local (unscaled) box units: from the standing pushbox front edge forward. */
export function localGrabBox(move: CompiledMove): Box {
  const push = bodies.standing.pushbox;
  return { x: push.x + push.width, y: push.y, width: move.throw?.range ?? 0, height: push.height };
}
/** World grab box of an attacker in a throw attempt (facing = attack facing). */
export function grabBox(attacker: Fighter, move: CompiledMove): Box {
  return worldBox(localGrabBox(move), attacker, attacker.attackFacing);
}
export function inGrabRange(attacker: Fighter, defender: Fighter, move: CompiledMove): boolean {
  return overlaps(grabBox(attacker, move), pushbox(defender));
}

/** The throw attempt `f` is in when it reaches its grab frame in this step, else null. */
export const attemptAtGrab = (f: Fighter): CompiledMove | null => {
  const move = f.state === 'Attack' && f.moveId ? MOVES[f.moveId] : undefined;
  return move?.throw?.phase === 'attempt' && f.moveFrame === move.startup ? move : null;
};
/** Validated in data/schema; resolved once so the step never searches. */
const BREAK_MOVE: CompiledMove = (() => {
  const move = Object.values(MOVES).find(candidate => candidate.throw?.phase === 'break');
  if (!move) throw Error('Wurf-Clash-Move fehlt.');
  return move;
})();
interface ExecuteTable { path: number[][]; impactFrame: number }
/** Per-frame table of an execute move (shape guaranteed by validateMoves). */
function table(move: CompiledMove): ExecuteTable {
  const data = move.throw;
  if (!data?.path || data.impactFrame === undefined) throw Error(`${move.id}: keine Wurfbahn.`);
  return { path: data.path, impactFrame: data.impactFrame };
}

function switchMove(f: Fighter, move: CompiledMove): void {
  f.moveId = move.id; f.moveFrame = 0; f.attackId++; f.hitTargets = [];
  f.landingRecovery = move.recovery;
}

/**
 * Grab checks of this step. Runs after attacks started and pushboxes resolved,
 * before strikes. `grabbable` decides which defenders can be seized (versus:
 * `isThrowable`; survival widens it, see survival/state).
 */
export function resolveThrows(game: GameState, grabbable: (f: Fighter) => boolean = isThrowable): void {
  const attempts = game.fighters.map(attemptAtGrab);
  const [a, b] = game.fighters;
  if (attempts[0] && attempts[1] && inGrabRange(a, b, attempts[0]) && inGrabRange(b, a, attempts[1])) {
    const clash = BREAK_MOVE;
    // Push both apart along the line between them, symmetric and clamped to the stage.
    const side = a.x === b.x ? a.attackFacing : Math.sign(b.x - a.x);
    for (const f of game.fighters) { switchMove(f, clash); f.vx = 0; }
    a.x -= side * clash.pushbackHit; b.x += side * clash.pushbackHit;
    resolvePushboxes(game.fighters);
    game.hitstop = Math.max(game.hitstop, clash.hitstop);
    return;
  }
  for (const attacker of game.fighters) {
    const attempt = attempts[attacker.id];
    if (!attempt) continue;
    const defender = game.fighters[1 - attacker.id];
    if (!grabbable(defender) || !inGrabRange(attacker, defender, attempt)) continue;
    const execute = MOVES[attempt.throw?.execute ?? ''];
    if (!execute) continue;
    switchMove(attacker, execute);
    transition(defender, 'Thrown');
    defender.thrownBy = execute.id;
    defender.moveId = null; defender.moveFrame = 0; defender.landingRecovery = 0;
    defender.vx = 0; defender.vy = 0; defender.crouching = false; defender.input.pending = null;
    // The victim keeps facing the thrower for the whole throw (render and pushbox).
    defender.attackFacing = attacker.attackFacing === 1 ? -1 : 1;
    placeVictim(attacker, defender, execute, 0);
    game.hitstop = Math.max(game.hitstop, attempt.hitstop);
  }
}

/**
 * Puts the victim on the table position of `frame`. Near a wall the victim is
 * clamped and the thrower gives way by the same amount, so the relative path,
 * including the side switch of a back throw, is never cut and nobody leaves
 * the stage or passes through the other.
 */
function placeVictim(attacker: Fighter, victim: Fighter, execute: CompiledMove, frame: number): void {
  const { path, impactFrame } = table(execute);
  const [dx, dy] = path[Math.min(frame, impactFrame)];
  victim.x = attacker.x + attacker.attackFacing * dx; victim.y = dy;
  const wanted = victim.x;
  clampToStage(victim);
  if (victim.x !== wanted) { attacker.x += victim.x - wanted; clampToStage(attacker); victim.x = attacker.x + attacker.attackFacing * dx; clampToStage(victim); }
}

/**
 * Advances every running throw by the thrower's current move frame. `live`
 * is false after the round was decided (settling): the victim still lands in
 * a knockdown, but no damage, resources or contact are applied any more.
 */
export function advanceThrows(game: GameState, live = true): void {
  for (const victim of game.fighters) {
    if (victim.state !== 'Thrown') continue;
    const attacker = game.fighters[1 - victim.id];
    const execute = victim.thrownBy ? MOVES[victim.thrownBy] : undefined;
    if (!execute?.throw || attacker.state !== 'Attack' || attacker.moveId !== execute.id) {
      // Defensive: a throw without its thrower ends as a knockdown where the victim is.
      victim.y = 0; transition(victim, 'Knockdown', rules.knockdownFrames); continue;
    }
    placeVictim(attacker, victim, execute, attacker.moveFrame);
    if (attacker.moveFrame >= table(execute).impactFrame) land(game, attacker, victim, execute, live);
  }
}

function land(game: GameState, attacker: Fighter, victim: Fighter, execute: CompiledMove, live: boolean): void {
  victim.y = 0; victim.vx = 0; victim.vy = 0;
  if (live) {
    const damage = execute.damage;
    addHitResource(attacker, 'special', damage);
    addHitResource(victim, 'revenge', damage);
    attacker.comboCount = 1;
    if (!game.training.enabled) victim.hp = Math.max(0, victim.hp - Math.trunc(damage * attacker.damageScalePermille / rules.damageScaleUnit));
    game.hitstop = Math.max(game.hitstop, execute.hitstop);
    game.lastContact = { attacker: attacker.id, defender: victim.id, blocked: false, frame: game.combatFrame, hitLevel: execute.hitLevel };
    for (const measurement of game.measurements) if (!measurement.complete) {
      game.fighters[measurement.attacker].advantage = 'n/a'; game.fighters[measurement.defender].advantage = 'n/a'; measurement.complete = true;
    }
    attacker.advantage = victim.hp === 0 ? 'n/a' : 'pending'; victim.advantage = attacker.advantage;
    game.measurements.push({ attacker: attacker.id, defender: victim.id, attackerReady: null, defenderReady: null, complete: victim.hp === 0 });
    game.measurements = game.measurements.slice(-2);
  }
  if (live && !game.training.enabled && victim.hp === 0) { transition(victim, 'KO'); victim.input.pending = null; }
  else transition(victim, 'Knockdown', rules.knockdownFrames);
  resolvePushboxes(game.fighters);
}
