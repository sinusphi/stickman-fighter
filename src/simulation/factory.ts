import rules from '../data/rules.json';
import { createInputState } from '../input/history';
import type { RoundState } from './rounds';
import type { Fighter, GameState } from './types';

/**
 * Pure state factories. This module imports no simulation code at runtime so
 * state, events and rounds can all depend on it without import cycles.
 */
/** `intro`: the round opens with the versus intro (see simulation/intro) instead of fighting at once. */
export function createRound(intro = false): RoundState {
  return { phase:intro?'intro':'fighting', number:1, timer:rules.roundSeconds*rules.hz, wins:[0,0], transition:0, winner:null, reason:null, intro:intro?{ step:'ready', frame:0 }:null };
}

export function createFighter(id: number): Fighter {
  return { resources: structuredClone(rules.resources), id, x: rules.spawns[id], y: 0, vx: 0, vy: 0, facing: id === 0 ? 1 : -1, state: 'Idle', stateFrame: 0, hp: rules.maxHealth,
    input: createInputState(), crouching: false, remaining: 0, jumpX: 0, airAttackUsed: false, landingRecovery: 0,
    moveId: null, moveFrame: 0, attackFacing: id === 0 ? 1 : -1, attackId: 0, hitTargets: [],
    comboCount: 0, damageScalePermille: rules.damageScaleUnit, juggleState: 0, advantage: 'n/a' };
}

/**
 * `intro: true` marks a versus game: every round (after resets too) opens with
 * the round intro, except while training is enabled. Plain games (tests,
 * survival views) start fighting at once.
 */
export function createGame(options: { intro?: boolean } = {}): GameState {
  return { ...(options.intro ? { roundIntro: true as const } : {}), schemaVersion: 2, frame: 0, combatFrame: 0, fighters: [createFighter(0), createFighter(1)], inputConfig: { socd: { horizontal: 'neutral', vertical: 'positive' }, bufferFrames: rules.bufferFrames }, hitstop: 0, lastContact: null, measurements: [], round: createRound(options.intro), training: { enabled:false, dummy:'stand' } };
}
