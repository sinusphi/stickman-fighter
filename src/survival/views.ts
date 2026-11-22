import { createFighter, createGame } from '../simulation/factory';
import type { GameState } from '../simulation/types';
import type { Enemy, SurvivalState } from './state';

/*
 * Read-only two-fighter views of a survival state for presentation code that
 * expects a versus GameState (effects, sounds, HUD). Never written back.
 */

export interface SurvivalView { uid: number; game: GameState }

function view(state: SurvivalState, e: Enemy): GameState {
  // The player's hit targets are kept per enemy (see stepSurvival).
  return { ...e.pair, frame: state.frame, combatFrame: state.combatFrame, hitstop: state.hitstop,
    fighters: [{ ...state.player, hitTargets: e.playerHits }, e.fighter] };
}

/** One [player, enemy] view per enemy, closest enemy first. */
export function survivalViews(state: SurvivalState): SurvivalView[] {
  return [...state.enemies].sort((a, b) => Math.abs(a.fighter.x - state.player.x) - Math.abs(b.fighter.x - state.player.x))
    .map(e => ({ uid: e.uid, game: view(state, e) }));
}

/** Enemy shown in the HUD: the one hit last, else a living boss, else the closest living one. */
export function survivalFocus(state: SurvivalState): Enemy | undefined {
  const p = state.player;
  const living = state.enemies.filter(e => !e.dead && !e.entering).sort((a, b) => Math.abs(a.fighter.x - p.x) - Math.abs(b.fighter.x - p.x));
  return state.enemies.find(e => e.uid === state.focus && !e.dead) ?? living.find(e => e.boss > 0) ?? living[0];
}

/** HUD view: the player against the focused enemy. */
export function survivalHudGame(state: SurvivalState): GameState {
  const focus = survivalFocus(state);
  if (focus) return view(state, focus);
  const placeholder = createFighter(1); placeholder.hp = 0;
  return { ...createGame(), frame: state.frame, combatFrame: state.combatFrame, hitstop: state.hitstop, inputConfig: state.inputConfig, fighters: [state.player, placeholder] };
}
