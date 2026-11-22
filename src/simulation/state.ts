import type { GameState } from './types';
import { captureInput } from '../input/commands';
import { neutralInput, type RawInput } from '../input/types';
import { moveFighter } from './movement';
import { resolvePushboxes } from './collision';
import { advanceAttack, measureAdvantage, resolveCombat, startAttack, standingHoldEligible } from './combat';
import { advanceRound, resolveRound } from './rounds';
import { createFighter, createGame } from './factory';
import { dummyInput } from '../debug/training';
import { applyEvents, type ControlEvent } from './events';
import { advanceThrows, resolveThrows } from './throws';

// Factories live in ./factory so events and rounds can use them without an import cycle.
export { createFighter, createGame };

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
  advanceThrows(game);
  measureAdvantage(game, available);
  for (const fighter of game.fighters) startAttack(fighter, game.combatFrame, holdEligible[fighter.id]);
  resolvePushboxes(game.fighters);
  resolveThrows(game);
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
  // A throw in progress still lands, without damage once the round is decided.
  advanceThrows(game, false);
  resolvePushboxes(game.fighters);
}

export function snapshot(game: GameState): GameState {
  return structuredClone(game);
}
