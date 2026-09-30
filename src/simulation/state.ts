import rules from '../data/rules.json';
import type { Fighter, GameState } from './types';
import { createInputState } from '../input/history';
import { captureInput } from '../input/commands';
import { neutralInput, type RawInput } from '../input/types';
import { moveFighter } from './movement';
import { resolvePushboxes } from './collision';
import { advanceAttack, measureAdvantage, resolveCombat, startAttack, standingHoldEligible } from './combat';
import { advanceRound, createRound, resolveRound } from './rounds';
import { dummyInput } from '../debug/training';
import { applyEvents, type ControlEvent } from './events';

export function createFighter(id: number): Fighter {
  return { resources: structuredClone(rules.resources), id, x: rules.spawns[id], y: 0, vx: 0, vy: 0, facing: id === 0 ? 1 : -1, state: 'Idle', stateFrame: 0, hp: rules.maxHealth,
    input: createInputState(), crouching: false, remaining: 0, jumpX: 0, airAttackUsed: false, landingRecovery: 0,
    moveId: null, moveFrame: 0, attackFacing: id === 0 ? 1 : -1, attackId: 0, hitTargets: [],
    comboCount: 0, damageScalePermille: rules.damageScaleUnit, juggleState: 0, advantage: 'n/a' };
}

export function createGame(): GameState {
  return { schemaVersion: 2, frame: 0, combatFrame: 0, fighters: [createFighter(0), createFighter(1)], inputConfig: { socd: { horizontal: 'neutral', vertical: 'positive' }, bufferFrames: rules.bufferFrames }, hitstop: 0, lastContact: null, measurements: [], round: createRound(), training: { enabled:false, dummy:'stand' } };
}

export function updateFacing(game: GameState): void {
  const [a, b] = game.fighters;
  if (a.x !== b.x) {
    a.facing = a.x < b.x ? 1 : -1;
    b.facing = a.facing === 1 ? -1 : 1;
  }
}

export function step(game: GameState, inputs: [RawInput, RawInput] = [neutralInput(), neutralInput()], events: ControlEvent[] = []): void {
  applyEvents(game,events);
  if (game.round.phase !== 'fighting') {
    if (game.hitstop === 0) settleFighters(game);
    game.frame++;
    if (game.hitstop > 0) game.hitstop--; else advanceRound(game,inputs);
    return;
  }
  updateFacing(game);
  const fixedDummy = game.training.enabled && game.training.dummy !== 'cpu';
  const effective: [RawInput, RawInput] = [inputs[0], fixedDummy ? dummyInput(game) : inputs[1]];
  for (const fighter of game.fighters) {
    captureInput(fighter.input, effective[fighter.id], fighter.facing, game.frame, game.combatFrame, game.inputConfig.socd, game.inputConfig.bufferFrames);
  }
  game.frame++;
  if (game.hitstop > 0) { game.hitstop--; return; }
  const holdEligible = game.fighters.map(standingHoldEligible);
  const available = game.fighters.map(fighter => { advanceAttack(fighter); return moveFighter(fighter, fixedDummy && fighter.id === 1); });
  measureAdvantage(game, available);
  for (const fighter of game.fighters) startAttack(fighter, game.combatFrame, holdEligible[fighter.id]);
  resolvePushboxes(game.fighters);
  resolveCombat(game);
  if (!game.training.enabled) resolveRound(game);
  game.combatFrame++;
}

/**
 * After the round is decided the surviving fighters play their current action
 * (attack, landing, stun, knockdown) to its end with neutral input and settle
 * into Idle. No new attack can start and no contact is resolved. KO fighters
 * stay untouched; their fall is presentation-only (HitFeedback.koFrames).
 */
export function settleFighters(game: GameState): void {
  const neutral = neutralInput();
  for (const f of game.fighters) {
    if (f.state === 'KO') continue;
    captureInput(f.input, neutral, f.facing, game.frame, game.combatFrame, game.inputConfig.socd, game.inputConfig.bufferFrames);
    f.input.pending = null;
    advanceAttack(f);
    moveFighter(f, true);
    const other = game.fighters[1 - f.id];
    if (f.state !== 'Attack' && f.x !== other.x) f.facing = f.x < other.x ? 1 : -1;
  }
  resolvePushboxes(game.fighters);
}

export function snapshot(game: GameState): GameState {
  return structuredClone(game);
}
