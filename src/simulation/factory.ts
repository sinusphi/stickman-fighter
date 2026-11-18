import rules from '../data/rules.json';
import { createInputState } from '../input/history';
import type { RoundState } from './rounds';
import type { Fighter, GameState } from './types';

/**
 * Pure state factories. This module imports no simulation code at runtime so
 * state, events and rounds can all depend on it without import cycles.
 */
export function createRound(): RoundState {
  return { phase:'fighting', number:1, timer:rules.roundSeconds*rules.hz, wins:[0,0], transition:0, winner:null, reason:null };
}

export function createFighter(id: number): Fighter {
  return { resources: structuredClone(rules.resources), id, x: rules.spawns[id], y: 0, vx: 0, vy: 0, facing: id === 0 ? 1 : -1, state: 'Idle', stateFrame: 0, hp: rules.maxHealth,
    input: createInputState(), crouching: false, remaining: 0, jumpX: 0, airAttackUsed: false, landingRecovery: 0,
    moveId: null, moveFrame: 0, attackFacing: id === 0 ? 1 : -1, attackId: 0, hitTargets: [],
    comboCount: 0, damageScalePermille: rules.damageScaleUnit, juggleState: 0, advantage: 'n/a' };
}

export function createGame(): GameState {
  return { schemaVersion: 2, frame: 0, combatFrame: 0, fighters: [createFighter(0), createFighter(1)], inputConfig: { socd: { horizontal: 'neutral', vertical: 'positive' }, bufferFrames: rules.bufferFrames }, hitstop: 0, lastContact: null, measurements: [], round: createRound(), training: { enabled:false, dummy:'stand' } };
}
