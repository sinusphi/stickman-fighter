import type { GameState } from './types';
import type { DummyMode } from '../debug/training';
import { createGame } from './factory';

export type ControlEvent =
  | { type: 'reset' }
  | { type: 'training'; enabled: boolean; dummy: DummyMode }
  | { type: 'inputConfig'; config: GameState['inputConfig'] }
  /** Training options that keep the Revenge / Special bars full; no reset. */
  | { type: 'trainingBars'; revenge: boolean; special: boolean };

export function applyEvents(game: GameState, events: ControlEvent[]): void {
  for (const event of events) {
    if (event.type === 'inputConfig') game.inputConfig = structuredClone(event.config);
    if (event.type === 'training') {
      const toggled = event.enabled !== game.training.enabled;
      game.training = { ...game.training, enabled: event.enabled, dummy: event.dummy };
      if (toggled) applyEvents(game, [{ type: 'reset' }]);
    }
    if (event.type === 'trainingBars') game.training = { ...game.training, fullRevenge: event.revenge, fullSpecial: event.special };
    if (event.type === 'reset') {
      const { frame, combatFrame, inputConfig, training, roundIntro } = game;
      Object.assign(game, createGame({ intro: roundIntro }), { frame, combatFrame, inputConfig, training });
      // Training keeps the versus marker for later, but its rounds never play the intro.
      if (training.enabled && game.round.phase === 'intro') { game.round.phase = 'fighting'; game.round.intro = null; }
    }
  }
}
